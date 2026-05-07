//! HTTP and WebSocket handlers.
//!
//! GET /health       — liveness probe
//! GET /ws?token=... — WebSocket upgrade. The optional `token`
//!                     query param promotes the connection to
//!                     admin (gated by `auth::is_admin`); without
//!                     it, the connection is a regular player.
//!
//! Per-connection lifecycle:
//!   1. Verify connection cap, accept upgrade.
//!   2. Spawn a Player entity into the registry.
//!   3. Send FullState privately to this client (so they see all
//!      existing entities even before the next tick).
//!   4. Subscribe to broadcast channel; spawn outbound + inbound
//!      tasks.
//!   5. Inbound: route ClientMessage to mutation paths.
//!   6. On close: remove the Player entity, broadcast
//!      EntityDeleted, release the IP slot.
use std::collections::HashMap;
use std::net::SocketAddr;

use axum::{
    body::Bytes,
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        ConnectInfo, Query, State,
    },
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    Json,
};
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use tokio::sync::broadcast::error::RecvError;
use tracing::{debug, info, warn};

use crate::assets::{self, DEFAULT_MAX_UPLOAD_BYTES};
use crate::auth;
use crate::entity::{Entity, EntityId, EntityKind, Transform};
use crate::protocol::{ClientMessage, EntityOp, SceneEventKind, ServerMessage};
use crate::scene_event::{validate_event, ValidationOutcome};
use crate::state::AppState;

pub async fn health_check() -> impl IntoResponse {
    Json(serde_json::json!({ "status": "ok" }))
}

#[derive(Deserialize)]
pub struct AdminEventRequest {
    pub event: SceneEventKind,
}

/// POST /api/admin/event — admin authenticates via Authorization
/// Bearer token and triggers a one-shot SceneEvent at any
/// position, fanned out to all connected clients.
///
/// Anonymous-actor (`actor_id: None`) so receivers know it came
/// from outside any player's normal play loop. Bypasses the
/// per-actor rate-limiter — the admin is trusted operator-side
/// and is expected to manage their own send rates. Value clamps
/// from `validate_event` are NOT applied; admin can author
/// arbitrary parameters since they're triggering deliberate
/// effects rather than relaying user input.
pub async fn post_admin_event(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<AdminEventRequest>,
) -> impl IntoResponse {
    let presented = extract_bearer(&headers).unwrap_or("");
    if !auth::is_admin_token(presented, &state.admin_token) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let _ = state.broadcast_tx.send(ServerMessage::SceneEvent {
        actor_id: None,
        event: req.event,
    });
    StatusCode::ACCEPTED.into_response()
}

/// POST /api/admin/assets — admin uploads bytes to be stored at
/// a content-addressed URL. Auth via Authorization Bearer token.
///
/// Wire format:
///   - Body: raw asset bytes (no multipart wrapper).
///   - `?ext=<extension>` query param sets the file extension
///     used in the URL. Defaults to `bin`. Sanitised against
///     path traversal + non-alphanumeric chars.
///
/// Response:
///   - 201 Created with `{ id, url, size, extension }` on success.
///   - 401 Unauthorized on bad/missing token.
///   - 413 Payload Too Large if body exceeds the cap.
///   - 400 Bad Request on invalid extension.
///   - 500 on disk I/O failure.
pub async fn post_admin_asset(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(q): Query<HashMap<String, String>>,
    body: Bytes,
) -> impl IntoResponse {
    let presented = extract_bearer(&headers).unwrap_or("");
    if !auth::is_admin_token(presented, &state.admin_token) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let extension = q.get("ext").map(|s| s.as_str()).unwrap_or("bin");
    match assets::save_upload(
        &body,
        extension,
        &state.assets_dir,
        DEFAULT_MAX_UPLOAD_BYTES,
    )
    .await
    {
        Ok(meta) => (StatusCode::CREATED, Json(meta)).into_response(),
        Err(assets::UploadError::Oversized { .. }) => StatusCode::PAYLOAD_TOO_LARGE.into_response(),
        Err(assets::UploadError::InvalidExtension) => StatusCode::BAD_REQUEST.into_response(),
        Err(e) => {
            tracing::error!(error = %e, "asset upload failed");
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

/// Pull the bearer token from an `Authorization: Bearer <token>`
/// header. Returns None if header missing, malformed, or doesn't
/// start with the `Bearer ` prefix.
fn extract_bearer(headers: &HeaderMap) -> Option<&str> {
    headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.strip_prefix("Bearer "))
}

pub async fn ws_upgrade(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
    Query(params): Query<HashMap<String, String>>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
) -> impl IntoResponse {
    let ip = addr.ip().to_string();

    if !state.can_connect(&ip).await {
        warn!(ip = %ip, "connection rejected — rate limit exceeded");
        return StatusCode::TOO_MANY_REQUESTS.into_response();
    }

    let is_admin = auth::is_admin(&params, &state.admin_token);
    info!(ip = %ip, is_admin, "websocket upgrade accepted");

    ws.on_upgrade(move |socket| handle_ws(socket, state, ip, is_admin))
        .into_response()
}

async fn handle_ws(socket: WebSocket, state: AppState, ip: String, is_admin: bool) {
    state.register_connection(&ip).await;

    // Spawn this connection's player entity. Position is identity
    // for now; the client moves it on first PlayerInput.
    let player = Entity::new(
        EntityKind::Player,
        Transform::identity(),
        serde_json::json!({
            "name": "Guest",
            "cursor_color": "#00ffcc",
            "route": "/"
        }),
    );
    let player_id = player.id;
    state.registry.write().await.insert(player);

    let (mut ws_sender, mut ws_receiver) = socket.split();

    // ── 1. Send FullState privately ──────────────────────────
    // The new client needs to see existing entities immediately
    // (don't wait for next tick). Sent over the socket directly,
    // not via broadcast — only THIS client gets it.
    let full_state = {
        let registry = state.registry.read().await;
        ServerMessage::FullState {
            entities: registry.snapshot(),
            your_player_id: player_id,
        }
    };
    if let Ok(text) = serde_json::to_string(&full_state) {
        if ws_sender.send(Message::Text(text)).await.is_err() {
            cleanup(&state, &ip, player_id).await;
            return;
        }
    }

    // ── 2. Outbound task: broadcast → this socket ────────────
    // Filters out THIS connection's own player entity from
    // EntityUpdates — the client predicts its own position
    // locally and doesn't need server echoes. Saves bandwidth
    // and avoids snap-back artefacts during prediction.
    let mut broadcast_rx = state.broadcast_tx.subscribe();
    let mut outbound_task = tokio::spawn(async move {
        loop {
            match broadcast_rx.recv().await {
                Ok(msg) => {
                    let Some(forwarded) = filter_self_echo(msg, player_id) else {
                        continue;
                    };
                    let Ok(text) = serde_json::to_string(&forwarded) else {
                        continue;
                    };
                    if ws_sender.send(Message::Text(text)).await.is_err() {
                        return; // socket closed
                    }
                }
                Err(RecvError::Lagged(n)) => {
                    // Slow reader fell behind by N messages. Tick
                    // loop will resync them on the next broadcast.
                    debug!(skipped = n, "broadcast subscriber lagged");
                }
                Err(RecvError::Closed) => return,
            }
        }
    });

    // ── 3. Inbound task: socket → registry mutations ─────────
    let inbound_state = state.clone();
    let mut inbound_task = tokio::spawn(async move {
        while let Some(Ok(msg)) = ws_receiver.next().await {
            match msg {
                Message::Close(_) => break,
                Message::Text(text) => {
                    let client_msg = match serde_json::from_str::<ClientMessage>(&text) {
                        Ok(m) => m,
                        Err(err) => {
                            // WARN level (not debug) so an out-of-date
                            // server immediately surfaces the mismatch
                            // instead of silently dropping a whole
                            // category of messages — the historical
                            // bug pattern when ClientMessage variants
                            // grew without redeploying.
                            warn!(error = %err, ?text, "ignoring malformed ClientMessage");
                            continue;
                        }
                    };
                    handle_client_message(&inbound_state, player_id, is_admin, client_msg).await;
                }
                _ => {} // Binary, Ping, Pong handled elsewhere or ignored
            }
        }
    });

    tokio::select! {
        _ = &mut outbound_task => inbound_task.abort(),
        _ = &mut inbound_task => outbound_task.abort(),
    }

    cleanup(&state, &ip, player_id).await;
}

/// Apply an inbound ClientMessage to the registry. Player input
/// only mutates the sender's own player; admin mutations require
/// the connection to be flagged admin at upgrade time.
async fn handle_client_message(
    state: &AppState,
    player_id: EntityId,
    is_admin: bool,
    msg: ClientMessage,
) {
    match msg {
        ClientMessage::PlayerInput {
            transform,
            route,
            presence,
        } => {
            let mut registry = state.registry.write().await;
            registry.mutate(&player_id, |entity| {
                entity.transform = transform;
                if let Some(props) = entity.props.as_object_mut() {
                    props.insert("route".to_string(), serde_json::Value::String(route));
                    // Merge presence keys into the entity's props
                    // bag. A null value for a key means "clear that
                    // presence" — explicit nulls intentionally pass
                    // through so the receiver-side observers see the
                    // transition (menu opened → null → menu closed).
                    if let Some(presence) = presence {
                        if let Some(presence_obj) = presence.as_object() {
                            for (key, value) in presence_obj {
                                props.insert(key.clone(), value.clone());
                            }
                        }
                    }
                }
            });
        }
        ClientMessage::EntityMutation { op } => {
            if !is_admin {
                send_error(state, "admin token required for entity mutation").await;
                return;
            }
            apply_admin_mutation(state, op).await;
        }
        ClientMessage::SceneEvent { event } => {
            forward_scene_event(state, player_id, event).await;
        }
    }
}

/// Validate a SceneEvent and rebroadcast to other clients on
/// pass. Per ADR-006, the originator already played the effect
/// locally (optimistic-local), so we never echo back to them —
/// the broadcast carries `actor_id` and the client outbound
/// task filters self-echoes. Validation drops are silent.
async fn forward_scene_event(state: &AppState, actor_id: EntityId, event: SceneEventKind) {
    let now = std::time::Instant::now();
    let outcome = {
        let mut tracker = state.event_rate.write().await;
        validate_event(Some(actor_id), event, &mut tracker, now)
    };
    let validated = match outcome {
        ValidationOutcome::Pass(e) => e,
        ValidationOutcome::Drop => {
            tracing::debug!(actor = %actor_id, "scene event dropped by validator");
            return;
        }
    };
    tracing::info!(
        actor = %actor_id,
        receivers = state.broadcast_tx.receiver_count(),
        "scene event forwarded"
    );
    let _ = state.broadcast_tx.send(ServerMessage::SceneEvent {
        actor_id: Some(actor_id),
        event: validated,
    });
}

async fn apply_admin_mutation(state: &AppState, op: EntityOp) {
    match op {
        EntityOp::Create { entity } => {
            state.registry.write().await.insert(entity);
        }
        EntityOp::Update {
            id,
            transform,
            props,
        } => {
            let mut registry = state.registry.write().await;
            registry.mutate(&id, |entity| {
                if let Some(t) = transform {
                    entity.transform = t;
                }
                if let Some(p) = props {
                    entity.props = p;
                }
            });
        }
        EntityOp::Delete { id } => {
            let removed = state.registry.write().await.remove(&id);
            if removed.is_some() {
                let _ = state
                    .broadcast_tx
                    .send(ServerMessage::EntityDeleted { ids: vec![id] });
            }
        }
    }
}

/// Best-effort error broadcast. Currently fans out to all
/// clients; slice 2.5 will route errors only to the originating
/// client once we wire per-connection mailboxes.
async fn send_error(state: &AppState, message: &str) {
    let _ = state.broadcast_tx.send(ServerMessage::Error {
        message: message.to_string(),
    });
}

/// Strip the receiving client's own player from outbound
/// `EntityUpdates`, dropping the message entirely if that was
/// the only entity in it. SceneEvents authored by `self_id` are
/// dropped wholesale (per ADR-006: optimistic-local means the
/// originator already played the effect — server-rebroadcast
/// is for OTHERS). Other message kinds pass through unchanged.
fn filter_self_echo(msg: ServerMessage, self_id: EntityId) -> Option<ServerMessage> {
    match msg {
        ServerMessage::EntityUpdates { entities } => {
            let filtered: Vec<Entity> = entities.into_iter().filter(|e| e.id != self_id).collect();
            if filtered.is_empty() {
                None
            } else {
                Some(ServerMessage::EntityUpdates { entities: filtered })
            }
        }
        ServerMessage::SceneEvent { actor_id, event } => {
            if actor_id == Some(self_id) {
                None
            } else {
                Some(ServerMessage::SceneEvent { actor_id, event })
            }
        }
        // FullState, EntityDeleted, Error all relevant to the
        // receiver even when they reference the receiver itself.
        other => Some(other),
    }
}

async fn cleanup(state: &AppState, ip: &str, player_id: EntityId) {
    let removed = state.registry.write().await.remove(&player_id);
    if removed.is_some() {
        let _ = state.broadcast_tx.send(ServerMessage::EntityDeleted {
            ids: vec![player_id],
        });
    }
    // Drop the rate-tracker history for this actor so its memory
    // doesn't grow unbounded over a long-running server.
    state.event_rate.write().await.forget(player_id);
    state.release_connection(ip).await;
    info!(ip = %ip, "websocket disconnected");
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::entity::{EntityKind, Transform};

    fn make_entity() -> Entity {
        Entity::new(
            EntityKind::Player,
            Transform::identity(),
            serde_json::json!({}),
        )
    }

    #[test]
    fn filter_self_echo_strips_own_entity_from_updates() {
        let me = make_entity();
        let other = make_entity();
        let msg = ServerMessage::EntityUpdates {
            entities: vec![me.clone(), other.clone()],
        };
        let filtered = filter_self_echo(msg, me.id).unwrap();
        match filtered {
            ServerMessage::EntityUpdates { entities } => {
                assert_eq!(entities.len(), 1);
                assert_eq!(entities[0].id, other.id);
            }
            _ => panic!("expected EntityUpdates"),
        }
    }

    #[test]
    fn filter_self_echo_drops_message_when_only_self_present() {
        let me = make_entity();
        let msg = ServerMessage::EntityUpdates {
            entities: vec![me.clone()],
        };
        assert!(filter_self_echo(msg, me.id).is_none());
    }

    #[test]
    fn filter_self_echo_passes_full_state_through_unchanged() {
        let me = make_entity();
        let msg = ServerMessage::FullState {
            entities: vec![me.clone()],
            your_player_id: me.id,
        };
        let filtered = filter_self_echo(msg, me.id);
        assert!(matches!(filtered, Some(ServerMessage::FullState { .. })));
    }

    #[test]
    fn filter_self_echo_passes_entity_deleted_through_even_for_self() {
        let me = make_entity();
        let msg = ServerMessage::EntityDeleted { ids: vec![me.id] };
        let filtered = filter_self_echo(msg, me.id);
        assert!(matches!(
            filtered,
            Some(ServerMessage::EntityDeleted { .. })
        ));
    }

    #[test]
    fn filter_self_echo_drops_scene_events_authored_by_self() {
        let me = make_entity();
        let event = SceneEventKind::Audio {
            sound_id: "click".to_string(),
            position: None,
            volume: 0.5,
        };
        let msg = ServerMessage::SceneEvent {
            actor_id: Some(me.id),
            event,
        };
        // Originator already played locally — server must not echo back.
        assert!(filter_self_echo(msg, me.id).is_none());
    }

    #[test]
    fn filter_self_echo_passes_scene_events_from_other_actors() {
        let me = make_entity();
        let other = make_entity();
        let event = SceneEventKind::SwordImpact {
            position: [1.0, 2.0, 3.0],
        };
        let msg = ServerMessage::SceneEvent {
            actor_id: Some(other.id),
            event,
        };
        let filtered = filter_self_echo(msg, me.id);
        match filtered {
            Some(ServerMessage::SceneEvent { actor_id, .. }) => {
                assert_eq!(actor_id, Some(other.id));
            }
            _ => panic!("expected SceneEvent forwarded"),
        }
    }

    #[test]
    fn filter_self_echo_passes_anonymous_scene_events() {
        let me = make_entity();
        // Anonymous events (actor_id == None) are reserved for
        // future server-originated effects (world-wide announcements).
        // They should fan out to everyone, including the receiver.
        let event = SceneEventKind::Audio {
            sound_id: "broadcast".to_string(),
            position: None,
            volume: 1.0,
        };
        let msg = ServerMessage::SceneEvent {
            actor_id: None,
            event,
        };
        assert!(filter_self_echo(msg, me.id).is_some());
    }
}
