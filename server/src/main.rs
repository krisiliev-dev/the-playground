//! Portfolio World server — authoritative multiplayer with admin
//! tooling. Per ADR-004:
//!   - entity-component scene state
//!   - 30 Hz tick loop + state diff broadcasts        (slice 2)
//!   - two-channel WebSocket (player + admin)         (slice 2)
//!   - bearer-token admin auth                        (slice 2)
//!   - periodic snapshot persistence                  (slice 3)
//!
//! Slice 1 stands up the entity model, registry, and connection
//! lifecycle so the rest can build on a compiling foundation.
mod auth;
mod config;
mod entity;
mod handlers;
mod protocol;
mod registry;
mod state;
mod tick;

use std::net::SocketAddr;

use axum::{routing::get, Router};
use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::TraceLayer;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use crate::state::AppState;

#[tokio::main]
async fn main() {
    tracing_subscriber::registry()
        .with(tracing_subscriber::EnvFilter::new(
            std::env::var("RUST_LOG").unwrap_or_else(|_| "info,tower_http=info".into()),
        ))
        .with(tracing_subscriber::fmt::layer())
        .init();

    let admin_token = std::env::var("ADMIN_TOKEN").unwrap_or_default();
    if admin_token.is_empty() {
        tracing::warn!("ADMIN_TOKEN is not set — admin mutations will be rejected");
    }

    let state = AppState::new(admin_token);

    // Spawn the 30 Hz authoritative tick loop. Returns a JoinHandle
    // we deliberately drop — the task lives for the lifetime of
    // the process; tokio cancels it on graceful shutdown.
    let _tick_handle = tick::spawn(state.clone());

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let app = Router::new()
        .route("/health", get(handlers::health_check))
        .route("/ws", get(handlers::ws_upgrade))
        .with_state(state)
        .layer(cors)
        .layer(TraceLayer::new_for_http());

    let port: u16 = std::env::var("PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(8080);
    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    tracing::info!("portfolio-world server listening on {}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .await
    .unwrap();
}
