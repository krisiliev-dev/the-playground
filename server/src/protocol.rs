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
    /// Soft error reply (validation rejection, unauthorised
    /// mutation, etc.). Doesn't terminate the connection — the
    /// client decides how to surface this to the user.
    Error { message: String },
}
