//! Request handlers for HTTP and WebSocket endpoints.

use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        ConnectInfo, State,
    },
    http::StatusCode,
    response::{IntoResponse, Json},
};
use futures_util::{SinkExt, StreamExt};
use std::net::SocketAddr;
use tracing::{info, warn};

use crate::state::{AppState, BroadcastMessage, PlayerSession};

// ─── Health Check ────────────────────────────────────────────────

/// Simple health check — returns 200 OK.
/// Used by load balancers, CI/CD, and monitoring.
pub async fn health_check() -> impl IntoResponse {
    Json(serde_json::json!({ "status": "ok" }))
}

// ─── Environment Config ──────────────────────────────────────────

/// Returns the current environment configuration.
/// The client fetches this on startup and uses it to build the scene.
pub async fn get_environment(State(state): State<AppState>) -> impl IntoResponse {
    let env = state.environment.read().await;
    Json(env.clone())
}

// ─── WebSocket ───────────────────────────────────────────────────

/// Upgrades an HTTP connection to a WebSocket.
/// Performs rate-limiting checks before accepting.
pub async fn ws_upgrade(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
) -> impl IntoResponse {
    let ip = addr.ip().to_string();

    // Rate limit: check if this IP can open another connection
    if !state.can_connect(&ip).await {
        warn!("Connection rejected from {} — rate limit exceeded", ip);
        return StatusCode::TOO_MANY_REQUESTS.into_response();
    }

    info!("WebSocket connection from {}", ip);

    ws.on_upgrade(move |socket| handle_ws(socket, state, ip))
        .into_response()
}

/// Handles an active WebSocket connection.
///
/// Spawns two concurrent tasks:
/// 1. **Inbound**: Reads messages from this client (position updates, etc.)
/// 2. **Outbound**: Forwards broadcast messages to this client
///
/// When either task ends (client disconnects or error), both are cleaned up.
async fn handle_ws(socket: WebSocket, state: AppState, ip: String) {
    // Register this connection and get a session ID
    let session_id = state.register_connection(&ip).await;
    info!("Player {} connected (ip: {})", session_id, ip);

    // Subscribe to the broadcast channel for outbound messages
    let mut broadcast_rx = state.broadcast_tx.subscribe();

    // Split the WebSocket into sender and receiver halves.
    // split() comes from the StreamExt trait (imported at the top).
    // SinkExt is needed for ws_sender.send(), StreamExt for ws_receiver.next().
    let (mut ws_sender, mut ws_receiver) = socket.split();

    let state_clone = state.clone();
    let session_id_outbound = session_id.clone();
    let session_id_inbound = session_id.clone();

    // ── Outbound task: broadcast → this client ───────────────────
    let mut outbound_task = tokio::spawn(async move {
        while let Ok(msg) = broadcast_rx.recv().await {
            // Don't echo a player's own updates back to them
            if let BroadcastMessage::PlayerUpdate { ref player } = msg {
                if player.id == session_id_outbound {
                    continue;
                }
            }

            if let Ok(text) = serde_json::to_string(&msg) {
                let send_result = ws_sender.send(Message::Text(text)).await;
                if send_result.is_err() {
                    break; // Client disconnected
                }
            }
        }
    });

    // ── Inbound task: this client → process + broadcast ──────────
    let mut inbound_task = tokio::spawn(async move {
        while let Some(Ok(msg)) = ws_receiver.next().await {
            match msg {
                Message::Text(text) => {
                    // Try to parse as a player position update
                    if let Ok(update) = serde_json::from_str::<PlayerSession>(&text) {
                        // Update the session state
                        let mut sessions = state_clone.sessions.write().await;
                        if let Some(session) = sessions.get_mut(&session_id_inbound) {
                            session.position = update.position;
                            session.rotation = update.rotation;
                        }
                        drop(sessions);

                        // Broadcast to other clients
                        let _ = state_clone
                            .broadcast_tx
                            .send(BroadcastMessage::PlayerUpdate { player: update });
                    }
                }
                Message::Close(_) => break,
                _ => {} // Ignore binary, ping, pong
            }
        }
    });

    // Wait for either task to finish, then cancel the other
    tokio::select! {
        _ = &mut outbound_task => inbound_task.abort(),
        _ = &mut inbound_task => outbound_task.abort(),
    }

    // Clean up the connection
    state.remove_connection(&session_id, &ip).await;
    info!("Player {} disconnected", session_id);
}
