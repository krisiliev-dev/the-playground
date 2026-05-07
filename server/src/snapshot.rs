//! Periodic disk persistence for admin-authored scene state.
//!
//! Per ADR-004: write the entity registry to `state.json` on a
//! cadence (default 30s) and on graceful shutdown; restore on
//! boot. Player entities are ephemeral (tied to WebSocket
//! lifetime) so they're filtered out — only admin-authored
//! entities (Portal, Model, Text, …) round-trip through disk.
//!
//! Atomic writes via `write to .tmp + rename` so a crash
//! mid-flush leaves the previous snapshot intact rather than
//! a half-written corrupt file. The OS's atomic-rename
//! guarantee on the same filesystem covers us; we don't try
//! to be clever with fsync ordering.
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tokio::fs;
use tokio::time::interval;
use tracing::{error, info, warn};

use crate::entity::{Entity, EntityKind};
use crate::registry::EntityRegistry;
use crate::state::AppState;

/// How often to persist scene state to disk. 30 s is a balance
/// between "admin work survives an unexpected restart" and "disk
/// thrash on a busy edit session." Adjustable per deployment via
/// the `SNAPSHOT_INTERVAL_SECS` environment variable in main.rs.
pub const DEFAULT_SNAPSHOT_INTERVAL_SECS: u64 = 30;

/// Versioned snapshot envelope. `version` lets us evolve the
/// on-disk format without silently corrupting older files —
/// future loads will branch on it. For v1 the payload is just
/// the entity list.
#[derive(Debug, Serialize, Deserialize)]
struct Snapshot {
    version: u32,
    entities: Vec<Entity>,
}

const CURRENT_VERSION: u32 = 1;

/// Build a snapshot from the registry, filtering out ephemeral
/// player entities. Pure / synchronous — caller passes a
/// pre-acquired snapshot vec to avoid holding the registry lock
/// across the disk write.
fn build_snapshot(entities: Vec<Entity>) -> Snapshot {
    Snapshot {
        version: CURRENT_VERSION,
        entities: entities
            .into_iter()
            .filter(|e| e.kind != EntityKind::Player)
            .collect(),
    }
}

/// Write the current scene to disk. Returns the entity count
/// persisted (excluding players) so callers can log it.
pub async fn save(state: &AppState, path: &Path) -> Result<usize, std::io::Error> {
    let entities = state.registry.read().await.snapshot();
    let snapshot = build_snapshot(entities);
    let count = snapshot.entities.len();

    let json = serde_json::to_vec_pretty(&snapshot).map_err(std::io::Error::other)?;

    // Atomic rename: write `<path>.tmp`, then rename over
    // `<path>`. Same filesystem guaranteed since the temp file
    // is sibling to the target.
    let tmp_path: PathBuf = path.with_extension("json.tmp");
    fs::write(&tmp_path, &json).await?;
    fs::rename(&tmp_path, path).await?;
    Ok(count)
}

/// Load a snapshot from disk into the supplied (presumably
/// empty) registry. Missing file is treated as "no prior state"
/// and returns 0; corrupt JSON returns the parse error so
/// callers can decide whether to abort or proceed empty.
pub async fn load(path: &Path, registry: &mut EntityRegistry) -> Result<usize, LoadError> {
    let bytes = match fs::read(path).await {
        Ok(b) => b,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(0),
        Err(e) => return Err(LoadError::Io(e)),
    };
    let snapshot: Snapshot = serde_json::from_slice(&bytes).map_err(LoadError::Parse)?;
    if snapshot.version != CURRENT_VERSION {
        return Err(LoadError::UnsupportedVersion {
            found: snapshot.version,
            expected: CURRENT_VERSION,
        });
    }
    let count = snapshot.entities.len();
    for entity in snapshot.entities {
        registry.insert(entity);
    }
    Ok(count)
}

#[derive(Debug)]
pub enum LoadError {
    Io(std::io::Error),
    Parse(serde_json::Error),
    UnsupportedVersion { found: u32, expected: u32 },
}

impl std::fmt::Display for LoadError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Io(e) => write!(f, "io error: {e}"),
            Self::Parse(e) => write!(f, "parse error: {e}"),
            Self::UnsupportedVersion { found, expected } => {
                write!(
                    f,
                    "unsupported snapshot version {found} (expected {expected})"
                )
            }
        }
    }
}

impl std::error::Error for LoadError {}

/// Spawn the periodic save loop. Caller drops the handle; task
/// runs for the process lifetime.
pub fn spawn(state: AppState, path: PathBuf, interval_secs: u64) -> tokio::task::JoinHandle<()> {
    let period = Duration::from_secs(interval_secs);
    tokio::spawn(async move {
        let mut ticker = interval(period);
        // First tick fires immediately; skip it so we don't
        // overwrite a freshly-loaded snapshot with an empty
        // registry on startup.
        ticker.tick().await;

        loop {
            ticker.tick().await;
            match save(&state, &path).await {
                Ok(count) => info!(persisted = count, path = %path.display(), "snapshot saved"),
                Err(e) => error!(error = %e, path = %path.display(), "snapshot save failed"),
            }
        }
    })
}

/// One-shot save called at process startup *before* the periodic
/// loop, used to validate that the configured path is writable.
/// If this fails, log a warning — the process keeps running, but
/// nothing will be persisted.
pub async fn precheck_writable(path: &Path) -> bool {
    let probe: PathBuf = path.with_extension("json.probe");
    match fs::write(&probe, b"").await {
        Ok(()) => {
            let _ = fs::remove_file(&probe).await;
            true
        }
        Err(e) => {
            warn!(error = %e, path = %path.display(), "snapshot path is not writable");
            false
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::entity::{Entity, Transform};
    use tempfile::TempDir;

    fn portal() -> Entity {
        Entity::new(
            EntityKind::Portal,
            Transform::identity(),
            serde_json::json!({}),
        )
    }
    fn player() -> Entity {
        Entity::new(
            EntityKind::Player,
            Transform::identity(),
            serde_json::json!({}),
        )
    }

    #[test]
    fn build_snapshot_filters_out_players() {
        let entities = vec![portal(), player(), portal()];
        let snap = build_snapshot(entities);
        assert_eq!(snap.entities.len(), 2);
        assert!(snap.entities.iter().all(|e| e.kind != EntityKind::Player));
    }

    #[tokio::test]
    async fn save_then_load_round_trip() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("state.json");

        let state = AppState::new(String::new());
        let portal_a_id = {
            let mut reg = state.registry.write().await;
            let id = reg.insert(portal());
            reg.insert(portal());
            // Player should be filtered out of the persisted snapshot.
            reg.insert(player());
            id
        };

        let written = save(&state, &path).await.unwrap();
        assert_eq!(written, 2, "players excluded from persisted count");

        let mut fresh = EntityRegistry::new();
        let loaded = load(&path, &mut fresh).await.unwrap();
        assert_eq!(loaded, 2);
        assert!(
            fresh.get(&portal_a_id).is_some(),
            "portal survived round trip"
        );
    }

    #[tokio::test]
    async fn load_missing_file_is_ok() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("does-not-exist.json");
        let mut fresh = EntityRegistry::new();
        let loaded = load(&path, &mut fresh).await.unwrap();
        assert_eq!(loaded, 0);
        assert!(fresh.is_empty());
    }

    #[tokio::test]
    async fn load_corrupt_file_returns_error() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("corrupt.json");
        fs::write(&path, b"not json").await.unwrap();
        let mut fresh = EntityRegistry::new();
        let result = load(&path, &mut fresh).await;
        assert!(matches!(result, Err(LoadError::Parse(_))));
    }

    #[tokio::test]
    async fn load_wrong_version_returns_error() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("v999.json");
        let bad = serde_json::json!({ "version": 999, "entities": [] });
        fs::write(&path, serde_json::to_vec(&bad).unwrap())
            .await
            .unwrap();
        let mut fresh = EntityRegistry::new();
        let result = load(&path, &mut fresh).await;
        assert!(matches!(
            result,
            Err(LoadError::UnsupportedVersion {
                found: 999,
                expected: 1
            })
        ));
    }
}
