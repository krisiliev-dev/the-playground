//! Entity model — the unit of scene state.
//!
//! Per ADR-004, every world object (players, portals, models, text)
//! is an `Entity`. The registry stores a `HashMap<EntityId, Entity>`
//! that's the single source of truth; clients see snapshots and
//! diffs of this map.
//!
//! `props` is intentionally `serde_json::Value` so new entity kinds
//! can be added by code (extending `EntityKind`) without changing
//! the on-the-wire shape. The cost of that flexibility is that
//! validation of kind-specific properties happens at the application
//! layer, not at the type system layer; the trade-off is acceptable
//! for the editor-driven workflow this server supports.
use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub type EntityId = Uuid;

/// What kind of thing the entity represents in the scene. Open
/// enum: new variants are added by code, not by the protocol —
/// older clients that don't know a kind will simply ignore those
/// entities (they have no rendering branch for them).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EntityKind {
    /// A connected human (or admin). Tied to a WebSocket session.
    Player,
    /// A portal pair endpoint. Mostly for admin-spawned portals;
    /// the cube-formation portals stay client-side authored at MVP.
    Portal,
    /// A loaded `.glb` mesh referenced by URL in `props`.
    Model,
    /// Floating text in 3D space (Troika under the hood).
    Text,
}

/// World-space transform. Quaternion (not Euler) to stay consistent
/// with the client's avatar pose representation and avoid gimbal
/// edge cases when the admin rotates entities to non-axis-aligned
/// orientations.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Transform {
    pub position: [f32; 3],
    /// (x, y, z, w) — Three.js / glTF convention.
    pub quaternion: [f32; 4],
    pub scale: [f32; 3],
}

impl Transform {
    /// Identity transform — origin, no rotation, unit scale.
    pub fn identity() -> Self {
        Self {
            position: [0.0, 0.0, 0.0],
            quaternion: [0.0, 0.0, 0.0, 1.0],
            scale: [1.0, 1.0, 1.0],
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Entity {
    pub id: EntityId,
    pub kind: EntityKind,
    pub transform: Transform,
    /// Kind-specific properties. Shape per kind:
    ///   Player: { name: string, cursor_color: string, route: string }
    ///   Portal: { paired_with: EntityId|null, route: string, color: string }
    ///   Model:  { asset_url: string }
    ///   Text:   { content: string, color: string }
    /// Treated as opaque on the wire; the application layer
    /// validates per-kind on mutation.
    #[serde(default)]
    pub props: serde_json::Value,
}

impl Entity {
    pub fn new(kind: EntityKind, transform: Transform, props: serde_json::Value) -> Self {
        Self {
            id: Uuid::new_v4(),
            kind,
            transform,
            props,
        }
    }
}
