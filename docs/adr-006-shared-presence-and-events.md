# ADR-006: Shared Visual Presence — Two-Channel State + Event Architecture

## Status

Accepted

## Date

2026-05-07

## Context

[ADR-004](./adr-004-authoritative-multiplayer-server.md) established the authoritative entity-component server. State replication works: clients see each other's positions and orientations smoothly. But the project needs more than mirrored positions — every visual or audio effect a player triggers should be visible to other players, rendered as a third-person view of that player's experience:

- A player hovers an interactable → others see a highlight on the target and a small indicator over the hovering player.
- A player opens the pause menu → others see a 2D menu plane floating in front of that player's cursor.
- A player swings the sword → others see the swing animation, hear the impact at the wall, feel a localized camera shake if nearby.
- A player navigates between rooms via a portal → others see them disappear from the source room and reappear at the destination.

The general principle: **a player IS a remote player, just with their own perspective.** Whatever they see, others see represented in the world.

The naïve approach — replicate everything as state — produces awkward code and bad latency: events become "this entity exists for 50ms then doesn't." The naïve alternative — make everything an event — loses durability, so a late joiner doesn't see who's currently in a menu.

## Decision

We split shared visual data into **two mechanisms** based on lifecycle, both server-mediated:

### Mechanism 1: Continuous presence state (extends entity replication)

Lives in the existing `Entity.props` bag. Replicated automatically by the existing tick-diff machinery. Used for *durations* — things that have an "on" period, observable to a late joiner.

```rust
Entity.props = {
  "name": "...",
  "cursor_color": "#00ffcc",
  "route": "/",
  // Presence:
  "hovering": { "id": "...", "label": "..." } | null,
  "pressed":  { "id": "...", "point": [x, y, z] } | null,
  "menu":     "pause" | "settings" | null,
  "tooltip":  { "text": "...", "anchor": [x, y, z] } | null,
}
```

When a client's local presence changes (e.g. hover starts), it pushes an updated `PlayerInput` carrying the new `props` patch. The server stores; the next tick diff propagates it. Late joiners receive the current state via `FullState`.

**Bandwidth profile**: a few extra bytes per state change. Negligible.

### Mechanism 2: Transient scene events (new dedicated channel)

For *moments* — instantaneous effects that play once and finish:

```rust
ServerMessage::SceneEvent {
  actor_id: Option<EntityId>,
  event: Event,
}

enum Event {
  SwordSwing { from: [f32; 3], to: [f32; 3], strength: f32 },
  SwordImpact { position: [f32; 3] },
  Audio { sound_id: String, position: Option<[f32; 3]>, volume: f32 },
  CameraShake { position: [f32; 3], radius: f32, intensity: f32, duration_ms: u32 },
  // additive — new variants don't break older clients
}
```

Events broadcast once and run once. They do not enter the entity registry, do not persist on disk, and do not appear in `FullState`.

**Bandwidth profile**: per-event packet, fan-out to other connected clients.

## Validation policy

**Optimistic local + server-validated rebroadcast.** The originator triggers their own effect immediately (zero perceived latency). The server validates *before fanning out to others*. If validation fails, only the rebroadcast is suppressed — the originator already saw their own thing.

Validation is **per-variant**, with rate limits and value clamps in a single `validate_event` function:

| Event | Validation |
|---|---|
| `Audio` | Rate-limit ≤ 20/sec per actor; drop excess |
| `SwordSwing` | Cooldown 200ms per actor |
| `SwordImpact` | Cooldown 200ms per actor |
| `CameraShake` | Clamp `intensity` to ≤ 1.0; clamp `duration_ms` to ≤ 1500; rate-limit ≤ 5/sec per actor |

Continuous presence state needs only ownership validation: a client can only mutate `props` on their own entity. (Already enforced for `PlayerInput`.)

**WAN-latency escape hatch**: if production latency makes server validation feel laggy, switching individual variants to "client-decided + server forwards" is a one-line per variant. The default is conservative.

## Client API

Two flavours of API at every leaf, naming convention enforces the share/local split:

```ts
// Local only — UI overlays, mouse-down clicks, pause-menu sounds, etc.
sfx.play('mouseDown');
cameraShake.local({ intensity: 0.2 });
tooltip.localOnly('hint');

// Shared — world-resident effects, rendered for everyone
sfx.playWorld('sword-impact', position, { volume: 0.8 });
cameraShake.world({ position, intensity: 0.5, duration_ms: 400 });
tooltip.show('Click to enter'); // updates presence prop
```

Direct event API for explicit emits:

```ts
emitSceneEvent({ type: 'sword_impact', position: [...] });

useSceneEvent('sword_impact', (event, actor) => {
  // run remote-side effect
});
```

## Third-person presence rendering

A `<RemotePresenceIndicator>` component mounts as a child of each `<RemoteCursorAvatar>`. It reads the entity's presence props and renders:

- **Menu indicator**: a 2D plane floating in front of the remote cursor with a "menu open" treatment. Stylised (not a literal mirror of the local pause menu UI).
- **Hover label**: a small text bubble above the remote cursor naming the interactable they're hovering.
- **Tooltip**: floating text in the world at the tooltip anchor, projected from the remote actor's perspective.
- **Press indicator**: subtle highlight at the pressed target point.

The remote cursor's *lean* toward an interactable is already covered by the existing `cursorWorldQuaternion` sync — no extra work.

## "Menu open" semantics

Per project requirements, opening the pause menu does NOT freeze the remote player's cursor. Their cursor continues to broadcast pose updates (likely zero motion since their input is in the menu, but technically still alive). The "in menu" indicator is purely the floating 2D plane.

## Why this shape

- **Two mechanisms because there are two genuine concepts.** Duration vs moment. Late-joiner-relevant vs not. Trying to unify them produces awkward code at every layer.
- **Server validation by default, escape hatch per-variant.** Anti-griefing without paying upfront for problems that may not arise.
- **`xxxWorld` vs `xxxLocal` naming convention** makes the share-or-not choice explicit at every leaf. Most calls use the world variant; the few local-only calls (UI feedback) are obvious.
- **Presence as props** rides the existing replication machinery for free — no new infrastructure for what's effectively "extended player state."

## Consequences

### Positive

- New visual or audio effects automatically inherit the share path by following the wrapper convention. The cost of "make it visible to others" is one function name choice.
- Late joiners see the current world state including who's in menus, who's hovering what — no event-replay needed.
- Validation is centralised and per-variant; throttling a griefer is a config tweak.
- Clean conceptual model: every player has a self-view and a world-view of themselves; the architecture maintains both.

### Negative

- Adds a third mode of replication on top of "entity transform" and "snapshot interpolation" — though the third mode (events) is a thin layer.
- Wrapper convention requires discipline: a developer who calls `sfx.play` for what should be a world sound silently makes it local-only. Lint rule could enforce.
- Server-side per-variant rate limiting needs careful tuning — too restrictive and legitimate effects get dropped; too loose and griefing is possible. Initial values are conservative; revisit with telemetry.

### Migration

This is additive. Nothing existing breaks. Specific effects migrate to the world variant one at a time, each as an isolated change.

## Out of scope (deferred to future ADRs)

- **Spatial audio** — `Audio` events carry a position, but actually 3D-positioning the playback is a separate effort (Web Audio API panner nodes).
- **Voice chat** — different protocol entirely (WebRTC); not covered here.
- **Full pause-menu mirror** — the 2D plane in front of remote cursors is stylised, not a render-target mirror of the actual pause menu UI. Mirroring is a future feature if desired.
- **Client-side prediction for events** — the originator already gets zero-latency local trigger via optimistic-local. Reconciliation (server says "no, that wasn't allowed") for events is currently silent-drop; could be enriched with rollback later.
