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
        /// Optional presence-state bag (per ADR-006). Free-form
        /// JSON object whose keys merge into the player entity's
        /// `props` so other clients can render third-person
        /// indicators (menu plane, near-interactable highlight,
        /// etc.). Server treats this opaquely — typed validation
        /// of individual presence fields would couple the server
        /// to the client's UI vocabulary, which the architecture
        /// deliberately avoids.
        #[serde(default)]
        presence: Option<serde_json::Value>,
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
    /// A new asset has been uploaded and is ready to fetch from
    /// `url`. Per ADR-007: lets connected clients pre-warm their
    /// HTTP cache so the first reference (e.g. an admin-triggered
    /// `audio` event citing the asset) plays without a cold-fetch
    /// hitch. Anonymous-actor (broadcast to everyone, not echoed
    /// from a player).
    AssetAvailable {
        id: String,
        url: String,
        extension: String,
        size: u64,
    },
    /// Admin-broadcast kick notification. Targets one player by
    /// id; non-targeted receivers ignore it. The target's client
    /// halts its WS reconnect loop and shows a kick overlay.
    /// The actual WS close happens immediately after via the
    /// `kick_signals` oneshot — this event arrives a beat
    /// before so the client can distinguish "kicked" from a
    /// transient drop.
    KickNotification {
        target_actor_id: String,
        #[serde(default)]
        reason: Option<String>,
    },
    /// Admin-broadcast freeze toggle. Targets one player by id;
    /// non-targeted receivers ignore the event. The target's
    /// client sets a local "frozen" flag that disables input
    /// (mouse + WASD) until a `frozen: false` event for the
    /// same actor arrives. Server-side `frozen` flag in entity
    /// props is the authoritative source for "is X frozen now?"
    /// — this event just notifies the target so its UI updates
    /// without polling its own props bag.
    FrozenStatus {
        target_actor_id: String,
        frozen: bool,
    },
    /// Floating 3D text popup at a world position. Renders as a
    /// billboarded label that fades over `lifetime_ms`. Useful
    /// for admin chat ("you've been frozen"), labels on portals,
    /// or in-world annotations dropped by recipes.
    TextPopup {
        position: [f32; 3],
        text: String,
        /// Hex colour of the text. Falls back to neon cyan if
        /// the receiver can't parse it.
        color: String,
        /// World-space height of the text (drives the
        /// underlying canvas size + rendering scale).
        size: f32,
        lifetime_ms: u32,
    },
    /// Full-screen colour pulse for receivers near the trigger.
    /// Receivers within `radius` of `position` fade in a tinted
    /// overlay (`color`, `peak_alpha`) and fade out over
    /// `duration_ms`. Useful for "the world flashes red" admin
    /// effects or recipe-driven mood swings.
    ColorFlash {
        position: [f32; 3],
        radius: f32,
        color: String,
        peak_alpha: f32,
        duration_ms: u32,
    },
    /// Forcibly teleport a specific player's cursor to a world
    /// position. Server-originated only (admin endpoint); the
    /// target client matches `target_actor_id` against its own
    /// `localPlayerId` and snaps its avatar / cursor / camera
    /// when they match. Other receivers ignore the event since
    /// PlayerInput will catch them up the next tick.
    ForceTeleport {
        target_actor_id: String,
        position: [f32; 3],
    },
    /// Visual particle burst — confetti, sparks, fire spray.
    /// Per ADR-008 §particles: receivers seed a local particle
    /// simulation from these parameters and animate per-frame
    /// independently. The wire carries only the seed, not the
    /// per-particle positions, so bandwidth stays bounded
    /// regardless of `count`.
    ///
    /// Two render modes, picked by whether `model_url` is set:
    ///   - `model_url = None`: each particle is a point sprite
    ///     coloured from the `colors` palette.
    ///   - `model_url = Some(...)`: each particle is an instance
    ///     of the uploaded glb model, tinted per the `colors`
    ///     palette and tumbling at `spin` rad/sec.
    ParticleBurst {
        /// Spawn point of the burst. All particles emit from here.
        position: [f32; 3],
        /// Number of particles to spawn. Server clamps to a
        /// reasonable cap to bound client work.
        count: u32,
        /// Hex colour palette (e.g. `["#ff00ff", "#ffff00"]`).
        /// Each particle picks one at random. In point mode,
        /// drives vertex colour. In model mode, drives a tint
        /// multiplier on the model's base material.
        colors: Vec<String>,
        /// Initial particle speed in world units / sec. Each
        /// particle gets a randomized magnitude in `[0.5x, 1x]`.
        speed: f32,
        /// Total lifetime in ms before particles fade out.
        lifetime_ms: u32,
        /// Spread fraction in `[0, 1]`. 0 = particles emit
        /// straight up; 1 = full sphere distribution.
        spread: f32,
        /// Gravity acceleration along world -Y in
        /// units / sec². 0 = no gravity (zero-G burst).
        gravity: f32,
        /// Per-particle world-space size.
        size: f32,
        /// Optional glb / glTF URL to instance per particle.
        /// When `None`, the burst renders as coloured points;
        /// when `Some`, each particle is an instance of this
        /// model with a random orientation. Use the URL returned
        /// by `POST /api/admin/assets` (e.g. `/assets/ast_….glb`).
        #[serde(default)]
        model_url: Option<String>,
        /// Angular velocity for tumbling (radians / sec). Drives
        /// per-particle rotation in model mode; ignored in point
        /// mode since points have no orientation.
        spin: f32,
    },
}
