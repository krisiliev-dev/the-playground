//! Portfolio World Server
//!
//! A lightweight WebSocket server that handles:
//! - **Multiplayer sync**: Relays player positions between connected clients
//! - **Live editing**: Broadcasts environment config changes to all clients
//! - **Session management**: Tracks connections, enforces rate limits
//!
//! The server is intentionally thin — all 3D rendering happens client-side.
//! This server's job is to be a fast, cheap message relay.

mod config;
mod handlers;
mod state;

use axum::{routing::get, Router};
use std::net::SocketAddr;
use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::TraceLayer;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use crate::state::AppState;

#[tokio::main]
async fn main() {
    // Initialize structured logging
    tracing_subscriber::registry()
        .with(tracing_subscriber::EnvFilter::new(
            std::env::var("RUST_LOG").unwrap_or_else(|_| "info,tower_http=debug".into()),
        ))
        .with(tracing_subscriber::fmt::layer())
        .init();

    // Shared application state (wrapped in Arc for thread safety)
    let state = AppState::new();

    // CORS — permissive in dev, restrict in production via env var
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let app = Router::new()
        // Health check endpoint (useful for CI/CD and monitoring)
        .route("/health", get(handlers::health_check))
        // WebSocket endpoint for real-time communication
        .route("/ws", get(handlers::ws_upgrade))
        // Environment config endpoint (GET to read, PUT to update live)
        .route("/api/environment", get(handlers::get_environment))
        .with_state(state)
        .layer(cors)
        .layer(TraceLayer::new_for_http());

    let port: u16 = std::env::var("PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(8080);

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    tracing::info!("🌍 Portfolio World server listening on {}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
