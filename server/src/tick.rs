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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::entity::{EntityKind, Transform};

    fn portal() -> Entity {
        Entity::new(
            EntityKind::Portal,
            Transform::identity(),
            serde_json::json!({}),
        )
    }

    /// `tick_once` is silent on an empty registry — no broadcast,
    /// memory cleared, no errors.
    #[tokio::test]
    async fn empty_registry_silent() {
        let state = AppState::new(String::new(), std::path::PathBuf::from("./test-assets"));
        let mut rx = state.broadcast_tx.subscribe();
        let mut last_seen = HashMap::new();
        last_seen.insert(uuid::Uuid::new_v4(), portal()); // stale entry

        tick_once(&state, &mut last_seen).await;

        assert!(
            last_seen.is_empty(),
            "last_seen cleared when registry empty"
        );
        assert!(
            rx.try_recv().is_err(),
            "no broadcast sent for empty registry"
        );
    }

    /// First tick after an entity is inserted broadcasts it.
    #[tokio::test]
    async fn first_tick_broadcasts_new_entity() {
        let state = AppState::new(String::new(), std::path::PathBuf::from("./test-assets"));
        let mut rx = state.broadcast_tx.subscribe();
        let mut last_seen = HashMap::new();

        let entity = portal();
        let id = entity.id;
        state.registry.write().await.insert(entity);

        tick_once(&state, &mut last_seen).await;

        let msg = rx.try_recv().expect("broadcast was sent");
        match msg {
            ServerMessage::EntityUpdates { entities } => {
                assert_eq!(entities.len(), 1);
                assert_eq!(entities[0].id, id);
            }
            other => panic!("expected EntityUpdates, got {other:?}"),
        }
        assert_eq!(last_seen.len(), 1);
    }

    /// Second consecutive tick with no changes broadcasts nothing.
    /// This is the key invariant — idle scene = silent tick loop.
    #[tokio::test]
    async fn unchanged_entity_no_broadcast() {
        let state = AppState::new(String::new(), std::path::PathBuf::from("./test-assets"));
        let mut rx = state.broadcast_tx.subscribe();
        let mut last_seen = HashMap::new();

        state.registry.write().await.insert(portal());

        tick_once(&state, &mut last_seen).await; // first tick — broadcasts
        let _ = rx.try_recv(); // drain

        tick_once(&state, &mut last_seen).await; // second tick — silent

        assert!(
            rx.try_recv().is_err(),
            "second tick on unchanged registry should not broadcast"
        );
    }

    /// Tick after a transform mutation broadcasts the (one) changed
    /// entity, not the whole registry.
    #[tokio::test]
    async fn mutation_only_broadcasts_changed() {
        let state = AppState::new(String::new(), std::path::PathBuf::from("./test-assets"));
        let mut rx = state.broadcast_tx.subscribe();
        let mut last_seen = HashMap::new();

        let entity_a = portal();
        let entity_b = portal();
        let id_a = entity_a.id;
        let id_b = entity_b.id;
        {
            let mut reg = state.registry.write().await;
            reg.insert(entity_a);
            reg.insert(entity_b);
        }

        // First tick seeds last_seen.
        tick_once(&state, &mut last_seen).await;
        let _ = rx.try_recv();

        // Mutate only A.
        state.registry.write().await.mutate(&id_a, |e| {
            e.transform.position = [10.0, 0.0, 0.0];
        });

        tick_once(&state, &mut last_seen).await;

        let msg = rx.try_recv().expect("broadcast was sent");
        match msg {
            ServerMessage::EntityUpdates { entities } => {
                assert_eq!(
                    entities.len(),
                    1,
                    "only the mutated entity should be in the diff"
                );
                assert_eq!(entities[0].id, id_a);
                assert_eq!(entities[0].transform.position, [10.0, 0.0, 0.0]);
                assert_ne!(entities[0].id, id_b);
            }
            other => panic!("expected EntityUpdates, got {other:?}"),
        }
    }

    /// `last_seen` is pruned when an entity disappears from the
    /// registry — otherwise long-running servers leak ids.
    #[tokio::test]
    async fn last_seen_prunes_deleted_entities() {
        let state = AppState::new(String::new(), std::path::PathBuf::from("./test-assets"));
        let _rx = state.broadcast_tx.subscribe(); // keep channel alive
        let mut last_seen = HashMap::new();

        let entity = portal();
        let id = entity.id;
        state.registry.write().await.insert(entity);

        tick_once(&state, &mut last_seen).await;
        assert!(last_seen.contains_key(&id));

        // Remove the entity from the registry.
        state.registry.write().await.remove(&id);

        // Tick on a now-empty registry triggers the empty-clear
        // path; tested in empty_registry_silent. To exercise the
        // retain() path specifically, leave one other entity in.
        let other = portal();
        let other_id = other.id;
        state.registry.write().await.insert(other);

        tick_once(&state, &mut last_seen).await;

        assert!(
            !last_seen.contains_key(&id),
            "removed entity pruned from last_seen"
        );
        assert!(last_seen.contains_key(&other_id));
    }

    /// No subscribers ⇒ no work, no error.
    #[tokio::test]
    async fn no_subscribers_skips_work() {
        let state = AppState::new(String::new(), std::path::PathBuf::from("./test-assets"));
        // Note: NOT subscribing.
        let mut last_seen = HashMap::new();

        state.registry.write().await.insert(portal());

        // Should complete cleanly without panicking on send-error.
        tick_once(&state, &mut last_seen).await;
    }
}
