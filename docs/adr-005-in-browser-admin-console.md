# ADR-005: In-Browser Admin Console with Direct-Manipulation Editing

## Status

Accepted

## Date

2026-05-07

## Context

[ADR-004](./adr-004-authoritative-multiplayer-server.md) introduces an authoritative server that accepts arbitrary entity mutations from an authenticated admin. The remaining design question: **what tool does the admin use to author those mutations?**

The end goal is Blender-/Unreal-class real-time control: the operator should be able to spawn portals, models, and text in the live scene, drag entities to position/rotate/scale them, edit properties, teleport players, all without touching code or restarting the server. The admin should "be a player" with elevated permissions — flying around the actual world while editing it.

Three categories of options were considered:

1. **External 3D tools** — Blender or Unreal driving the runtime via plugin
2. **External editor frameworks** — Three.js Editor (fork), Theatre.js, Polygonjs
3. **Custom in-browser admin route** — bespoke editor sharing the runtime renderer

## Decision

We build a **custom in-browser admin route** at `/admin`, sharing the same React Three Fiber render pipeline as the player view. The admin is a player entity with elevated permissions; their cursor moves through the world while authoring it.

### Editor stack

- **`<TransformControls>` from `@react-three/drei`** — drag-handle gizmos for translate / rotate / scale on the selected entity. Same UX as Blender / Unity / Unreal: colored arrows for translation, arcs for rotation, boxes for scale. The primary editing surface; numeric inputs are the fallback for exact values.
- **Leva** — battle-tested R3F-community React panel library for property inspection / number / color / text inputs. Used for entity properties beyond transform (rim color, portal `pairedWith`, model `assetUrl`).
- **Hand-rolled hierarchy panel + selection state** — ~200 lines of React, kept in-tree so it can know our entity types natively (different icons/affordances per kind).
- **Command-pattern undo stack** — every mutation is a `Command` with `apply` and `revert`. Stack lives in the admin slice of the Zustand store, persists across sessions in `localStorage`. Phase 2 (post-MVP).

### Routing & auth

- `/admin` route, gated by a bearer token entered at first load and persisted to `localStorage`. Wrong/missing token → redirect to `/`. Same token authorises the admin WS channel from ADR-004.
- The admin route renders the **same `<World>`** as `/`, plus an `<AdminOverlay>` containing the hierarchy + inspector + transform-mode toggles. No separate render pipeline.

### Mutation flow

```
[Admin drags gizmo]
   → onDrag fires per-frame
   → throttle to 30 Hz
   → emit EntityMutation { id, op: 'update', props: { transform } }
   → server validates, applies, broadcasts to all clients
   → all clients (including admin's own) reconcile
```

The admin's local view also predicts (same prediction as ADR-004's player movement), so dragging feels instant. Reconciliation snaps if the server rejects.

### Spawn & delete

- **Toolbar with primitive shapes** — a row of buttons (Portal / Cube / Text / Model) creates a new entity at the admin's cursor position with sensible defaults. Edit afterwards via gizmo + Leva panel.
- **Delete key on selected entity** — `EntityMutation { op: 'delete' }`.

## Rationale

### Why not Blender (or Unreal)

Blender has a Python API and could be made to push WebSocket mutations on every depsgraph update. The fundamental mismatches:

- **Data model.** Blender's objects know about meshes, modifiers, materials. They have no notion of "portal" or "interactable" or "route-tagged entity." Every custom kind requires Blender custom properties + a translation layer in the plugin. That layer is the actual editor; Blender is just the host UI.
- **Real-time edit cadence.** Blender depsgraph updates at edit-event granularity (e.g. every frame while dragging a transform handle). Either you spam the server with hundreds of mutations per second, or you debounce — at which point you've reimplemented mutation throttling.
- **Workflow friction.** The admin authors the scene in Blender, then has to alt-tab to the browser to *see what they made* in the actual runtime. The "fly around your world while editing" goal is impossible.
- **Plugin maintenance.** Blender API changes between versions; addon authors re-test on every Blender release. That's perpetual maintenance for no net win.

Unreal compounds all the above — it's a complete engine that wants to *be* the runtime, not drive a different one.

### Why not Three.js Editor (forking)

Three.js Editor is the closest reference — it's open source and built on the same renderer we use. But its data model is generic Three.js objects. Forking it and adapting our entity types means:

- Replacing its scene serialisation with our entity registry.
- Replacing its panel system (it uses a custom non-React UI) with ours.
- Replacing its undo/redo with ours.
- Inheriting its overall UI/UX which doesn't match our app.

Empirically, this reaches "complete rewrite" before it reaches "useful integration." The primitives we'd actually reuse (`TransformControls`) are already exposed via drei.

### Why not Theatre.js / Polygonjs

These solve animation timelines (Theatre.js) and procedural authoring (Polygonjs). Both excellent at their slices, but they impose an authoring abstraction (timeline / node graph) that doesn't fit "I want to spawn a portal here, now." Could be additive *layers* on top of the basic editor in a later phase, not the foundation.

### Why browser, not desktop (Tauri/Electron)

The desktop pitch is more screen real-estate and native menus. Costs:

- **Either re-render the world twice** (heavy: full R3F pipeline running in admin tool *and* in a browser tab to validate) — or render abstract lists/forms in the desktop tool with a separate browser preview, which is strictly worse than just doing both in one browser route.
- **Two codebases to ship** — auto-update channel for the desktop tool, plus the existing browser deploy.
- **Slower iteration** — no hot-reload across the WS boundary in a desktop wrapper.

The "fly around your world while editing" model is *more* natural in-browser — the admin literally is a player. Desktop wrapping (Tauri shell around the browser route) is a trivial future addition if cosmetics demand it.

### Why direct manipulation over forms

Numeric form input ("set position to 12.4, -3.1, 0.7") is precise but disembodied. You can't see what you're doing without alt-tabbing between form and viewport. Drag gizmos collapse "see" and "edit" into the same place — the canonical insight from Susan Brennan's direct-manipulation work and every successful 3D editor since. Numeric input remains as the precision fallback (Leva panels).

## Consequences

### Positive

- Editor knows our entity types natively — no translation layer.
- Same render pipeline as player view → WYSIWYG, no preview drift.
- Hot-reload during development, single deploy target.
- Extending to new entity kinds is "add a kind to the entity enum + a Leva panel definition," not "update the plugin."
- Direct-manipulation gizmos give the Blender-like feel without the Blender-shaped problems.

### Negative

- We own the editor UI long-term — bug reports, feature requests, undo edge cases, all on us.
- TransformControls from drei isn't infinitely customisable; if we need exotic gizmos (e.g. mesh deformation handles) we'll write them ourselves.
- An untrained admin user could break the live scene with a misclick. Mitigation: undo stack (phase 2), confirmation modal on bulk deletes.

### Stack lock-in

Choosing R3F + drei + Leva commits us to that ecosystem for editor work. If we ever swap renderers (e.g. to Babylon.js), the editor follows. Acceptable given ADR-001 already commits to client-side WebGL via Three.js.

## Implementation phases

1. **Phase 1 (MVP)** — Admin route gated by token. Render world. Click an entity to select. `<TransformControls>` for transform. Leva panel for non-transform properties. Spawn toolbar with one entity kind (portal). Delete key. No undo.
2. **Phase 2** — Hierarchy panel. Multi-select. Undo stack. All entity kinds in spawn toolbar.
3. **Phase 3** — Asset upload pipeline (drag a `.glb` onto the canvas → uploads to server → spawns model entity referencing it).
4. **Phase 4** — Animation / scripted behavior (Theatre.js-style timelines for entity properties).

Phases 1–2 are part of the same multiplayer rollout as ADR-004. Phases 3–4 are separate efforts, with their own ADRs as scope clarifies.
