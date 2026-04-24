//! Request handlers for HTTP and WebSocket endpoints.

use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        ConnectInfo, Path, State,
    },
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Json},
};
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use std::net::SocketAddr;
use tracing::{info, warn};

use crate::state::{AppState, BroadcastMessage, PlayerSession};
use crate::video::{self, VideoJob};

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

// ─── Video Conversion (admin) ────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct ConvertRequest {
    pub url: String,
    pub name: String,
}

fn is_admin(headers: &HeaderMap, token: &str) -> bool {
    if token.is_empty() {
        return false;
    }
    headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.strip_prefix("Bearer "))
        .map(|t| t == token)
        .unwrap_or(false)
}

/// POST /api/video/convert — admin only. Starts a new conversion job.
pub async fn convert_video(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<ConvertRequest>,
) -> impl IntoResponse {
    if !is_admin(&headers, &state.admin_token) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    if !video::is_valid_youtube_url(&req.url) {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "URL must be a YouTube link" })),
        )
            .into_response();
    }
    if req.name.trim().is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "name is required" })),
        )
            .into_response();
    }

    let job = VideoJob::new(req.url, req.name);
    let job_id = job.id.clone();
    state.video_jobs.insert(job.clone()).await;

    tokio::spawn(video::process_video(
        job_id.clone(),
        state.video_jobs.clone(),
        state.video_semaphore.clone(),
        state.videos_dir.clone(),
        state.videos_public_prefix.clone(),
    ));

    info!("Queued video conversion job {}", job_id);
    (StatusCode::ACCEPTED, Json(job)).into_response()
}

/// GET /api/video/jobs/:id — admin only. Poll for progress.
pub async fn get_video_job(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> impl IntoResponse {
    if !is_admin(&headers, &state.admin_token) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    match state.video_jobs.get(&id).await {
        Some(job) => Json(job).into_response(),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

/// GET /api/video/jobs — admin only. List every job.
pub async fn list_video_jobs(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> impl IntoResponse {
    if !is_admin(&headers, &state.admin_token) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    Json(state.video_jobs.list().await).into_response()
}

/// GET /api/video/list — public. Only ready videos, for the client to cycle through.
pub async fn list_ready_videos(State(state): State<AppState>) -> impl IntoResponse {
    Json(state.video_jobs.list_ready().await)
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
