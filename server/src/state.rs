//! Shared application state.
//!
//! Per ADR-004 the server is authoritative — `AppState.registry`
//! is the single source of truth for the scene. The broadcast
//! channel is how the tick loop fans state diffs out to every
//! connected client; per-IP connection counts protect against
//! flood attacks.
//!
//! Everything mutable is behind `Arc<RwLock<_>>` so handlers,
//! the tick loop, and the snapshot writer can all touch state
//! concurrently.
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use tokio::sync::{broadcast, RwLock};

use crate::assets::AssetRegistry;
use crate::protocol::ServerMessage;
use crate::recipes::RecipeStore;
use crate::registry::EntityRegistry;
use crate::scene_event::RateTracker;

/// Maximum simultaneous WebSocket connections, server-wide.
pub const MAX_CONNECTIONS: usize = 100;

/// Maximum simultaneous WebSocket connections from one IP.
/// Stops a single tab-spammer from saturating the pool.
pub const MAX_CONNECTIONS_PER_IP: usize = 5;

/// Capacity of the broadcast channel. Slow readers that fall
/// behind by more than this many messages will get a `Lagged`
/// error and skip the missed messages — they'll catch up
/// from the next `EntityUpdates` tick.
pub const BROADCAST_CAPACITY: usize = 256;

#[derive(Clone)]
pub struct AppState {
    pub registry: Arc<RwLock<EntityRegistry>>,
    pub connections_per_ip: Arc<RwLock<HashMap<String, usize>>>,
    pub broadcast_tx: broadcast::Sender<ServerMessage>,
    /// Bearer token required on the `?token=` query param at WS
    /// upgrade for the connection to receive admin permissions.
    /// Empty string ⇒ no admin can ever authenticate (read-only
    /// dev / preview environments).
    pub admin_token: String,
    /// Per-actor sliding-window rate tracker for SceneEvent
    /// validation (ADR-006). Each connected client's events are
    /// counted here; excess events are silently dropped from
    /// rebroadcast. Cleared per-actor on disconnect via
    /// `RateTracker::forget`.
    pub event_rate: Arc<RwLock<RateTracker>>,
    /// Filesystem directory where admin-uploaded assets land
    /// (per ADR-007). Configured via env var in main.rs;
    /// defaults to `./assets/` next to the binary.
    pub assets_dir: PathBuf,
    /// Persistent index of uploaded assets. Loaded from
    /// `assets.json` on boot, written atomically after each
    /// successful upload so admin-authored assets survive
    /// restarts. Wrapped in RwLock for concurrent reads (list
    /// endpoint) + exclusive writes (upload handler).
    pub asset_registry: Arc<RwLock<AssetRegistry>>,
    /// Path to the on-disk asset index file. Sibling to
    /// `assets_dir` itself by default.
    pub asset_index_path: PathBuf,
    /// Persistent store of admin-authored effect recipes
    /// (per ADR-008). Loaded from `recipes.json` on boot,
    /// rewritten atomically after every upsert/delete so
    /// authored recipes survive restarts.
    pub recipe_store: Arc<RwLock<RecipeStore>>,
    /// Path to the on-disk recipe store file. Configurable via
    /// `RECIPES_FILE` env var.
    pub recipes_path: PathBuf,
}

impl AppState {
    pub fn new(
        admin_token: String,
        assets_dir: PathBuf,
        asset_index_path: PathBuf,
        recipes_path: PathBuf,
    ) -> Self {
        let (broadcast_tx, _) = broadcast::channel(BROADCAST_CAPACITY);
        Self {
            registry: Arc::new(RwLock::new(EntityRegistry::new())),
            connections_per_ip: Arc::new(RwLock::new(HashMap::new())),
            broadcast_tx,
            admin_token,
            event_rate: Arc::new(RwLock::new(RateTracker::new())),
            assets_dir,
            asset_registry: Arc::new(RwLock::new(AssetRegistry::new())),
            asset_index_path,
            recipe_store: Arc::new(RwLock::new(RecipeStore::new())),
            recipes_path,
        }
    }

    /// Total live connections (counted across all IPs).
    pub async fn total_connections(&self) -> usize {
        self.connections_per_ip
            .read()
            .await
            .values()
            .copied()
            .sum::<usize>()
    }

    /// Whether a new connection from `ip` is currently allowed.
    /// Race window between this check and `register_connection`
    /// is small but tolerated — the slop is bounded by `MAX_*`.
    pub async fn can_connect(&self, ip: &str) -> bool {
        if self.total_connections().await >= MAX_CONNECTIONS {
            return false;
        }
        let per_ip = self.connections_per_ip.read().await;
        per_ip.get(ip).copied().unwrap_or(0) < MAX_CONNECTIONS_PER_IP
    }

    /// Increment the per-IP connection counter. Pair with
    /// `release_connection` on disconnect; missing the release
    /// would leak a slot until process restart.
    pub async fn register_connection(&self, ip: &str) {
        let mut per_ip = self.connections_per_ip.write().await;
        *per_ip.entry(ip.to_string()).or_insert(0) += 1;
    }

    pub async fn release_connection(&self, ip: &str) {
        let mut per_ip = self.connections_per_ip.write().await;
        if let Some(count) = per_ip.get_mut(ip) {
            *count = count.saturating_sub(1);
            if *count == 0 {
                per_ip.remove(ip);
            }
        }
    }
}
