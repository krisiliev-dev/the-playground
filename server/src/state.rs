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
use std::sync::Arc;

use tokio::sync::{broadcast, RwLock};

use crate::protocol::ServerMessage;
use crate::registry::EntityRegistry;

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
}

impl AppState {
    pub fn new(admin_token: String) -> Self {
        let (broadcast_tx, _) = broadcast::channel(BROADCAST_CAPACITY);
        Self {
            registry: Arc::new(RwLock::new(EntityRegistry::new())),
            connections_per_ip: Arc::new(RwLock::new(HashMap::new())),
            broadcast_tx,
            admin_token,
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
