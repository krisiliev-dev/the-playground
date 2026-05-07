# ADR-004: Authoritative Multiplayer Server with Entity-Component State

## Status

Accepted — supersedes [ADR-002](./adr-002-multiplayer-ready.md).

## Date

2026-05-07

## Context

ADR-002 committed to a multiplayer-ready architecture with a relay-style server: clients send their own state, the server rebroadcasts to peers, no authority. That worked as a placeholder but has two problems given the project's evolved end goal:

1. **The end goal isn't just "see other players move."** It's: an Admin role that can spawn portals/models/text, teleport players, scale entities, and make arbitrary scene mutations *in real time*, all without server downtime — Blender-in-the-browser semantics. A relay server can't enforce auth on those mutations or hold the canonical scene state late-joiners need.
2. **Player-centric state can't represent non-player entities.** ADR-002's design assumed the server's only job was tracking `PlayerSession` records. Adding a runtime-spawned portal would require ad-hoc protocol extensions for every new entity type.

A scene with admin-authored content also needs **persistence**: admin work must survive server restarts.

## Decision

We adopt an **authoritative server with an entity-component scene model**, replacing ADR-002's relay design.

### Core architecture

- **Single source of truth.** The server owns a `HashMap<EntityId, Entity>`. Clients send *intents* (input, mutation requests); the server validates, mutates, and broadcasts diffs.
- **Entity model.** Every world object — players, portals, models, text — is an entity. An `Entity` carries:
  - `id: Uuid`
  - `kind: "player" | "portal" | "model" | "text" | …` (open-ended; new kinds added by code, not protocol changes)
  - `transform: { position, quaternion, scale }`
  - `props: serde_json::Value` (kind-specific properties, e.g. portal `pairedWith`/`route`, model `assetUrl`)
- **Tick loop.** Server runs at 30 Hz, broadcasts state diffs (only changed entities) to all connected clients each tick.
- **Client prediction + reconciliation.** Local player input applies optimistically (no perceptible input lag); server tick brings authoritative truth; client snaps if the deviation exceeds threshold, smoothly interpolates if not.
- **Snapshot interpolation for remote entities.** Clients buffer 2–3 server snapshots and interpolate between them in `useFrame`, hiding the 30Hz tick cadence as smooth motion.

### Auth & permissions

- **Two-channel WebSocket.** Both channels run over the same WS connection but carry different message types:
  - Player channel — anyone can send `PlayerInput` for *their own* player entity. Server validates entity ownership.
  - Admin channel — `EntityMutation { id, op: Create|Update|Delete, props }`. Gated by a bearer token verified at WS upgrade. Reuses the existing `is_admin` helper pattern from `handlers.rs`.
- **Token model.** Single admin token from environment variable (`ADMIN_TOKEN`). No user accounts at MVP; the admin is the operator. Multi-user admin is a future ADR.

### Persistence

- **Periodic snapshot to disk.** Server writes the entity registry to `state.json` every 30 seconds, plus on graceful shutdown. Restores on boot. Admin-authored scene work survives restarts.
- **Player entities not persisted.** Player entities are ephemeral (tied to WS lifetime). Only admin-authored entities (kind ≠ player) round-trip through disk.
- **Snapshot file is the durable schema.** Shape of `Entity` is the on-disk shape; protocol mutations align with it. One serialisation, not two.

### What we keep, change, scrap

- **Keep**: connection caps (`MAX_CONNECTIONS`, `MAX_CONNECTIONS_PER_IP` from existing `state.rs`) — re-implemented inside the new design.
- **Change**: `BroadcastMessage` enum reshapes from `{PlayerUpdate, PlayerLeft, EnvironmentUpdate}` into `{EntityCreated, EntityUpdated, EntityDeleted, FullState}`.
- **Scrap**: `video.rs` (326 lines of YouTube conversion machinery — predates the cascade rebuild, no live consumers, video assets already removed from `assets/`). Can be reintroduced as its own service later if needed; not coupled to multiplayer.

## Rationale

### Why authoritative over relay

Relay servers can't enforce ownership ("this client is trying to mutate someone else's player"), can't hold canonical state for late-joiners ("a player joins; what's already in the scene?"), and can't validate admin commands ("did this mutation come from a token-bearing client?"). All three become free with authority.

### Why entity-component over player-centric

Player-centric state is a special case of entity-component state where the only kind is `player`. Generalising upfront is one extra abstraction now versus a full rewrite later when admin mutations land. The protocol becomes uniform: every world change is an entity mutation.

### Why client prediction + reconciliation

Without prediction, every keystroke round-trips through the server before the avatar moves — feels rubbery on anything but localhost. With prediction-only, clients drift from the server over time. The combination is the standard solution (used in Source engine, Unity Netcode, Unreal Replication) and is the only way to make authoritative servers feel like local input.

### Why 30 Hz tick + snapshot interpolation

30 Hz balances bandwidth (≪ 60 Hz) against motion smoothness (≫ enough to interpolate). Snapshot interpolation hides server cadence so remote cursors look as smooth as the local one.

## Consequences

### Positive

- Generalises naturally to any future entity type — admin tooling becomes "send mutations" rather than "extend the protocol."
- Auth is a first-class concept rather than bolted-on.
- Disk persistence makes the admin workflow non-destructive.
- Late-joiner support is automatic — server sends full state on connect.

### Negative

- ~3–4× more upfront server work than ADR-002's relay design (entity model, tick loop, prediction, reconciliation, persistence).
- Client gains a "predicted vs. authoritative" split that requires care to keep visual state stable during reconciliation snaps.
- Snapshot persistence means a corrupt `state.json` can wedge the server on boot. Mitigation: keep last-N snapshots, fall back if the most recent fails to deserialize.

### Migration

ADR-002's "few new files, ~20 lines" promise is voided. Existing `server/src/{state.rs, handlers.rs, video.rs, config.rs, main.rs}` are largely rewritten. The R3F render layer (CursorAvatar, World, scene components) is unchanged — it already reads from a Zustand store, which now becomes the authoritative-state mirror instead of the source of truth.

## Open questions deferred to future ADRs

- Multi-admin auth (multiple operators with role-based permissions).
- Conflict resolution if two admins mutate the same entity simultaneously (current MVP: last-write-wins).
- Asset pipeline for spawned models — where do `.glb` files live, who uploads them, how are they referenced?
- Visible portal traversal (player half-emerged through a portal). Requires entity transforms to be visible to the cascade renderer with stencil-clipped meshes — separate piece of work.
