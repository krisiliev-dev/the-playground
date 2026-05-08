//! Scene event validation and rate-limit tracking.
//!
//! Per ADR-006: each `ClientMessage::SceneEvent` is validated
//! before the server rebroadcasts it. Validation has two parts:
//!   1. Per-variant clamps and shape checks (`validate_event`).
//!   2. Per-actor rate limiting via a sliding-window tracker
//!      (`RateTracker`).
//!
//! Validation failures are silent: the rebroadcast is suppressed
//! but the originator (which already triggered the effect locally
//! via optimistic-local) sees no glitch. This is the
//! anti-griefing dial — server can drop excess events from a
//! noisy client without the client noticing for their own view.
//!
//! Adding a new event variant: extend `SceneEventKind` in
//! `protocol.rs`, then add a branch here in `validate_event`.
//! Default branch (unknown variant) returns `Ok` so the codebase
//! stays forward-compatible across minor upgrades.
use std::collections::HashMap;
use std::time::{Duration, Instant};

use crate::entity::EntityId;
use crate::protocol::SceneEventKind;

/// Per-actor sliding-window rate tracker. Stores the timestamps
/// of recent events per (actor, kind) and queries with a
/// per-kind cap.
///
/// Memory: O(actors × kinds × max_window_count). For 100 actors
/// × 4 kinds × 20 events = 8000 timestamps; trivial.
#[derive(Default)]
pub struct RateTracker {
    /// `(actor_id, kind_tag)` → recent event timestamps.
    /// Old entries pruned lazily on each `record`/`check` call.
    history: HashMap<(EntityId, &'static str), Vec<Instant>>,
}

impl RateTracker {
    pub fn new() -> Self {
        Self::default()
    }

    /// Record an event and check whether it's within the rate
    /// limit. Returns `true` if the event should be allowed,
    /// `false` if it exceeds the cap and should be dropped.
    ///
    /// Single function (rather than separate check + record)
    /// because the policy is "count this event regardless of
    /// whether we're going to allow it" — we don't reward
    /// over-budget callers by under-counting.
    pub fn allow(
        &mut self,
        actor_id: EntityId,
        kind: &'static str,
        max_per_window: usize,
        window: Duration,
        now: Instant,
    ) -> bool {
        let entries = self.history.entry((actor_id, kind)).or_default();
        let cutoff = now.checked_sub(window).unwrap_or(now);
        entries.retain(|&t| t >= cutoff);
        if entries.len() >= max_per_window {
            return false;
        }
        entries.push(now);
        true
    }

    /// Drop all tracking for an actor. Called when their session
    /// disconnects so the map doesn't grow unbounded over a
    /// long-running server.
    pub fn forget(&mut self, actor_id: EntityId) {
        self.history.retain(|(id, _), _| *id != actor_id);
    }
}

/// Result of validating a candidate event. `Pass` carries the
/// (possibly clamped) event to rebroadcast; `Drop` means the
/// event is silently suppressed.
#[derive(Debug)]
pub enum ValidationOutcome {
    Pass(SceneEventKind),
    Drop,
}

/// Apply per-variant clamps + rate limits.
///
/// `actor_id == None` is allowed only for system-initiated
/// events (currently none — but the wire format supports it
/// for future server-originated effects, e.g. world-wide
/// announcements). For now, anonymous events are always dropped.
pub fn validate_event(
    actor_id: Option<EntityId>,
    event: SceneEventKind,
    tracker: &mut RateTracker,
    now: Instant,
) -> ValidationOutcome {
    let Some(id) = actor_id else {
        return ValidationOutcome::Drop;
    };

    match event {
        SceneEventKind::SwordSwing { .. } => {
            // 30/sec accommodates the 12-sword reveal cascade (12
            // events fired within ~0.6s = 20/sec peak) with margin.
            // The originator is bounded by the reveal state machine's
            // ~10s cycle, so a steady-state attacker can't sustain
            // anywhere near 30/sec.
            if !tracker.allow(id, "sword_swing", 30, Duration::from_secs(1), now) {
                return ValidationOutcome::Drop;
            }
            ValidationOutcome::Pass(event)
        }
        SceneEventKind::SwordImpact { .. } => {
            // Mirrors sword_swing — the cascade fires one impact per
            // sword at the wall, in the same ~0.6s window.
            if !tracker.allow(id, "sword_impact", 30, Duration::from_secs(1), now) {
                return ValidationOutcome::Drop;
            }
            ValidationOutcome::Pass(event)
        }
        SceneEventKind::Audio {
            sound_id,
            position,
            volume,
        } => {
            if !tracker.allow(id, "audio", 20, Duration::from_secs(1), now) {
                return ValidationOutcome::Drop;
            }
            // Clamp volume to [0, 1] — out-of-range values from a
            // misbehaving client could blow ears or be silent
            // depending on which side. Clamp, don't drop.
            let clamped_volume = volume.clamp(0.0, 1.0);
            ValidationOutcome::Pass(SceneEventKind::Audio {
                sound_id,
                position,
                volume: clamped_volume,
            })
        }
        SceneEventKind::CameraShake {
            position,
            radius,
            intensity,
            duration_ms,
        } => {
            if !tracker.allow(id, "camera_shake", 5, Duration::from_secs(1), now) {
                return ValidationOutcome::Drop;
            }
            // Clamp shake parameters to safe ranges — a malicious
            // client can't trigger a 60-second screen-shaker on
            // every other player. Radius is large (1000u) because
            // the world geometry has cameras hundreds of units back
            // from impact points; tighter caps swallowed legitimate
            // long-range shakes (sword slams against a far wall).
            ValidationOutcome::Pass(SceneEventKind::CameraShake {
                position,
                radius: radius.clamp(0.0, 1000.0),
                intensity: intensity.clamp(0.0, 1.0),
                duration_ms: duration_ms.min(1500),
            })
        }
        SceneEventKind::ForceTeleport { .. } => {
            // Server-originated only (admin teleport endpoint);
            // a player forging this would let them yank others'
            // cursors. Drop unconditionally on the player path —
            // admin endpoints bypass `validate_event` entirely.
            ValidationOutcome::Drop
        }
        SceneEventKind::AssetAvailable { .. } => {
            // AssetAvailable is server-originated only — never
            // sent by a player. If a player tries to forge one
            // (which only matters if they somehow bypassed our
            // wire-format types), drop it: clients shouldn't
            // trust asset URLs that didn't come from a verified
            // upload. No rate-limit, no clamps; this branch is
            // pure rejection.
            ValidationOutcome::Drop
        }
        SceneEventKind::ParticleBurst {
            position,
            count,
            colors,
            speed,
            lifetime_ms,
            spread,
            gravity,
            size,
            model_url,
            spin,
        } => {
            if !tracker.allow(id, "particle_burst", 10, Duration::from_secs(1), now) {
                return ValidationOutcome::Drop;
            }
            // Empty palette is a misuse — drop rather than
            // silently render invisible particles.
            if colors.is_empty() {
                return ValidationOutcome::Drop;
            }
            // Clamp every numeric parameter to bounded ranges so
            // a misbehaving client (or an over-eager admin
            // recipe) can't ask for a million particles or a
            // 10-minute burst that dominates the scene. Model
            // mode caps `count` lower than point mode because
            // instanced meshes are heavier than point sprites.
            let count_cap = if model_url.is_some() { 200 } else { 500 };
            ValidationOutcome::Pass(SceneEventKind::ParticleBurst {
                position,
                count: count.min(count_cap),
                colors,
                speed: speed.clamp(0.0, 500.0),
                lifetime_ms: lifetime_ms.min(10_000),
                spread: spread.clamp(0.0, 1.0),
                gravity: gravity.clamp(-200.0, 200.0),
                size: size.clamp(0.01, 50.0),
                model_url,
                spin: spin.clamp(-50.0, 50.0),
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    fn fresh_actor() -> EntityId {
        Uuid::new_v4()
    }

    fn dummy_audio() -> SceneEventKind {
        SceneEventKind::Audio {
            sound_id: "click".to_string(),
            position: None,
            volume: 0.5,
        }
    }

    #[test]
    fn anonymous_events_are_dropped() {
        let mut tracker = RateTracker::new();
        let outcome = validate_event(None, dummy_audio(), &mut tracker, Instant::now());
        assert!(matches!(outcome, ValidationOutcome::Drop));
    }

    #[test]
    fn audio_volume_clamped_to_unit_range() {
        let mut tracker = RateTracker::new();
        let actor = fresh_actor();
        let event = SceneEventKind::Audio {
            sound_id: "x".to_string(),
            position: None,
            volume: 99.0,
        };
        let outcome = validate_event(Some(actor), event, &mut tracker, Instant::now());
        match outcome {
            ValidationOutcome::Pass(SceneEventKind::Audio { volume, .. }) => {
                assert_eq!(volume, 1.0);
            }
            _ => panic!("expected clamped Pass"),
        }

        let negative = SceneEventKind::Audio {
            sound_id: "x".to_string(),
            position: None,
            volume: -1.0,
        };
        let outcome = validate_event(Some(actor), negative, &mut tracker, Instant::now());
        match outcome {
            ValidationOutcome::Pass(SceneEventKind::Audio { volume, .. }) => {
                assert_eq!(volume, 0.0);
            }
            _ => panic!("expected clamped Pass"),
        }
    }

    #[test]
    fn audio_rate_limit_drops_excess() {
        let mut tracker = RateTracker::new();
        let actor = fresh_actor();
        let now = Instant::now();
        // 20 events per second cap.
        for _ in 0..20 {
            let outcome = validate_event(Some(actor), dummy_audio(), &mut tracker, now);
            assert!(matches!(outcome, ValidationOutcome::Pass(_)));
        }
        // 21st within the same window: dropped.
        let outcome = validate_event(Some(actor), dummy_audio(), &mut tracker, now);
        assert!(matches!(outcome, ValidationOutcome::Drop));
    }

    #[test]
    fn rate_limit_window_slides() {
        let mut tracker = RateTracker::new();
        let actor = fresh_actor();
        let t0 = Instant::now();

        // Saturate the audio budget (20/sec).
        for _ in 0..20 {
            validate_event(Some(actor), dummy_audio(), &mut tracker, t0);
        }
        assert!(matches!(
            validate_event(Some(actor), dummy_audio(), &mut tracker, t0),
            ValidationOutcome::Drop
        ));

        // 1.5 seconds later — older entries are outside the
        // window, budget restored.
        let t_later = t0 + Duration::from_millis(1500);
        assert!(matches!(
            validate_event(Some(actor), dummy_audio(), &mut tracker, t_later),
            ValidationOutcome::Pass(_)
        ));
    }

    #[test]
    fn camera_shake_intensity_and_duration_clamped() {
        let mut tracker = RateTracker::new();
        let actor = fresh_actor();
        let event = SceneEventKind::CameraShake {
            position: [0.0, 0.0, 0.0],
            radius: 9999.0,
            intensity: 99.0,
            duration_ms: 60_000,
        };
        let outcome = validate_event(Some(actor), event, &mut tracker, Instant::now());
        match outcome {
            ValidationOutcome::Pass(SceneEventKind::CameraShake {
                radius,
                intensity,
                duration_ms,
                ..
            }) => {
                assert_eq!(radius, 1000.0);
                assert_eq!(intensity, 1.0);
                assert_eq!(duration_ms, 1500);
            }
            _ => panic!("expected clamped Pass"),
        }
    }

    #[test]
    fn camera_shake_radius_within_cap_is_unchanged() {
        let mut tracker = RateTracker::new();
        let actor = fresh_actor();
        // The default world radius (500) should pass through
        // without clamping — guards against future off-by-one
        // tightenings of the cap.
        let event = SceneEventKind::CameraShake {
            position: [0.0, 0.0, 0.0],
            radius: 500.0,
            intensity: 1.0,
            duration_ms: 180,
        };
        let outcome = validate_event(Some(actor), event, &mut tracker, Instant::now());
        match outcome {
            ValidationOutcome::Pass(SceneEventKind::CameraShake { radius, .. }) => {
                assert_eq!(radius, 500.0);
            }
            _ => panic!("expected pass-through"),
        }
    }

    #[test]
    fn rate_limits_are_per_actor() {
        let mut tracker = RateTracker::new();
        let actor_a = fresh_actor();
        let actor_b = fresh_actor();
        let now = Instant::now();
        for _ in 0..20 {
            validate_event(Some(actor_a), dummy_audio(), &mut tracker, now);
        }
        // Actor A is saturated; actor B should still pass.
        assert!(matches!(
            validate_event(Some(actor_b), dummy_audio(), &mut tracker, now),
            ValidationOutcome::Pass(_)
        ));
    }

    fn dummy_swing() -> SceneEventKind {
        SceneEventKind::SwordSwing {
            from: [0.0, 0.0, 0.0],
            to: [1.0, 1.0, 1.0],
            strength: 1.0,
        }
    }

    #[test]
    fn sword_swing_cascade_fits_under_rate_limit() {
        let mut tracker = RateTracker::new();
        let actor = fresh_actor();
        let now = Instant::now();
        // Cascade is 12 swings in ~0.6s. All should pass.
        for _ in 0..12 {
            assert!(matches!(
                validate_event(Some(actor), dummy_swing(), &mut tracker, now),
                ValidationOutcome::Pass(_)
            ));
        }
    }

    #[test]
    fn sword_swing_drops_after_thirty_per_window() {
        let mut tracker = RateTracker::new();
        let actor = fresh_actor();
        let now = Instant::now();
        for _ in 0..30 {
            assert!(matches!(
                validate_event(Some(actor), dummy_swing(), &mut tracker, now),
                ValidationOutcome::Pass(_)
            ));
        }
        // 31st in the same window: dropped.
        assert!(matches!(
            validate_event(Some(actor), dummy_swing(), &mut tracker, now),
            ValidationOutcome::Drop
        ));
    }

    #[test]
    fn forget_releases_actor_history() {
        let mut tracker = RateTracker::new();
        let actor = fresh_actor();
        let now = Instant::now();
        for _ in 0..20 {
            validate_event(Some(actor), dummy_audio(), &mut tracker, now);
        }
        assert!(matches!(
            validate_event(Some(actor), dummy_audio(), &mut tracker, now),
            ValidationOutcome::Drop
        ));
        tracker.forget(actor);
        assert!(matches!(
            validate_event(Some(actor), dummy_audio(), &mut tracker, now),
            ValidationOutcome::Pass(_)
        ));
    }
}
