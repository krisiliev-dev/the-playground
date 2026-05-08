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
mod assets;
mod auth;
mod config;
mod entity;
mod handlers;
mod protocol;
mod recipes;
mod registry;
mod scene_event;
mod snapshot;
mod state;
mod tick;

use std::net::SocketAddr;

use axum::{
    routing::{get, post},
    Router,
};
use tower_http::cors::{Any, CorsLayer};
use tower_http::services::ServeDir;
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

    let snapshot_path: std::path::PathBuf = std::env::var("STATE_FILE")
        .unwrap_or_else(|_| "state.json".to_string())
        .into();
    let snapshot_interval: u64 = std::env::var("SNAPSHOT_INTERVAL_SECS")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(snapshot::DEFAULT_SNAPSHOT_INTERVAL_SECS);
    // Per ADR-007: admin uploads land here at runtime. Defaults to
    // ./assets next to the binary; production deploys override
    // via env var to a persistent volume — content-addressed
    // filenames make this safe to back up + restore.
    let assets_dir: std::path::PathBuf = std::env::var("ASSETS_DIR")
        .unwrap_or_else(|_| "assets".to_string())
        .into();
    if let Err(e) = tokio::fs::create_dir_all(&assets_dir).await {
        tracing::warn!(
            error = %e,
            path = %assets_dir.display(),
            "failed to ensure assets directory exists"
        );
    }
    // Asset metadata index lives next to the assets directory.
    // ASSET_INDEX env var overrides for deploys that want index +
    // assets in different locations (e.g. index on local disk,
    // assets on a remote volume).
    let asset_index_path: std::path::PathBuf = std::env::var("ASSET_INDEX")
        .unwrap_or_else(|_| {
            assets_dir
                .parent()
                .unwrap_or(std::path::Path::new("."))
                .join("assets.json")
                .display()
                .to_string()
        })
        .into();
    // Per ADR-008: recipes live in their own JSON file, sibling to
    // the snapshot + asset index by default. Configurable so deploys
    // can put recipes on a separate persistent volume.
    let recipes_path: std::path::PathBuf = std::env::var("RECIPES_FILE")
        .unwrap_or_else(|_| "recipes.json".to_string())
        .into();

    let state = AppState::new(
        admin_token,
        assets_dir.clone(),
        asset_index_path.clone(),
        recipes_path.clone(),
    );

    // Restore the asset registry from disk. Same graceful policy
    // as the entity snapshot — missing file is cold start, parse
    // errors are logged and we proceed with an empty index.
    {
        match assets::load_index(&asset_index_path).await {
            Ok(loaded) => {
                let n = loaded.len();
                *state.asset_registry.write().await = loaded;
                tracing::info!(
                    restored = n,
                    path = %asset_index_path.display(),
                    "loaded asset index"
                );
            }
            Err(e) => tracing::warn!(
                error = %e,
                path = %asset_index_path.display(),
                "asset index load failed; starting empty"
            ),
        }
    }

    // Restore prior admin-authored scene state from disk. Missing
    // file is OK (cold start). Corrupt or version-mismatched file
    // is logged and we proceed empty rather than refuse to start
    // — losing operator scenes is preferable to a server stuck on
    // boot.
    {
        let mut registry = state.registry.write().await;
        match snapshot::load(&snapshot_path, &mut registry).await {
            Ok(count) => tracing::info!(
                restored = count,
                path = %snapshot_path.display(),
                "loaded scene snapshot"
            ),
            Err(e) => tracing::warn!(
                error = %e,
                path = %snapshot_path.display(),
                "snapshot load failed; starting empty"
            ),
        }
    }
    snapshot::precheck_writable(&snapshot_path).await;

    // Restore admin-authored effect recipes (per ADR-008).
    // Missing file = cold start; corrupt / version-mismatched =
    // logged and we proceed with an empty store. Recipes are
    // small enough that startup load is instant.
    {
        match recipes::load_recipes(&recipes_path).await {
            Ok(loaded) => {
                let n = loaded.len();
                *state.recipe_store.write().await = loaded;
                tracing::info!(
                    restored = n,
                    path = %recipes_path.display(),
                    "loaded recipe store"
                );
            }
            Err(e) => tracing::warn!(
                error = %e,
                path = %recipes_path.display(),
                "recipe store load failed; starting empty"
            ),
        }
    }

    // Spawn the 30 Hz authoritative tick loop. Returns a JoinHandle
    // we deliberately drop — the task lives for the lifetime of
    // the process; tokio cancels it on graceful shutdown.
    let _tick_handle = tick::spawn(state.clone());
    let _snapshot_handle = snapshot::spawn(state.clone(), snapshot_path, snapshot_interval);

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let app = Router::new()
        .route("/health", get(handlers::health_check))
        .route("/ws", get(handlers::ws_upgrade))
        // Admin-only HTTP trigger for one-shot SceneEvents — lets
        // an operator fire any registered event variant at any
        // position without joining the game (per ADR-006). Auth
        // via Authorization: Bearer <ADMIN_TOKEN>.
        .route("/api/admin/event", post(handlers::post_admin_event))
        // Admin-only asset upload (per ADR-007). Body is raw
        // bytes; ?ext=mp3 query param sets the file extension.
        // Returns the content-addressed URL.
        .route("/api/admin/assets", post(handlers::post_admin_asset))
        // Admin-only listing of all uploaded assets — admin UI's
        // asset picker reads from here.
        .route("/api/admin/assets", get(handlers::get_admin_assets))
        // Admin-only recipe management (per ADR-008). Recipes are
        // JSON-defined sequences of SceneEvents that can be
        // triggered at any position without redeploy.
        .route("/api/admin/recipes", get(handlers::get_admin_recipes))
        .route("/api/admin/recipes", post(handlers::post_admin_recipe))
        .route(
            "/api/admin/recipes/:id",
            axum::routing::delete(handlers::delete_admin_recipe),
        )
        .route(
            "/api/admin/play_recipe",
            post(handlers::post_admin_play_recipe),
        )
        // Admin-only player management (per ADR-009).
        .route("/api/admin/players", get(handlers::get_admin_players))
        .route("/api/admin/kick", post(handlers::post_admin_kick))
        .route("/api/admin/freeze", post(handlers::post_admin_freeze))
        .route(
            "/api/admin/teleport_player",
            post(handlers::post_admin_teleport_player),
        )
        .route(
            "/api/admin/set_cursor",
            post(handlers::post_admin_set_cursor),
        )
        // Public static serving of uploaded assets. Content-
        // addressed URLs mean these are safe to cache aggressively;
        // ServeDir handles MIME types + byte-range requests.
        .nest_service("/assets", ServeDir::new(&assets_dir))
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
