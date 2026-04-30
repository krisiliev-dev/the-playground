//! Shared application state.
//!
//! All mutable state is behind `Arc<RwLock<_>>` for safe concurrent access.
//! The state is intentionally minimal: we only store what's needed for
//! message relay and live environment editing.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::{broadcast, RwLock, Semaphore};
use uuid::Uuid;

use crate::video::JobStore;

/// Maximum concurrent WebSocket connections.
/// Protects against connection-flooding attacks.
pub const MAX_CONNECTIONS: usize = 100;

/// Maximum connections per IP address.
pub const MAX_CONNECTIONS_PER_IP: usize = 5;

// ─── Types ───────────────────────────────────────────────────────

/// A connected player session.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlayerSession {
    pub id: String,
    pub position: [f32; 3],
    pub rotation: [f32; 3],
    pub name: String,
    pub cursor_color: String,
}

/// Messages broadcast to all connected clients.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum BroadcastMessage {
    /// A player moved — relay their new position.
    #[serde(rename = "player_update")]
    PlayerUpdate { player: PlayerSession },

    /// A player disconnected.
    #[serde(rename = "player_left")]
    PlayerLeft { id: String },

    /// The environment config was changed (live editing).
    #[serde(rename = "environment_update")]
    EnvironmentUpdate { config: serde_json::Value },
}

// ─── App State ───────────────────────────────────────────────────

/// Thread-safe shared state, passed to all request handlers.
///
/// Uses `Arc` so it can be cheaply cloned across async tasks.
/// Internal fields use `RwLock` for concurrent read access with
/// exclusive write access.
#[derive(Clone)]
pub struct AppState {
    /// Currently connected players, keyed by session ID.
    pub sessions: Arc<RwLock<HashMap<String, PlayerSession>>>,

    /// Connection count per IP address (for rate limiting).
    pub connections_per_ip: Arc<RwLock<HashMap<String, usize>>>,

    /// The current environment configuration (mutable for live editing).
    pub environment: Arc<RwLock<serde_json::Value>>,

    /// Broadcast channel — sends messages to all connected WebSocket clients.
    /// Capacity of 256 messages buffered; slow readers will miss old messages.
    pub broadcast_tx: broadcast::Sender<BroadcastMessage>,

    /// Video conversion job store (persisted to disk).
    pub video_jobs: JobStore,

    /// Serializes heavy video pipelines — permits = 1 to protect RAM.
    pub video_semaphore: Arc<Semaphore>,

    /// Directory where converted MP4s are saved (served by nginx).
    pub videos_dir: PathBuf,

    /// Public URL prefix where the videos directory is exposed
    /// (e.g. "https://krisiliev.dev/videos").
    pub videos_public_prefix: String,

    /// Bearer token required for admin endpoints.
    pub admin_token: String,
}

impl AppState {
    /// Create a new instance with default values.
    pub async fn new(
        videos_dir: PathBuf,
        videos_public_prefix: String,
        admin_token: String,
    ) -> Self {
        let (broadcast_tx, _) = broadcast::channel(256);

        // Create videos dir if missing and load/persist the jobs file there.
        let _ = tokio::fs::create_dir_all(&videos_dir).await;
        let jobs_path = videos_dir.join("jobs.json");
        let video_jobs = JobStore::load(jobs_path).await;

        Self {
            sessions: Arc::new(RwLock::new(HashMap::new())),
            connections_per_ip: Arc::new(RwLock::new(HashMap::new())),
            environment: Arc::new(RwLock::new(Self::default_environment())),
            broadcast_tx,
            video_jobs,
            video_semaphore: Arc::new(Semaphore::new(1)),
            videos_dir,
            videos_public_prefix,
            admin_token,
        }
    }

    /// Default environment config — matches the client-side defaults.
    /// In production, this would be loaded from a file or database.
    fn default_environment() -> serde_json::Value {
        serde_json::json!({
            "dimensions": [40, 30, 40],
            "ambientColor": "#1a1a2e",
            "ambientIntensity": 0.4,
            "fog": {
                "color": "#1a1a2e",
                "near": 10,
                "far": 50
            },
            "zones": [
                {
                    "id": "portfolio",
                    "label": "Projects",
                    "position": [-12, 0, -10],
                    "lookAt": [-12, 0, -15],
                    "type": "portfolio"
                },
                {
                    "id": "about",
                    "label": "About Me",
                    "position": [0, 0, -15],
                    "lookAt": [0, 0, -20],
                    "type": "about"
                },
                {
                    "id": "social",
                    "label": "Social",
                    "position": [12, 0, -10],
                    "lookAt": [12, 0, -15],
                    "type": "social"
                },
                {
                    "id": "contact",
                    "label": "Contact",
                    "position": [0, -8, -10],
                    "lookAt": [0, -8, -15],
                    "type": "contact"
                }
            ]
        })
    }

    /// Check if a new connection from the given IP is allowed.
    pub async fn can_connect(&self, ip: &str) -> bool {
        let sessions = self.sessions.read().await;
        if sessions.len() >= MAX_CONNECTIONS {
            return false;
        }

        let per_ip = self.connections_per_ip.read().await;
        let count = per_ip.get(ip).unwrap_or(&0);
        *count < MAX_CONNECTIONS_PER_IP
    }

    /// Register a new connection from the given IP.
    pub async fn register_connection(&self, ip: &str) -> String {
        let id = Uuid::new_v4().to_string();

        let session = PlayerSession {
            id: id.clone(),
            position: [0.0, 0.0, 5.0],
            rotation: [0.0, 0.0, 0.0],
            name: "Guest".into(),
            cursor_color: "#00ff88".into(),
        };

        self.sessions.write().await.insert(id.clone(), session);

        let mut per_ip = self.connections_per_ip.write().await;
        *per_ip.entry(ip.to_string()).or_insert(0) += 1;

        id
    }

    /// Remove a connection and clean up.
    pub async fn remove_connection(&self, id: &str, ip: &str) {
        self.sessions.write().await.remove(id);

        let mut per_ip = self.connections_per_ip.write().await;
        if let Some(count) = per_ip.get_mut(ip) {
            *count = count.saturating_sub(1);
            if *count == 0 {
                per_ip.remove(ip);
            }
        }

        // Notify other clients that this player left
        let _ = self
            .broadcast_tx
            .send(BroadcastMessage::PlayerLeft { id: id.to_string() });
    }
}
