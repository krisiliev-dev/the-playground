//! 30 Hz authoritative tick loop with per-entity diffing.
//!
//! Per ADR-004: snapshot the entity registry on each tick and
//! broadcast *only the entities whose state changed* since the
//! previous tick. An idle scene (no input, no admin mutation)
//! produces zero broadcasts — the tick loop is silent.
//!
//! The tracked-last-state lives inside the spawned task as plain
//! mutable HashMap; not shared across tasks so no lock cost.
//! Equality is structural via `PartialEq` derives on Entity,
//! Transform, and serde_json::Value.
//!
//! Deletes are NOT tracked here — the cleanup path in
//! `handlers.rs` and the admin Delete op already broadcast
//! `EntityDeleted` synchronously, which is faster (delete is
//! visually disruptive — propagate it without waiting for the
//! next tick).
use std::collections::HashMap;
use std::time::Duration;

use tokio::time::interval;
use tracing::warn;

use crate::entity::{Entity, EntityId};
use crate::protocol::ServerMessage;
use crate::state::AppState;

pub const TICK_HZ: u64 = 30;

pub fn spawn(state: AppState) -> tokio::task::JoinHandle<()> {
    let period = Duration::from_micros(1_000_000 / TICK_HZ);
    tokio::spawn(async move {
        let mut ticker = interval(period);
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

        // Per-task memory of "what we last broadcast." Compared
        // against each tick's snapshot to compute the diff.
        let mut last_seen: HashMap<EntityId, Entity> = HashMap::new();

        loop {
            ticker.tick().await;
            tick_once(&state, &mut last_seen).await;
        }
    })
}

async fn tick_once(state: &AppState, last_seen: &mut HashMap<EntityId, Entity>) {
    let entities = {
        let registry = state.registry.read().await;
        if registry.is_empty() {
            // Registry empty — clear our memory of last-seen so a
            // future entity at the same id is treated as "new" not
            // "unchanged."
            last_seen.clear();
            return;
        }
        registry.snapshot()
    };

    if state.broadcast_tx.receiver_count() == 0 {
        return;
    }

    // Pick out the entities that are new or have mutated.
    let changed: Vec<Entity> = entities
        .iter()
        .filter(|e| match last_seen.get(&e.id) {
            Some(prev) => prev != *e,
            None => true,
        })
        .cloned()
        .collect();

    // Drop entries from `last_seen` for ids no longer present.
    // Keeps memory in step with the registry; otherwise a long-
    // running server slowly leaks across deleted-then-recreated
    // ids.
    let live_ids: std::collections::HashSet<EntityId> = entities.iter().map(|e| e.id).collect();
    last_seen.retain(|id, _| live_ids.contains(id));

    if changed.is_empty() {
        return;
    }

    // Refresh memory for next tick.
    for entity in &changed {
        last_seen.insert(entity.id, entity.clone());
    }

    if let Err(err) = state
        .broadcast_tx
        .send(ServerMessage::EntityUpdates { entities: changed })
    {
        warn!(?err, "tick broadcast failed (no receivers)");
    }
}
