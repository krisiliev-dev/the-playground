# ADR-002: Multiplayer-Ready Architecture (Single Player First)

## Status

**Superseded by [ADR-004](./adr-004-authoritative-multiplayer-server.md)** (2026-05-07).

The relay-style design described here was a placeholder while the project was single-player. ADR-004 replaces it with an authoritative, entity-component server motivated by the admin-tooling end goal — see ADR-004 for the migration scope.

Original status: Accepted

## Date

2026-04-05

## Context

The project will eventually support multiplayer — visitors seeing each other as cursor avatars in real time. However, building full multiplayer from day one adds complexity that slows down the core portfolio experience. We need an architecture that starts single-player but doesn't require a rewrite to add multiplayer.

## Decision

Start single-player. Structure code so that **player state is decoupled from rendering** via a Zustand store. When multiplayer is added, only the state source changes — not the rendering components.

## How It Works

### Current (Single Player)

```
[Browser Input] → [useNavigation hook] → [Zustand Store] → [CursorAvatar component]
```

The `useNavigation` hook reads browser events and writes position/rotation to the store. The `CursorAvatar` component reads from the store and renders.

### Future (Multiplayer)

```
[Browser Input] → [useNavigation hook] → [Zustand Store] → [WebSocket] → [Server]
                                                ↑
[Server] → [WebSocket] → [Remote Players slice] → [CursorAvatar × N]
```

Changes required:

1. Add a `remotePlayers` map to the Zustand store
2. Add a `useMultiplayerSync` hook that sends local state over WebSocket and writes incoming remote state to the store
3. Map `remotePlayers` to additional `CursorAvatar` instances in the `World` component

No changes required to: `CursorAvatar`, `BoxEnvironment`, `ZoneMarker`, `WorldLighting`, `useNavigation`, `HUD`, or any other existing component.

## Consequences

- Slight over-engineering for the single-player phase (state indirection where direct mutation would suffice)
- Smooth upgrade path to multiplayer with ~3 new files and ~20 lines of changes to existing code
- The Zustand store acts as the "contract" between local and networked state

## Key Constraint

**No component may directly mutate Three.js objects for position/rotation.** All movement goes through the store. This is enforced by code review and the `useNavigation` hook pattern.
