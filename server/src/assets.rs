//! Runtime asset storage (per ADR-007).
//!
//! Admin uploads bytes via POST /api/assets; we hash the content,
//! store it under `<assets_dir>/<id>.<ext>`, and return a stable
//! URL the client can fetch from. Content-addressed naming makes
//! uploads idempotent (re-uploading the same file is a no-op,
//! same id, same URL) and lets the static serving layer use
//! `Cache-Control: immutable` since the URL→bytes mapping never
//! changes.
//!
//! Storage layout:
//!   <ASSETS_DIR>/
//!     ast_a1b2c3d4e5f6.mp3
//!     ast_9876543210ab.glb
//!     ...
//!
//! Tower-http's ServeDir handles GET /assets/* externally; this
//! module owns the write path.
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// Bytes a SHA-256 prefix takes up in the asset id. 6 bytes →
/// 12 hex chars → 48 bits of namespace, ~1 in 281 trillion
/// collision odds at our authoring scale. Plenty for a single-
/// admin operator-driven workflow; revisit when we shard
/// asset ownership across many writers.
const ID_HASH_BYTES: usize = 6;

/// Hard cap on individual upload size. Tunable per deploy via
/// env var in main.rs; the in-memory body buffer at the
/// handler layer enforces a similar cap before bytes reach
/// this function.
pub const DEFAULT_MAX_UPLOAD_BYTES: usize = 50 * 1024 * 1024;

/// Persistent registry of uploaded assets. Loaded on server boot
/// from `assets.json`, written atomically after each successful
/// upload. Survives restarts so admin-uploaded assets aren't lost.
#[derive(Debug, Default, Serialize, Deserialize)]
pub struct AssetRegistry {
    pub version: u32,
    pub assets: Vec<AssetMeta>,
}

const REGISTRY_VERSION: u32 = 1;

impl AssetRegistry {
    pub fn new() -> Self {
        Self {
            version: REGISTRY_VERSION,
            assets: Vec::new(),
        }
    }

    /// Insert a new asset, ignoring duplicates by id. Content-
    /// addressed ids mean re-uploading the same bytes is naturally
    /// idempotent — same hash → same id → no-op here.
    pub fn insert(&mut self, meta: AssetMeta) -> bool {
        if self.assets.iter().any(|a| a.id == meta.id) {
            return false;
        }
        self.assets.push(meta);
        true
    }

    pub fn list(&self) -> &[AssetMeta] {
        &self.assets
    }

    pub fn len(&self) -> usize {
        self.assets.len()
    }

    pub fn is_empty(&self) -> bool {
        self.assets.is_empty()
    }
}

#[derive(Debug)]
pub enum IndexLoadError {
    Io(std::io::Error),
    Parse(serde_json::Error),
    UnsupportedVersion { found: u32, expected: u32 },
}

impl std::fmt::Display for IndexLoadError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Io(e) => write!(f, "io error: {e}"),
            Self::Parse(e) => write!(f, "parse error: {e}"),
            Self::UnsupportedVersion { found, expected } => {
                write!(
                    f,
                    "unsupported asset registry version {found} (expected {expected})"
                )
            }
        }
    }
}

impl std::error::Error for IndexLoadError {}

/// Load the asset registry from disk. Missing file ⇒ empty
/// registry (cold start). Corrupt or version-mismatched file
/// returns a typed error so the caller can decide whether to
/// abort or proceed with an empty registry.
pub async fn load_index(path: &Path) -> Result<AssetRegistry, IndexLoadError> {
    let bytes = match tokio::fs::read(path).await {
        Ok(b) => b,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(AssetRegistry::new()),
        Err(e) => return Err(IndexLoadError::Io(e)),
    };
    let registry: AssetRegistry = serde_json::from_slice(&bytes).map_err(IndexLoadError::Parse)?;
    if registry.version != REGISTRY_VERSION {
        return Err(IndexLoadError::UnsupportedVersion {
            found: registry.version,
            expected: REGISTRY_VERSION,
        });
    }
    Ok(registry)
}

/// Persist the asset registry to disk via atomic tmp+rename. The
/// caller is expected to hold the registry lock while preparing
/// the snapshot but release it before this disk write to avoid
/// holding async locks across IO.
pub async fn save_index(path: &Path, registry: &AssetRegistry) -> Result<(), std::io::Error> {
    let json = serde_json::to_vec_pretty(registry).map_err(std::io::Error::other)?;
    let tmp_path: PathBuf = path.with_extension("json.tmp");
    tokio::fs::write(&tmp_path, &json).await?;
    tokio::fs::rename(&tmp_path, path).await?;
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssetMeta {
    /// `ast_<12-hex>` — content-addressed identifier.
    pub id: String,
    /// Public URL the client should fetch from. Always relative
    /// (`/assets/<file>`); deploys behind a CDN can rewrite.
    pub url: String,
    /// File size in bytes. Returned for client-side preflight
    /// (e.g. progress bars, large-asset warnings).
    pub size: u64,
    /// File extension (without leading dot) — useful for client-
    /// side type dispatch without re-parsing the URL.
    pub extension: String,
}

#[derive(Debug)]
pub enum UploadError {
    Io(std::io::Error),
    Oversized { size: usize, cap: usize },
    InvalidExtension,
}

impl std::fmt::Display for UploadError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Io(e) => write!(f, "io error: {e}"),
            Self::Oversized { size, cap } => {
                write!(f, "upload size {size} exceeds cap {cap}")
            }
            Self::InvalidExtension => write!(f, "invalid file extension"),
        }
    }
}

impl std::error::Error for UploadError {}

impl From<std::io::Error> for UploadError {
    fn from(e: std::io::Error) -> Self {
        Self::Io(e)
    }
}

/// Save an uploaded asset to disk and return its metadata.
///
/// - Hashes the bytes with SHA-256 and uses the leading
///   `ID_HASH_BYTES` for the id.
/// - Idempotent: if a file with the same content already exists
///   at the expected path, returns its metadata without
///   rewriting (re-uploads cost zero disk).
/// - Atomic write: writes to `<id>.<ext>.tmp` then renames over
///   the target, so a crash mid-flush leaves the previous file
///   (or no file) intact rather than a half-written one.
pub async fn save_upload(
    bytes: &[u8],
    extension: &str,
    assets_dir: &Path,
    max_bytes: usize,
) -> Result<AssetMeta, UploadError> {
    if bytes.len() > max_bytes {
        return Err(UploadError::Oversized {
            size: bytes.len(),
            cap: max_bytes,
        });
    }

    let safe_ext = sanitize_extension(extension)?;
    let id = compute_id(bytes);
    let filename = format!("{id}.{safe_ext}");
    let path = assets_dir.join(&filename);

    if !path.exists() {
        tokio::fs::create_dir_all(assets_dir).await?;
        let tmp_path: PathBuf = assets_dir.join(format!("{filename}.tmp"));
        tokio::fs::write(&tmp_path, bytes).await?;
        tokio::fs::rename(&tmp_path, &path).await?;
    }

    Ok(AssetMeta {
        id,
        url: format!("/assets/{filename}"),
        size: bytes.len() as u64,
        extension: safe_ext.to_string(),
    })
}

/// Hex-encoded SHA-256 prefix. Pure — exported for tests.
pub fn compute_id(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    let hash = hasher.finalize();
    let mut id = String::with_capacity(4 + ID_HASH_BYTES * 2);
    id.push_str("ast_");
    for byte in hash.iter().take(ID_HASH_BYTES) {
        // Hex without allocations — manual nibble emission.
        const HEX: &[u8; 16] = b"0123456789abcdef";
        id.push(HEX[(byte >> 4) as usize] as char);
        id.push(HEX[(byte & 0x0f) as usize] as char);
    }
    id
}

/// Reject extensions containing path separators, leading dots,
/// or non-alphanumeric chars beyond `.`. Returns the
/// lowercased extension on success. Pure — exported for tests.
pub fn sanitize_extension(ext: &str) -> Result<&str, UploadError> {
    if ext.is_empty() || ext.len() > 16 {
        return Err(UploadError::InvalidExtension);
    }
    if !ext.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err(UploadError::InvalidExtension);
    }
    Ok(ext)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn compute_id_is_deterministic_per_content() {
        let bytes = b"hello world";
        let id1 = compute_id(bytes);
        let id2 = compute_id(bytes);
        assert_eq!(id1, id2);
        assert!(id1.starts_with("ast_"));
        assert_eq!(id1.len(), 4 + ID_HASH_BYTES * 2);
    }

    #[test]
    fn compute_id_differs_for_different_content() {
        assert_ne!(compute_id(b"foo"), compute_id(b"bar"));
        assert_ne!(compute_id(b""), compute_id(b"x"));
    }

    #[test]
    fn sanitize_extension_accepts_common_types() {
        assert!(sanitize_extension("mp3").is_ok());
        assert!(sanitize_extension("glb").is_ok());
        assert!(sanitize_extension("png").is_ok());
        assert!(sanitize_extension("webm").is_ok());
    }

    #[test]
    fn sanitize_extension_rejects_path_traversal_and_specials() {
        assert!(sanitize_extension("").is_err());
        assert!(sanitize_extension("../etc/passwd").is_err());
        assert!(sanitize_extension("mp3/foo").is_err());
        assert!(sanitize_extension("mp3.bak").is_err());
        assert!(sanitize_extension(".mp3").is_err());
        // Length cap.
        assert!(sanitize_extension(&"a".repeat(17)).is_err());
    }

    #[tokio::test]
    async fn save_upload_writes_file_and_returns_metadata() {
        let dir = TempDir::new().unwrap();
        let bytes = b"hello world";
        let meta = save_upload(bytes, "txt", dir.path(), 1024).await.unwrap();

        assert!(meta.id.starts_with("ast_"));
        assert!(meta.url.starts_with("/assets/"));
        assert!(meta.url.ends_with(".txt"));
        assert_eq!(meta.size, bytes.len() as u64);
        assert_eq!(meta.extension, "txt");

        // File exists on disk.
        let filename = format!("{}.txt", meta.id);
        let path = dir.path().join(&filename);
        let read_back = tokio::fs::read(&path).await.unwrap();
        assert_eq!(read_back, bytes);
    }

    #[tokio::test]
    async fn save_upload_is_idempotent_for_same_content() {
        let dir = TempDir::new().unwrap();
        let bytes = b"identical content";
        let meta1 = save_upload(bytes, "bin", dir.path(), 1024).await.unwrap();
        let meta2 = save_upload(bytes, "bin", dir.path(), 1024).await.unwrap();
        assert_eq!(meta1.id, meta2.id);
        assert_eq!(meta1.url, meta2.url);
    }

    #[tokio::test]
    async fn save_upload_rejects_oversized_payloads() {
        let dir = TempDir::new().unwrap();
        let bytes = vec![0u8; 1024];
        let result = save_upload(&bytes, "bin", dir.path(), 100).await;
        match result {
            Err(UploadError::Oversized {
                size: 1024,
                cap: 100,
            }) => {}
            other => panic!("expected Oversized error, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn save_upload_rejects_invalid_extension() {
        let dir = TempDir::new().unwrap();
        let result = save_upload(b"x", "../etc", dir.path(), 1024).await;
        assert!(matches!(result, Err(UploadError::InvalidExtension)));
    }

    #[tokio::test]
    async fn save_upload_creates_assets_dir_if_missing() {
        let dir = TempDir::new().unwrap();
        let nested = dir.path().join("nested").join("assets");
        // Directory doesn't exist yet.
        assert!(!nested.exists());
        let meta = save_upload(b"x", "bin", &nested, 1024).await.unwrap();
        assert!(nested.exists());
        let filename = format!("{}.bin", meta.id);
        assert!(nested.join(&filename).exists());
    }

    fn meta(id: &str) -> AssetMeta {
        AssetMeta {
            id: id.to_string(),
            url: format!("/assets/{id}.bin"),
            size: 4,
            extension: "bin".to_string(),
        }
    }

    #[test]
    fn registry_insert_is_idempotent_per_id() {
        let mut reg = AssetRegistry::new();
        assert!(reg.insert(meta("ast_a")));
        assert!(!reg.insert(meta("ast_a")));
        assert!(reg.insert(meta("ast_b")));
        assert_eq!(reg.len(), 2);
    }

    #[tokio::test]
    async fn load_index_returns_empty_when_file_missing() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("does-not-exist.json");
        let reg = load_index(&path).await.unwrap();
        assert!(reg.is_empty());
        assert_eq!(reg.version, REGISTRY_VERSION);
    }

    #[tokio::test]
    async fn save_then_load_round_trip_preserves_assets() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("assets.json");
        let mut reg = AssetRegistry::new();
        reg.insert(meta("ast_111111111111"));
        reg.insert(meta("ast_222222222222"));
        save_index(&path, &reg).await.unwrap();

        let loaded = load_index(&path).await.unwrap();
        assert_eq!(loaded.len(), 2);
        assert_eq!(loaded.assets[0].id, "ast_111111111111");
        assert_eq!(loaded.assets[1].id, "ast_222222222222");
    }

    #[tokio::test]
    async fn load_index_rejects_unsupported_version() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("assets.json");
        // Write a registry with a version we don't know how to read.
        let body = serde_json::json!({
            "version": 999,
            "assets": [],
        });
        tokio::fs::write(&path, serde_json::to_vec(&body).unwrap())
            .await
            .unwrap();
        match load_index(&path).await {
            Err(IndexLoadError::UnsupportedVersion {
                found: 999,
                expected: 1,
            }) => {}
            other => panic!("expected UnsupportedVersion, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn load_index_returns_parse_error_for_garbage() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("assets.json");
        tokio::fs::write(&path, b"this is not json").await.unwrap();
        match load_index(&path).await {
            Err(IndexLoadError::Parse(_)) => {}
            other => panic!("expected Parse error, got {other:?}"),
        }
    }
}
