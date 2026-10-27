//! Video processing module.
//!
//! Handles the admin pipeline: download a YouTube 360° video with yt-dlp,
//! convert from EAC to equirectangular with ffmpeg, and serve the result.
//!
//! Jobs are tracked in memory and persisted to `jobs.json` on disk so they
//! survive a server restart.

use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tokio::fs;
use tokio::process::Command;
use tokio::sync::{RwLock, Semaphore};
use tracing::{error, info, warn};
use uuid::Uuid;

// ─── Types ───────────────────────────────────────────────────────

/// Stage-by-stage status of a single conversion job.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum JobStatus {
    Queued,
    Downloading,
    Converting,
    Ready { url: String },
    Failed { error: String },
}

/// A single video conversion job.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VideoJob {
    pub id: String,
    pub youtube_url: String,
    pub name: String,
    pub status: JobStatus,
    pub created_at: String,
    pub updated_at: String,
}

impl VideoJob {
    pub fn new(youtube_url: String, name: String) -> Self {
        let now = Utc::now().to_rfc3339();
        Self {
            id: Uuid::new_v4().to_string(),
            youtube_url,
            name,
            status: JobStatus::Queued,
            created_at: now.clone(),
            updated_at: now,
        }
    }
}

// ─── Persistence ─────────────────────────────────────────────────

/// Thread-safe map of jobs. Persisted to disk on every update.
#[derive(Clone)]
pub struct JobStore {
    inner: Arc<RwLock<std::collections::HashMap<String, VideoJob>>>,
    path: PathBuf,
}

impl JobStore {
    pub async fn load(path: PathBuf) -> Self {
        let inner = match fs::read_to_string(&path).await {
            Ok(data) => match serde_json::from_str(&data) {
                Ok(jobs) => jobs,
                Err(e) => {
                    warn!("Failed to parse jobs file, starting fresh: {}", e);
                    std::collections::HashMap::new()
                }
            },
            Err(_) => std::collections::HashMap::new(),
        };
        Self {
            inner: Arc::new(RwLock::new(inner)),
            path,
        }
    }

    pub async fn get(&self, id: &str) -> Option<VideoJob> {
        self.inner.read().await.get(id).cloned()
    }

    pub async fn list(&self) -> Vec<VideoJob> {
        self.inner.read().await.values().cloned().collect()
    }

    pub async fn list_ready(&self) -> Vec<VideoJob> {
        self.inner
            .read()
            .await
            .values()
            .filter(|j| matches!(j.status, JobStatus::Ready { .. }))
            .cloned()
            .collect()
    }

    pub async fn insert(&self, job: VideoJob) {
        self.inner.write().await.insert(job.id.clone(), job);
        self.persist().await;
    }

    pub async fn update_status(&self, id: &str, status: JobStatus) {
        if let Some(job) = self.inner.write().await.get_mut(id) {
            job.status = status;
            job.updated_at = Utc::now().to_rfc3339();
        }
        self.persist().await;
    }

    async fn persist(&self) {
        let snapshot = self.inner.read().await.clone();
        match serde_json::to_string_pretty(&snapshot) {
            Ok(json) => {
                let tmp = self.path.with_extension("json.tmp");
                if let Err(e) = fs::write(&tmp, json).await {
                    error!("Failed to write jobs tmp file: {}", e);
                    return;
                }
                if let Err(e) = fs::rename(&tmp, &self.path).await {
                    error!("Failed to rename jobs file: {}", e);
                }
            }
            Err(e) => error!("Failed to serialize jobs: {}", e),
        }
    }
}

// ─── Pipeline ────────────────────────────────────────────────────

/// Validate that a URL looks like a YouTube link.
pub fn is_valid_youtube_url(url: &str) -> bool {
    let u = url.trim().to_lowercase();
    u.starts_with("https://www.youtube.com/")
        || u.starts_with("https://youtube.com/")
        || u.starts_with("https://youtu.be/")
        || u.starts_with("https://m.youtube.com/")
}

/// Sanitize a name to a safe filename stem (alphanumeric, underscores, hyphens).
pub fn sanitize_name(name: &str) -> String {
    name.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect::<String>()
        .trim_matches('_')
        .to_string()
}

/// Run the full pipeline for a single job.
///
/// Consumes a semaphore permit, so at most one pipeline runs at a time
/// (protects the t4g.nano's limited RAM).
pub async fn process_video(
    job_id: String,
    store: JobStore,
    semaphore: Arc<Semaphore>,
    videos_dir: PathBuf,
    public_url_prefix: String,
) {
    let permit = match semaphore.acquire_owned().await {
        Ok(p) => p,
        Err(e) => {
            error!("Failed to acquire semaphore: {}", e);
            store
                .update_status(
                    &job_id,
                    JobStatus::Failed {
                        error: "Server busy".into(),
                    },
                )
                .await;
            return;
        }
    };

    let job = match store.get(&job_id).await {
        Some(j) => j,
        None => {
            error!("Job {} not found at pipeline start", job_id);
            drop(permit);
            return;
        }
    };

    info!("Processing job {} ({})", job_id, job.name);

    let tmp_dir = videos_dir.join("tmp");
    if let Err(e) = fs::create_dir_all(&tmp_dir).await {
        fail(&store, &job_id, format!("Failed to create tmp dir: {}", e)).await;
        drop(permit);
        return;
    }

    let safe_name = sanitize_name(&job.name);
    let download_template = tmp_dir.join(format!("{}_raw.%(ext)s", safe_name));
    let final_path = videos_dir.join(format!("{}.mp4", safe_name));

    // --- Step 1: yt-dlp download ---
    store.update_status(&job_id, JobStatus::Downloading).await;

    let dl_result = Command::new("yt-dlp")
        .args([
            "-f",
            "bestvideo[height>=2160]+bestaudio/bestvideo+bestaudio/best",
            "--merge-output-format",
            "mp4",
            "--no-playlist",
            "-o",
        ])
        .arg(&download_template)
        .arg(&job.youtube_url)
        .output()
        .await;

    let raw_path = match dl_result {
        Ok(out) if out.status.success() => {
            match find_downloaded(&tmp_dir, &format!("{}_raw", safe_name)).await {
                Some(p) => p,
                None => {
                    fail(
                        &store,
                        &job_id,
                        "yt-dlp succeeded but no output file found".into(),
                    )
                    .await;
                    drop(permit);
                    return;
                }
            }
        }
        Ok(out) => {
            let stderr = String::from_utf8_lossy(&out.stderr).to_string();
            fail(&store, &job_id, format!("yt-dlp failed: {}", stderr)).await;
            drop(permit);
            return;
        }
        Err(e) => {
            fail(&store, &job_id, format!("yt-dlp spawn error: {}", e)).await;
            drop(permit);
            return;
        }
    };

    // --- Step 2: ffmpeg EAC -> equirectangular ---
    store.update_status(&job_id, JobStatus::Converting).await;

    let ff_result = Command::new("ffmpeg")
        .args(["-y", "-i"])
        .arg(&raw_path)
        .args([
            "-vf",
            "v360=eac:equirect:w=3840:h=1920",
            "-c:v",
            "libx264",
            "-preset",
            "medium",
            "-crf",
            "20",
            "-c:a",
            "aac",
            "-movflags",
            "+faststart",
        ])
        .arg(&final_path)
        .output()
        .await;

    let _ = fs::remove_file(&raw_path).await;

    match ff_result {
        Ok(out) if out.status.success() => {
            let public_url = format!(
                "{}/{}.mp4",
                public_url_prefix.trim_end_matches('/'),
                safe_name
            );
            store
                .update_status(&job_id, JobStatus::Ready { url: public_url })
                .await;
            info!("Job {} ready", job_id);
        }
        Ok(out) => {
            let stderr = String::from_utf8_lossy(&out.stderr).to_string();
            fail(&store, &job_id, format!("ffmpeg failed: {}", stderr)).await;
        }
        Err(e) => {
            fail(&store, &job_id, format!("ffmpeg spawn error: {}", e)).await;
        }
    }

    drop(permit);
    // Brief pause so the filesystem catches up on slow disks
    tokio::time::sleep(Duration::from_millis(100)).await;
}

async fn fail(store: &JobStore, id: &str, msg: String) {
    error!("Job {} failed: {}", id, msg);
    store
        .update_status(id, JobStatus::Failed { error: msg })
        .await;
}

/// Find a file in `dir` whose filename starts with `prefix`.
async fn find_downloaded(dir: &Path, prefix: &str) -> Option<PathBuf> {
    let mut entries = fs::read_dir(dir).await.ok()?;
    while let Ok(Some(entry)) = entries.next_entry().await {
        let path = entry.path();
        if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
            if name.starts_with(prefix) {
                return Some(path);
            }
        }
    }
    None
}
