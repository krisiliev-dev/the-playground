//! HTTP and WebSocket handlers.
//!
//! Slice 1 surface area is intentionally small:
//!   - GET /health — liveness probe
//!   - GET /ws     — WebSocket upgrade (currently accepts the
//!                  connection and applies connection caps;
//!                  message handling lands in slice 2)
//!
//! Slice 2 will add the inbound message router (player input vs.
//! admin mutation), token-checked admin gating, and outbound
//! tick broadcasts.
use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        ConnectInfo, State,
    },
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use futures_util::{SinkExt, StreamExt};
use std::net::SocketAddr;
use tracing::{info, warn};

use crate::state::AppState;

/// Liveness — used by load balancers and CI smoke tests.
pub async fn health_check() -> impl IntoResponse {
    Json(serde_json::json!({ "status": "ok" }))
}

/// Upgrade an HTTP request to a WebSocket connection. Rate-limit
/// checks happen here before the upgrade is accepted; once
/// upgraded, `handle_ws` owns the connection until close.
pub async fn ws_upgrade(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
) -> impl IntoResponse {
    let ip = addr.ip().to_string();

    if !state.can_connect(&ip).await {
        warn!(ip = %ip, "connection rejected — rate limit exceeded");
        return StatusCode::TOO_MANY_REQUESTS.into_response();
    }

    info!(ip = %ip, "websocket upgrade accepted");
    ws.on_upgrade(move |socket| handle_ws(socket, state, ip))
        .into_response()
}

/// Per-connection task. Slice 1: register the connection,
/// idle until the client closes, release the slot. Slice 2
/// adds the actual message pump.
async fn handle_ws(socket: WebSocket, state: AppState, ip: String) {
    state.register_connection(&ip).await;

    let (mut ws_sender, mut ws_receiver) = socket.split();

    while let Some(Ok(msg)) = ws_receiver.next().await {
        match msg {
            Message::Close(_) => break,
            Message::Ping(payload) => {
                // Respond to keepalives — Axum's WS does NOT auto-pong.
                if ws_sender.send(Message::Pong(payload)).await.is_err() {
                    break;
                }
            }
            // Slice 2 will route Text/Binary into ClientMessage parsing.
            _ => {}
        }
    }

    state.release_connection(&ip).await;
    info!(ip = %ip, "websocket disconnected");
}
