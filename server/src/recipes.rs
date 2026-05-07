//! Effect recipes (per ADR-008).
//!
//! A recipe is a JSON-defined sequence of `SceneEvent`s with
//! per-step time offsets. The admin uploads a recipe once, then
//! triggers it at any position via the play endpoint — the server
//! schedules the steps as broadcasts at their respective offsets.
//!
//! The point: admins can author new effects (`confettiBurst`,
//! `firework`, `glitchBlast`, …) without redeploying the server or
//! the client. The wire vocabulary stays small (audio +
//! camera_shake), but recipes compose those primitives into named,
//! reusable effects.
//!
//! Storage layout:
//!   <RECIPES_FILE>      JSON array of recipes (versioned)
//!
//! Adding a new step kind means extending `RecipeStep` and the
//! expansion path in `step_to_event` — but keep it conservative;
//! recipes are an authoring surface, not a free-form scripting
//! engine.
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::protocol::SceneEventKind;

/// Hard cap on a step's absolute offset from recipe start. Stops
/// a misauthored recipe from leaving a tokio task asleep for an
/// hour. 30 seconds covers anything sensible (long fireworks,
/// staged sequences); over-long recipes can chain via multiple
/// triggers.
pub const MAX_STEP_OFFSET_MS: u64 = 30_000;

/// Hard cap on number of steps in a single recipe. Bounds the
/// memory + scheduling cost of a single trigger. 64 fits a generous
/// firework / cascade pattern.
pub const MAX_STEPS_PER_RECIPE: usize = 64;

/// One step in a recipe. Discriminated by `kind` so the JSON
/// authoring surface mirrors the wire `SceneEventKind` shape
/// authors are already familiar with — but each step carries an
/// `offset_ms` (when to fire, relative to the trigger time) and a
/// `position_offset` (relative to the trigger position) that the
/// runtime expansion path resolves at trigger time.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum RecipeStep {
    Audio {
        offset_ms: u64,
        sound_id: String,
        position_offset: [f32; 3],
        volume: f32,
    },
    CameraShake {
        offset_ms: u64,
        position_offset: [f32; 3],
        radius: f32,
        intensity: f32,
        duration_ms: u32,
    },
}

impl RecipeStep {
    pub fn offset_ms(&self) -> u64 {
        match self {
            Self::Audio { offset_ms, .. } => *offset_ms,
            Self::CameraShake { offset_ms, .. } => *offset_ms,
        }
    }
}

/// A single named effect. `id` is the lookup key admins use at
/// trigger time; `name` is human-readable for the future admin
/// console.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Recipe {
    pub id: String,
    pub name: String,
    pub steps: Vec<RecipeStep>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
pub struct RecipeStore {
    pub version: u32,
    pub recipes: Vec<Recipe>,
}

const RECIPE_STORE_VERSION: u32 = 1;

impl RecipeStore {
    pub fn new() -> Self {
        Self {
            version: RECIPE_STORE_VERSION,
            recipes: Vec::new(),
        }
    }

    /// Upsert a recipe by id. Returns `true` if a new recipe was
    /// inserted, `false` if an existing recipe was replaced.
    pub fn upsert(&mut self, recipe: Recipe) -> bool {
        if let Some(existing) = self.recipes.iter_mut().find(|r| r.id == recipe.id) {
            *existing = recipe;
            return false;
        }
        self.recipes.push(recipe);
        true
    }

    pub fn remove(&mut self, id: &str) -> bool {
        let before = self.recipes.len();
        self.recipes.retain(|r| r.id != id);
        self.recipes.len() != before
    }

    pub fn get(&self, id: &str) -> Option<&Recipe> {
        self.recipes.iter().find(|r| r.id == id)
    }

    pub fn list(&self) -> &[Recipe] {
        &self.recipes
    }

    pub fn len(&self) -> usize {
        self.recipes.len()
    }

    pub fn is_empty(&self) -> bool {
        self.recipes.is_empty()
    }
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
            Self::UnsupportedVersion { found, expected } => write!(
                f,
                "unsupported recipe store version {found} (expected {expected})"
            ),
        }
    }
}

impl std::error::Error for LoadError {}

/// Load the recipe store from disk. Missing file ⇒ empty store.
/// Mirrors `assets::load_index`'s graceful policy.
pub async fn load_recipes(path: &Path) -> Result<RecipeStore, LoadError> {
    let bytes = match tokio::fs::read(path).await {
        Ok(b) => b,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(RecipeStore::new()),
        Err(e) => return Err(LoadError::Io(e)),
    };
    let store: RecipeStore = serde_json::from_slice(&bytes).map_err(LoadError::Parse)?;
    if store.version != RECIPE_STORE_VERSION {
        return Err(LoadError::UnsupportedVersion {
            found: store.version,
            expected: RECIPE_STORE_VERSION,
        });
    }
    Ok(store)
}

/// Persist the recipe store to disk via atomic tmp+rename.
pub async fn save_recipes(path: &Path, store: &RecipeStore) -> Result<(), std::io::Error> {
    let json = serde_json::to_vec_pretty(store).map_err(std::io::Error::other)?;
    let tmp_path: PathBuf = path.with_extension("json.tmp");
    tokio::fs::write(&tmp_path, &json).await?;
    tokio::fs::rename(&tmp_path, path).await?;
    Ok(())
}

#[derive(Debug)]
pub enum ValidationError {
    EmptyId,
    IdTooLong,
    IdInvalidChars,
    EmptyName,
    NameTooLong,
    TooManySteps { found: usize, cap: usize },
    StepOffsetTooLarge { offset_ms: u64, cap: u64 },
    InvalidVolume,
    InvalidIntensity,
    InvalidRadius,
    InvalidDuration,
    EmptySoundId,
}

impl std::fmt::Display for ValidationError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::EmptyId => write!(f, "recipe id is empty"),
            Self::IdTooLong => write!(f, "recipe id exceeds 64 chars"),
            Self::IdInvalidChars => write!(
                f,
                "recipe id contains invalid chars (allowed: ascii alphanumeric, _, -)"
            ),
            Self::EmptyName => write!(f, "recipe name is empty"),
            Self::NameTooLong => write!(f, "recipe name exceeds 128 chars"),
            Self::TooManySteps { found, cap } => {
                write!(f, "recipe has {found} steps (max {cap})")
            }
            Self::StepOffsetTooLarge { offset_ms, cap } => {
                write!(f, "step offset {offset_ms} ms exceeds cap {cap} ms")
            }
            Self::InvalidVolume => write!(f, "audio volume must be in [0, 2]"),
            Self::InvalidIntensity => write!(f, "shake intensity must be in [0, 5]"),
            Self::InvalidRadius => write!(f, "shake radius must be in [0, 5000]"),
            Self::InvalidDuration => write!(f, "shake duration_ms must be in [0, 5000]"),
            Self::EmptySoundId => write!(f, "audio sound_id is empty"),
        }
    }
}

impl std::error::Error for ValidationError {}

/// Reject a recipe whose id, name, or step shape is malformed.
/// Pure validation — no side effects. Run on every upsert before
/// touching the store.
pub fn validate_recipe(recipe: &Recipe) -> Result<(), ValidationError> {
    if recipe.id.is_empty() {
        return Err(ValidationError::EmptyId);
    }
    if recipe.id.len() > 64 {
        return Err(ValidationError::IdTooLong);
    }
    if !recipe
        .id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    {
        return Err(ValidationError::IdInvalidChars);
    }
    if recipe.name.is_empty() {
        return Err(ValidationError::EmptyName);
    }
    if recipe.name.len() > 128 {
        return Err(ValidationError::NameTooLong);
    }
    if recipe.steps.len() > MAX_STEPS_PER_RECIPE {
        return Err(ValidationError::TooManySteps {
            found: recipe.steps.len(),
            cap: MAX_STEPS_PER_RECIPE,
        });
    }
    for step in &recipe.steps {
        if step.offset_ms() > MAX_STEP_OFFSET_MS {
            return Err(ValidationError::StepOffsetTooLarge {
                offset_ms: step.offset_ms(),
                cap: MAX_STEP_OFFSET_MS,
            });
        }
        match step {
            RecipeStep::Audio {
                sound_id, volume, ..
            } => {
                if sound_id.is_empty() {
                    return Err(ValidationError::EmptySoundId);
                }
                if !volume.is_finite() || *volume < 0.0 || *volume > 2.0 {
                    return Err(ValidationError::InvalidVolume);
                }
            }
            RecipeStep::CameraShake {
                radius,
                intensity,
                duration_ms,
                ..
            } => {
                if !intensity.is_finite() || *intensity < 0.0 || *intensity > 5.0 {
                    return Err(ValidationError::InvalidIntensity);
                }
                if !radius.is_finite() || *radius < 0.0 || *radius > 5000.0 {
                    return Err(ValidationError::InvalidRadius);
                }
                if *duration_ms > 5000 {
                    return Err(ValidationError::InvalidDuration);
                }
            }
        }
    }
    Ok(())
}

/// Run a recipe's steps as scheduled broadcasts. Each step waits
/// until its absolute `offset_ms` from `start`, then sends a
/// `ServerMessage::SceneEvent` with `actor_id: None` (admin-
/// originated, like the existing `post_admin_event` path).
///
/// Steps are sorted by ascending offset so out-of-order JSON
/// authoring doesn't produce out-of-order broadcasts.
///
/// Used by `post_admin_play_recipe` (handlers.rs) inside a
/// `tokio::spawn`. Extracted into a function so the timing /
/// expansion logic is testable without needing the HTTP layer.
pub async fn run_recipe(
    recipe: &Recipe,
    trigger_pos: [f32; 3],
    broadcast_tx: tokio::sync::broadcast::Sender<crate::protocol::ServerMessage>,
) {
    let mut steps: Vec<&RecipeStep> = recipe.steps.iter().collect();
    steps.sort_by_key(|s| s.offset_ms());
    let start = std::time::Instant::now();
    for step in steps {
        let target = start + std::time::Duration::from_millis(step.offset_ms());
        let now = std::time::Instant::now();
        let wait = target.saturating_duration_since(now);
        if !wait.is_zero() {
            tokio::time::sleep(wait).await;
        }
        let event = step_to_event(step, trigger_pos);
        let _ = broadcast_tx.send(crate::protocol::ServerMessage::SceneEvent {
            actor_id: None,
            event,
        });
    }
}

/// Expand a step into a concrete `SceneEventKind` at the supplied
/// trigger position. Pure — exported for tests; the playback path
/// uses it identically.
pub fn step_to_event(step: &RecipeStep, trigger_pos: [f32; 3]) -> SceneEventKind {
    match step {
        RecipeStep::Audio {
            sound_id,
            position_offset,
            volume,
            ..
        } => SceneEventKind::Audio {
            sound_id: sound_id.clone(),
            position: Some([
                trigger_pos[0] + position_offset[0],
                trigger_pos[1] + position_offset[1],
                trigger_pos[2] + position_offset[2],
            ]),
            volume: *volume,
        },
        RecipeStep::CameraShake {
            position_offset,
            radius,
            intensity,
            duration_ms,
            ..
        } => SceneEventKind::CameraShake {
            position: [
                trigger_pos[0] + position_offset[0],
                trigger_pos[1] + position_offset[1],
                trigger_pos[2] + position_offset[2],
            ],
            radius: *radius,
            intensity: *intensity,
            duration_ms: *duration_ms,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn make_step_audio(offset: u64, sound: &str) -> RecipeStep {
        RecipeStep::Audio {
            offset_ms: offset,
            sound_id: sound.to_string(),
            position_offset: [0.0, 0.0, 0.0],
            volume: 1.0,
        }
    }

    fn make_step_shake(offset: u64) -> RecipeStep {
        RecipeStep::CameraShake {
            offset_ms: offset,
            position_offset: [0.0, 0.0, 0.0],
            radius: 100.0,
            intensity: 0.5,
            duration_ms: 200,
        }
    }

    fn make_recipe(id: &str) -> Recipe {
        Recipe {
            id: id.to_string(),
            name: "Test Recipe".to_string(),
            steps: vec![make_step_audio(0, "click")],
        }
    }

    #[test]
    fn upsert_inserts_new_returns_true() {
        let mut store = RecipeStore::new();
        assert!(store.upsert(make_recipe("a")));
        assert_eq!(store.len(), 1);
    }

    #[test]
    fn upsert_replaces_existing_returns_false() {
        let mut store = RecipeStore::new();
        store.upsert(make_recipe("a"));
        let mut updated = make_recipe("a");
        updated.name = "Updated".to_string();
        assert!(!store.upsert(updated));
        assert_eq!(store.len(), 1);
        assert_eq!(store.get("a").unwrap().name, "Updated");
    }

    #[test]
    fn remove_drops_recipe() {
        let mut store = RecipeStore::new();
        store.upsert(make_recipe("a"));
        store.upsert(make_recipe("b"));
        assert!(store.remove("a"));
        assert_eq!(store.len(), 1);
        assert!(store.get("a").is_none());
        assert!(store.get("b").is_some());
    }

    #[test]
    fn remove_unknown_returns_false() {
        let mut store = RecipeStore::new();
        assert!(!store.remove("ghost"));
    }

    #[test]
    fn validate_rejects_empty_id() {
        let mut r = make_recipe("");
        r.name = "ok".to_string();
        assert!(matches!(validate_recipe(&r), Err(ValidationError::EmptyId)));
    }

    #[test]
    fn validate_rejects_invalid_chars_in_id() {
        let r = Recipe {
            id: "bad/id".to_string(),
            name: "x".to_string(),
            steps: vec![],
        };
        assert!(matches!(
            validate_recipe(&r),
            Err(ValidationError::IdInvalidChars)
        ));
    }

    #[test]
    fn validate_rejects_too_many_steps() {
        let mut r = make_recipe("ok");
        r.steps = (0..(MAX_STEPS_PER_RECIPE + 1))
            .map(|i| make_step_audio(i as u64, "x"))
            .collect();
        assert!(matches!(
            validate_recipe(&r),
            Err(ValidationError::TooManySteps { .. })
        ));
    }

    #[test]
    fn validate_rejects_offset_past_cap() {
        let mut r = make_recipe("ok");
        r.steps = vec![make_step_audio(MAX_STEP_OFFSET_MS + 1, "x")];
        assert!(matches!(
            validate_recipe(&r),
            Err(ValidationError::StepOffsetTooLarge { .. })
        ));
    }

    #[test]
    fn validate_rejects_negative_volume() {
        let mut r = make_recipe("ok");
        r.steps = vec![RecipeStep::Audio {
            offset_ms: 0,
            sound_id: "x".to_string(),
            position_offset: [0.0; 3],
            volume: -0.1,
        }];
        assert!(matches!(
            validate_recipe(&r),
            Err(ValidationError::InvalidVolume)
        ));
    }

    #[test]
    fn validate_accepts_well_formed_recipe() {
        let r = Recipe {
            id: "confetti_burst".to_string(),
            name: "Confetti Burst".to_string(),
            steps: vec![
                make_step_audio(0, "popper"),
                make_step_shake(100),
                make_step_audio(200, "swoosh"),
            ],
        };
        assert!(validate_recipe(&r).is_ok());
    }

    #[test]
    fn step_to_event_audio_applies_trigger_position_plus_offset() {
        let step = RecipeStep::Audio {
            offset_ms: 0,
            sound_id: "click".to_string(),
            position_offset: [10.0, 5.0, -3.0],
            volume: 0.8,
        };
        let event = step_to_event(&step, [100.0, 0.0, 0.0]);
        match event {
            SceneEventKind::Audio {
                sound_id,
                position,
                volume,
            } => {
                assert_eq!(sound_id, "click");
                assert_eq!(volume, 0.8);
                assert_eq!(position, Some([110.0, 5.0, -3.0]));
            }
            _ => panic!("expected Audio variant"),
        }
    }

    #[test]
    fn step_to_event_camera_shake_applies_trigger_position_plus_offset() {
        let step = make_step_shake(0);
        let event = step_to_event(&step, [50.0, 0.0, -10.0]);
        match event {
            SceneEventKind::CameraShake {
                position,
                radius,
                intensity,
                duration_ms,
            } => {
                assert_eq!(position, [50.0, 0.0, -10.0]);
                assert_eq!(radius, 100.0);
                assert_eq!(intensity, 0.5);
                assert_eq!(duration_ms, 200);
            }
            _ => panic!("expected CameraShake variant"),
        }
    }

    #[tokio::test]
    async fn load_recipes_returns_empty_when_file_missing() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("does-not-exist.json");
        let store = load_recipes(&path).await.unwrap();
        assert!(store.is_empty());
    }

    #[tokio::test]
    async fn save_then_load_round_trip_preserves_recipes() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("recipes.json");
        let mut store = RecipeStore::new();
        store.upsert(make_recipe("a"));
        store.upsert(make_recipe("b"));
        save_recipes(&path, &store).await.unwrap();
        let loaded = load_recipes(&path).await.unwrap();
        assert_eq!(loaded.len(), 2);
        assert_eq!(loaded.recipes[0].id, "a");
    }

    #[tokio::test]
    async fn run_recipe_broadcasts_steps_in_offset_order() {
        // Authored out-of-order in the JSON: step at 100ms first,
        // step at 0ms second. After sort, the 0ms step should
        // broadcast first, then the 100ms step.
        let recipe = Recipe {
            id: "x".to_string(),
            name: "x".to_string(),
            steps: vec![make_step_audio(50, "second"), make_step_audio(0, "first")],
        };
        let (tx, mut rx) = tokio::sync::broadcast::channel(16);
        let trigger = [10.0, 0.0, 0.0];
        let handle = tokio::spawn(async move {
            run_recipe(&recipe, trigger, tx).await;
        });

        // First event: should be 'first', position [10, 0, 0].
        let msg = rx.recv().await.unwrap();
        match msg {
            crate::protocol::ServerMessage::SceneEvent {
                event: SceneEventKind::Audio { sound_id, .. },
                ..
            } => {
                assert_eq!(sound_id, "first");
            }
            other => panic!("expected first audio event, got {other:?}"),
        }

        // Second event: 'second', after ~50ms wait.
        let msg = rx.recv().await.unwrap();
        match msg {
            crate::protocol::ServerMessage::SceneEvent {
                event: SceneEventKind::Audio { sound_id, .. },
                ..
            } => {
                assert_eq!(sound_id, "second");
            }
            other => panic!("expected second audio event, got {other:?}"),
        }

        handle.await.unwrap();
    }

    #[tokio::test]
    async fn run_recipe_applies_position_offsets_per_step() {
        let recipe = Recipe {
            id: "x".to_string(),
            name: "x".to_string(),
            steps: vec![RecipeStep::Audio {
                offset_ms: 0,
                sound_id: "ping".to_string(),
                position_offset: [5.0, 2.0, -1.0],
                volume: 0.7,
            }],
        };
        let (tx, mut rx) = tokio::sync::broadcast::channel(8);
        tokio::spawn(async move {
            run_recipe(&recipe, [100.0, 0.0, 0.0], tx).await;
        });
        let msg = rx.recv().await.unwrap();
        match msg {
            crate::protocol::ServerMessage::SceneEvent {
                actor_id: None,
                event:
                    SceneEventKind::Audio {
                        sound_id,
                        position,
                        volume,
                    },
            } => {
                assert_eq!(sound_id, "ping");
                assert_eq!(position, Some([105.0, 2.0, -1.0]));
                assert_eq!(volume, 0.7);
            }
            other => panic!("expected admin-originated audio event, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn load_recipes_rejects_unsupported_version() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("recipes.json");
        let body = serde_json::json!({"version": 99, "recipes": []});
        tokio::fs::write(&path, serde_json::to_vec(&body).unwrap())
            .await
            .unwrap();
        match load_recipes(&path).await {
            Err(LoadError::UnsupportedVersion { found: 99, .. }) => {}
            other => panic!("expected UnsupportedVersion, got {other:?}"),
        }
    }
}
