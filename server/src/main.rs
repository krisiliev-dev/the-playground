//! Portfolio World Server
//!
//! A lightweight server that handles:
//! - **Multiplayer sync**: Relays player positions between connected clients
//! - **Live editing**: Broadcasts environment config changes to all clients
//! - **Session management**: Tracks connections, enforces rate limits
//! - **Admin video pipeline**: Converts YouTube 360° videos for the sky background

mod config;
mod handlers;
mod state;
mod video;

use axum::{
    routing::{get, post},
    Router,
};
use std::net::SocketAddr;
use std::path::PathBuf;
use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::TraceLayer;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use crate::state::AppState;

#[tokio::main]
async fn main() {
    tracing_subscriber::registry()
        .with(tracing_subscriber::EnvFilter::new(
            std::env::var("RUST_LOG").unwrap_or_else(|_| "info,tower_http=debug".into()),
        ))
        .with(tracing_subscriber::fmt::layer())
        .init();

    let videos_dir =
        PathBuf::from(std::env::var("VIDEOS_DIR").unwrap_or_else(|_| "/home/ubuntu/videos".into()));
    let videos_public_prefix = std::env::var("VIDEOS_PUBLIC_PREFIX")
        .unwrap_or_else(|_| "https://krisiliev.dev/videos".into());
    let admin_token = std::env::var("ADMIN_TOKEN").unwrap_or_default();

    if admin_token.is_empty() {
        tracing::warn!(
            "ADMIN_TOKEN is not set — video conversion endpoints will reject all requests"
        );
    }

    let state = AppState::new(videos_dir, videos_public_prefix, admin_token).await;

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let app = Router::new()
        .route("/health", get(handlers::health_check))
        .route("/ws", get(handlers::ws_upgrade))
        .route("/api/environment", get(handlers::get_environment))
        // Video pipeline
        .route("/api/video/convert", post(handlers::convert_video))
        .route("/api/video/jobs", get(handlers::list_video_jobs))
        .route("/api/video/jobs/:id", get(handlers::get_video_job))
        .route("/api/video/list", get(handlers::list_ready_videos))
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
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .await
    .unwrap();
}
