//! 30 Hz authoritative tick loop.
//!
//! Per ADR-004, the server snapshots the entity registry on each
//! tick and broadcasts the snapshot to every subscribed client.
//! Clients use the snapshots to interpolate remote entities and
//! to reconcile their predicted local player.
//!
//! For MVP the tick broadcasts the *full* current state every
//! frame (no per-entity diffing). At ~100 entities × 33ms this is
//! a few KB/s/client — well within budget for a portfolio site.
//! When the entity count grows or bandwidth becomes a constraint,
//! swap in a per-entity fingerprint diff here without touching
//! the rest of the system.
//!
//! Empty registry → no broadcast (clients without remote entities
//! don't need ticks).
use std::time::Duration;

use tokio::time::interval;
use tracing::warn;

use crate::protocol::ServerMessage;
use crate::state::AppState;

/// Server tick frequency. 30 Hz is the standard "good enough for
/// cursor / avatar movement" rate; doubling it doubles bandwidth
/// without a perceptible smoothness improvement once snapshot
/// interpolation is in place client-side.
pub const TICK_HZ: u64 = 30;

/// Spawn the tick loop as a background task. Returns the
/// JoinHandle so the caller can cancel it on shutdown — though
/// in practice main.rs just drops it and lets process exit clean
/// up.
pub fn spawn(state: AppState) -> tokio::task::JoinHandle<()> {
    let period = Duration::from_micros(1_000_000 / TICK_HZ);
    tokio::spawn(async move {
        let mut ticker = interval(period);
        // Default `MissedTickBehavior::Burst` would try to catch
        // up after a stall by firing back-to-back ticks. For a
        // game loop we'd rather skip — clients interpolate over
        // gaps, and burst-catching just wastes bandwidth.
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

        loop {
            ticker.tick().await;
            tick_once(&state).await;
        }
    })
}

async fn tick_once(state: &AppState) {
    // Brief read lock — clone out and drop before the broadcast
    // so the lock is never held across an await on a slow
    // subscriber.
    let entities = {
        let registry = state.registry.read().await;
        if registry.is_empty() {
            return;
        }
        registry.snapshot()
    };

    // Subscriber count == 0 ⇒ no clients connected. Broadcast
    // returns Err in that case which is fine; we just skip.
    if state.broadcast_tx.receiver_count() == 0 {
        return;
    }

    if let Err(err) = state
        .broadcast_tx
        .send(ServerMessage::EntityUpdates { entities })
    {
        // The only way `send` errors is if there are zero
        // receivers — which we just checked, so this would mean
        // the count dropped to zero between the check and the
        // send (race window of a few µs). Log at warn so we'd
        // notice if it became frequent.
        warn!(?err, "tick broadcast failed (no receivers)");
    }
}
