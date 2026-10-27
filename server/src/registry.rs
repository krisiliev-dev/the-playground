//! Entity registry — the in-memory authoritative scene state.
//!
//! Wrapped in `Arc<RwLock<_>>` at the `AppState` level (see
//! `state.rs`). Mutations happen through the methods here; the
//! tick loop reads via `snapshot()` to broadcast diffs.
//!
//! The registry is intentionally a thin layer over a HashMap.
//! Diff computation, broadcast, persistence — all live elsewhere
//! so each concern can evolve independently. Per ADR-004 we may
//! later replace the HashMap with a typed ECS (Bevy, Hecs) if
//! the property model grows; the public surface here would stay
//! the same.
use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::entity::{Entity, EntityId};

#[derive(Debug, Default, Serialize, Deserialize)]
pub struct EntityRegistry {
    entities: HashMap<EntityId, Entity>,
}

impl EntityRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    /// Insert an entity. Returns the id (Uuid generated at
    /// `Entity::new` time, or whatever the caller assigned).
    pub fn insert(&mut self, entity: Entity) -> EntityId {
        let id = entity.id;
        self.entities.insert(id, entity);
        id
    }

    #[cfg(test)]
    pub fn get(&self, id: &EntityId) -> Option<&Entity> {
        self.entities.get(id)
    }

    pub fn remove(&mut self, id: &EntityId) -> Option<Entity> {
        self.entities.remove(id)
    }

    /// Mutate an entity in place. Returns `false` if the id is not
    /// present — callers decide whether that's a hard error or a
    /// silent no-op (e.g. mutations racing against deletion).
    pub fn mutate(&mut self, id: &EntityId, f: impl FnOnce(&mut Entity)) -> bool {
        match self.entities.get_mut(id) {
            Some(entity) => {
                f(entity);
                true
            }
            None => false,
        }
    }

    #[cfg(test)]
    pub fn len(&self) -> usize {
        self.entities.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entities.is_empty()
    }

    /// Cloned snapshot of every entity. Used by the tick loop to
    /// build broadcast frames and by the snapshot module (slice 3)
    /// to persist to disk. Returns owned values to avoid holding
    /// the registry's lock across the broadcast.
    pub fn snapshot(&self) -> Vec<Entity> {
        self.entities.values().cloned().collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::entity::{EntityKind, Transform};

    fn make_player() -> Entity {
        Entity::new(
            EntityKind::Player,
            Transform::identity(),
            serde_json::json!({}),
        )
    }

    #[test]
    fn insert_and_get_round_trip() {
        let mut registry = EntityRegistry::new();
        let entity = make_player();
        let id = entity.id;
        registry.insert(entity);
        assert!(registry.get(&id).is_some());
        assert_eq!(registry.len(), 1);
    }

    #[test]
    fn remove_returns_owned_entity_and_drops_from_map() {
        let mut registry = EntityRegistry::new();
        let entity = make_player();
        let id = entity.id;
        registry.insert(entity);
        let removed = registry.remove(&id);
        assert!(removed.is_some());
        assert_eq!(removed.unwrap().id, id);
        assert!(registry.get(&id).is_none());
        assert!(registry.is_empty());
    }

    #[test]
    fn mutate_applies_closure_when_present() {
        let mut registry = EntityRegistry::new();
        let entity = make_player();
        let id = entity.id;
        registry.insert(entity);

        let did_mutate = registry.mutate(&id, |e| {
            e.transform.position = [1.0, 2.0, 3.0];
        });

        assert!(did_mutate);
        let entity = registry.get(&id).unwrap();
        assert_eq!(entity.transform.position, [1.0, 2.0, 3.0]);
    }

    #[test]
    fn mutate_returns_false_for_missing_id() {
        let mut registry = EntityRegistry::new();
        let did_mutate = registry.mutate(&uuid::Uuid::new_v4(), |_| {});
        assert!(!did_mutate);
    }

    #[test]
    fn snapshot_returns_independent_clones() {
        let mut registry = EntityRegistry::new();
        let entity = make_player();
        let id = entity.id;
        registry.insert(entity);

        let snap = registry.snapshot();
        assert_eq!(snap.len(), 1);

        // Mutating registry doesn't affect the snapshot already taken.
        registry.mutate(&id, |e| e.transform.position = [9.0, 9.0, 9.0]);
        assert_eq!(snap[0].transform.position, [0.0, 0.0, 0.0]);
    }
}
