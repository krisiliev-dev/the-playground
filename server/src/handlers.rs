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
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        ConnectInfo, Query, State,
    },
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use futures_util::{SinkExt, StreamExt};
use tokio::sync::broadcast::error::RecvError;
use tracing::{debug, info, warn};

use crate::auth;
use crate::entity::{Entity, EntityId, EntityKind, Transform};
use crate::protocol::{ClientMessage, EntityOp, ServerMessage};
use crate::state::AppState;

pub async fn health_check() -> impl IntoResponse {
    Json(serde_json::json!({ "status": "ok" }))
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
    let mut broadcast_rx = state.broadcast_tx.subscribe();
    let mut outbound_task = tokio::spawn(async move {
        loop {
            match broadcast_rx.recv().await {
                Ok(msg) => {
                    let Ok(text) = serde_json::to_string(&msg) else {
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
                    let Ok(client_msg) = serde_json::from_str::<ClientMessage>(&text) else {
                        debug!(?text, "ignoring malformed ClientMessage");
                        continue;
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
        ClientMessage::PlayerInput { transform, route } => {
            let mut registry = state.registry.write().await;
            registry.mutate(&player_id, |entity| {
                entity.transform = transform;
                if let Some(props) = entity.props.as_object_mut() {
                    props.insert("route".to_string(), serde_json::Value::String(route));
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
    }
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

async fn cleanup(state: &AppState, ip: &str, player_id: EntityId) {
    let removed = state.registry.write().await.remove(&player_id);
    if removed.is_some() {
        let _ = state.broadcast_tx.send(ServerMessage::EntityDeleted {
            ids: vec![player_id],
        });
    }
    state.release_connection(ip).await;
    info!(ip = %ip, "websocket disconnected");
}
