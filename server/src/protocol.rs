//! Wire protocol — messages exchanged over WebSocket.
//!
//! Per ADR-004, the protocol uses two logical channels over the
//! same connection:
//!   - `ClientMessage` — what the browser sends. Player input is
//!     always allowed; admin mutations require a valid bearer
//!     token on the upgrade request.
//!   - `ServerMessage` — what the server broadcasts. Includes
//!     full-state snapshots for late joiners and per-tick diffs
//!     for steady-state.
//!
//! This module is the *shape*; slice 2 wires it into the WS
//! handler + tick loop.
use serde::{Deserialize, Serialize};

use crate::entity::{Entity, EntityId, Transform};

/// Inbound — from a client to the server.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ClientMessage {
    /// Local player intent. Server applies prediction / validation
    /// and broadcasts. Only valid for the client's own player
    /// entity (server enforces ownership).
    PlayerInput {
        transform: Transform,
        /// Currently active route, e.g. "/" or "/about". Drives
        /// per-route portal visibility for remote viewers.
        route: String,
    },
    /// Admin-authored entity mutation. Requires admin token at
    /// WebSocket upgrade time; the server rejects this variant
    /// from non-admin connections.
    EntityMutation { op: EntityOp },
    /// One-shot transient effect originated by this client. Per
    /// ADR-006: optimistic local + server-validated rebroadcast.
    /// The originator already played the effect locally; the
    /// server validates per-variant (rate limits, value clamps)
    /// before fanning out to other connected clients. Validation
    /// failures are dropped silently — the originator's local
    /// effect is unaffected.
    SceneEvent { event: SceneEventKind },
}

/// Inbound mutation variants — one per CRUD verb plus ergonomic
/// helpers. `Update` carries a sparse patch (only the fields the
/// admin changed) so a transform-only edit doesn't have to
/// resend props.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum EntityOp {
    Create {
        entity: Entity,
    },
    Update {
        id: EntityId,
        #[serde(default)]
        transform: Option<Transform>,
        #[serde(default)]
        props: Option<serde_json::Value>,
    },
    Delete {
        id: EntityId,
    },
}

/// Outbound — from the server to all subscribed clients.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ServerMessage {
    /// Full state dump — sent to a client immediately on connect
    /// so they don't miss entities created before they joined.
    /// Also useful as an authoritative reset if a client's local
    /// state ever drifts past the reconciliation threshold.
    FullState {
        entities: Vec<Entity>,
        /// The receiving client's own player entity id, so the
        /// client knows which entity to predict locally.
        your_player_id: EntityId,
    },
    /// One or more entities have been created or had their
    /// transform/props mutated. Sent on each server tick that
    /// has changes. Empty diffs are not broadcast.
    EntityUpdates { entities: Vec<Entity> },
    /// One or more entities have been deleted. Sent immediately,
    /// not batched into a tick (delete is rare and visually
    /// disruptive — propagate fast).
    EntityDeleted { ids: Vec<EntityId> },
    /// One-shot transient effect originated by another client,
    /// rebroadcast after server-side validation. Carries the
    /// originating actor's id so receivers can render relative
    /// to that actor (e.g. camera shake centered on their world
    /// position, audio panning, indicators). Per ADR-006,
    /// receivers do NOT get back their own events — the server
    /// excludes the originator from the fan-out, since they
    /// already played the effect locally.
    SceneEvent {
        actor_id: Option<EntityId>,
        event: SceneEventKind,
    },
    /// Soft error reply (validation rejection, unauthorised
    /// mutation, etc.). Doesn't terminate the connection — the
    /// client decides how to surface this to the user.
    Error { message: String },
}

/// Discriminated-union of every transient effect type the wire
/// supports. New variants are additive — older clients ignore
/// unknown variants gracefully (the client's `match` falls through
/// to a no-op branch). Per ADR-006 §validation policy, the
/// server applies per-variant rate limits + value clamps before
/// rebroadcast.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SceneEventKind {
    /// Sword swing initiated. `from`/`to` are world positions of
    /// the swing endpoints; `strength` is a normalised intensity
    /// (0..=1) used for trail-effect scaling and impact volume.
    SwordSwing {
        from: [f32; 3],
        to: [f32; 3],
        strength: f32,
    },
    /// Sword impact at a world position. Drives synchronised
    /// audio + localised camera shake on receivers near the hit.
    SwordImpact { position: [f32; 3] },
    /// Audio cue. `position` is optional — when present, used
    /// for spatial panning at the receiver; when absent, played
    /// as a 2D ambient cue.
    Audio {
        sound_id: String,
        #[serde(default)]
        position: Option<[f32; 3]>,
        volume: f32,
    },
    /// Localised camera shake. Receivers within `radius` of
    /// `position` shake by `intensity` for `duration_ms`.
    CameraShake {
        position: [f32; 3],
        radius: f32,
        intensity: f32,
        duration_ms: u32,
    },
}
