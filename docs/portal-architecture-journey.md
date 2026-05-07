# Portal Architecture — Journey & Lessons

A retrospective on the in-flight refactor of the playground's portal
rendering pipeline. Captures what we tried, what worked, what didn't,
and what's still open.

## Why the refactor

The pre-refactor architecture rendered each room at a far world-space
position (slot × 600 lateral, 300+ behind the cube wall). Looking
through a cube portal at a room used a stencil-based mirror pipeline
(`PortalsManager`) with Lengyel oblique near-plane clipping. This
worked but accumulated structural complexity:

- **Invasive `gl.render` override** in `PortalsManager` that wrapped
  every R3F render call.
- **Two parallel rendering paths** (RTT in `Portal.tsx`, stencil in
  `PortalsManager.tsx`) toggled by `STENCIL_PORTALS_ENABLED`.
- **Scattered camera-layer constants** across four files
  (`PORTAL_LAYER`, `CURSOR_LAYER`, `PORTAL_DECORATION_LAYER`,
  `ROOM_LAYER_BASE`).
- **`GridMaterial` portal-cutout discard** coupling a shader to a
  scene-graph concern.
- **Lengyel projection math** numerically sensitive to camera-to-
  plane distance — produced degenerate `e[14] ≈ -460` projections
  when world-space rooms were 600+ units away, crushing depth
  precision and z-fighting destination geometry.
- **Adding a new room required edits to 5+ files** with risk of
  spatial / layer / pairing conflicts.

Diagnosis: rendering and traversal were tangled. Each room living at
a *physical* world position (so the avatar can walk to it) was being
forced to *also* be rendered through portals via mirror-camera
gymnastics. Two jobs sharing one mechanism, neither clean.

## Proposed architecture

Each location is its own `THREE.Scene` mounted via R3F's
`createPortal`. A `SceneHost` component swaps `state.scene` (and
therefore the canvas's rendered scene + EffectComposer chain) based
on `currentRoom` in the world store. Portal discs become RTT
windows: each disc renders the destination scene to its own FBO
with a virtual camera positioned in the destination scene's local
coordinate frame, then samples the FBO via clip-space UV.

What this kills:

- `gl.render` override → replaced by R3F's normal flow.
- Lengyel oblique clipping → no distance-dependent projection.
- Per-room layer juggling → scenes are physically separated.
- `STENCIL_PORTALS_ENABLED` flag → one rendering path.
- `GridMaterial` portal-cutout uniforms → portal disc *is* the
  cutout.

## Phases planned

1. **Phase 1** — Infrastructure: `sceneRegistry`, `SceneHost`,
   `PortalDisc`, no visible change.
2. **Phase 2** — Proof: migrate one room (About) and validate that
   the cube → room view via the new path looks right while the other
   two rooms still use the legacy stencil pipeline.
3. **Phase 3** — Migrate Projects + Writing.
4. **Phase 4** — Delete `PortalsManager`, `STENCIL_PORTALS_ENABLED`,
   layer constants except cursor, GridMaterial cutout, and clean up
   `portalActivation` / `portalCross`.

## What got built

- `client/src/scenes/sceneRegistry.ts` — module-level
  `THREE.Scene` instances per scene id (`cube`, `room-about`,
  `room-projects`, `room-writing`).
- `client/src/scenes/CubeScene.tsx` — `createPortal` wrapper that
  re-parents the existing cube content into `getScene('cube')`.
- `client/src/scenes/SceneHost.tsx` — `useEffect` on `currentRoom`
  that calls `state.set({ scene: targetScene })` and
  `invalidate()`. Also enables `CURSOR_LAYER` on the camera so the
  avatar renders in non-cube scenes (PortalsManager normally
  handles that in a final pass for the cube).
- `client/src/scenes/rooms/AboutRoom.tsx` — self-contained About
  scene at local origin: inverted box with `GridMaterial`, plus an
  entry `<PortalDisc>` back to cube with the cube About-pie's
  world pose passed as `destinationEntryPosition` /
  `destinationEntryQuaternion`.
- `client/src/components/scene/PortalDisc.tsx` — RTT-based portal
  disc replacing the stencil mirror. Owns its own FBO, places the
  virtual camera using `destEntry × disc⁻¹ × camera` (no R180Y, no
  Lengyel), samples the FBO via clip-space UV. Uses
  `useInteractable` so click and walk-cross still work.
- `Portals.tsx` — About pie special-cased to use `<PortalDisc>`
  instead of the legacy `<Portal>` component.

What got modified:

- `portalActivation.ts` — added `MIGRATED_ROOM_LOCAL_ENTRY` map so
  About teleport lands at scene-local `(0, 0, -ROOM_ENTRY_INSET)`
  instead of legacy world-space.
- `CursorAvatar.tsx` — three changes:
  - Re-parents the avatar group via `Object3D.attach()` to the
    active scene each time `currentRoom` changes.
  - Special-cases the wall-clamp for `room-about`: scene-local
    bounds + portal hole at scene-local `(0, 0, 0)` with inward
    normal `(0, 0, -1)` so the avatar can walk back through.
  - Special-cases the walk-cross active-portal list for
    `room-about` with a hardcoded definition matching
    `AboutRoom.tsx`'s placement.

## What worked

- **`createPortal` for scene multiplexing.** Mounting room content
  via `createPortal(content, getScene('room-about'))` keeps the
  React tree intact while putting the actual `THREE.Object3D`
  hierarchy in a dedicated scene. `state.children.length` confirms
  the mount.
- **`state.set({ scene })` for active-scene swap.** Updating
  `state.scene` propagates to `gl.render` and `EffectComposer`
  cleanly. `frameloop="demand"` requires explicit `invalidate()`
  after the swap.
- **`Object3D.attach()` for moving the avatar** between scenes.
  Preserves world transform (avatar doesn't snap).
- **Per-room layers as an isolated optimization.** Even before the
  full architecture migration, moving each room's geometry off
  layer 0 onto a unique layer (`ROOM_LAYER_BASE + index`) and
  having the destination camera enable only that layer reduced
  cube → room destination indices from ~10K to 42 (just the
  room's box mesh). Confirmed via Spector capture.
- **`PORTAL_DECORATION_LAYER` (3)** for portal rim/spokes/hub/
  particles. Hides them from destination renders so the cube
  portal doesn't appear as a "feature in the distance" inside the
  room→cube view.
- **Avatar follow via `Object3D.attach()`** in a `currentRoom`-
  driven `useEffect` works once the avatar is mounted at the *root*
  R3F context (not inside a `createPortal` subtree).

## What didn't work, or was harder than expected

- **Lengyel oblique near-plane clipping.** Designed for a virtual
  camera *outside* the destination space. Trying to keep it while
  the new architecture put the camera *inside* the destination
  caused the formula to clip out the room's interior. Removing it
  in some configurations exposed empty space "between" the source
  and destination that read as transparency.
- **R180Y in the mirror transform.** The standard Portal-game
  formula assumes both source and destination portals share an
  orientation convention. Our destination portal (room entry) was
  built with `setFromUnitVectors(+Z, -clickHit.normal)` which bakes
  a 180° rotation into the dest's quaternion — the formula's R180Y
  then double-flipped, landing the virtual camera *outside* the
  destination room facing the wrong direction. Removing R180Y
  fixed position but kept rotation wrong.
- **Avatar position is world-space everywhere.** The wall-clamp,
  walk-cross detection, and camera-follow all assume the avatar's
  position is in cube-world coordinates. Migrating a room to
  scene-local coords meant teleporting the avatar to a small
  scene-local position — but the wall-clamp immediately yanked it
  back to the legacy world-space room bounds. Fix was a series of
  branches in `CursorAvatar` that special-case the migrated room.
  The condition is repeated several times across the file,
  highlighting that scene-local avatar position is a deeper
  architectural change.
- **`PortalDisc` virtual-camera math.** The simple form
  `dest⁻¹ × camera` works only when the destination scene's
  matching portal sits at *local origin*. For room → cube the
  cube's matching portal is at the clickHit point in cube scene,
  not origin. Adding `destinationEntryPosition` /
  `destinationEntryQuaternion` props let the virtual camera anchor
  correctly, but the rotation conventions on the two ends of the
  pair still need to match exactly or the resulting view is
  flipped or pointed away from the destination geometry.
- **`shaderMaterial` defaults to `FrontSide`.** Once disc
  orientation was fixed, the disc itself disappeared because the
  player was looking at the back of its triangles. `DoubleSide`
  fixes this, but the issue was easy to miss after a math change.
- **`createPortal` sub-stores don't share `pointer` state.** The
  most surprising trap. R3F's createPortal creates a sub-Zustand
  store; mouse position (state.pointer, used by `PointerCursor`)
  is updated only on the root store by the canvas's event
  handlers. Putting `<CursorAvatar>` inside the `<CubeScene>`
  createPortal subtree made `PointerCursor` read `(0, 0)` (NDC
  center) every frame and the cursor froze at screen center. Fix
  was to move `<CursorAvatar>` to the root R3F context (sibling of
  `<CubeScene>`) and use `Object3D.attach()` to re-parent its
  group to the active scene as needed.

## Lessons learned

1. **Avatar coordinates are foundational.** When the avatar's
   position is a single world-space `Vector3`, every system that
   reads or writes it implicitly assumes that one coordinate frame.
   Per-scene rendering forces *two* frames (cube vs room) and the
   bridging logic gets repetitive. A clean phase 4 should move the
   avatar's position into a "scene-local" abstraction with a
   "current scene" handle.

2. **Match conventions on both ends of a portal pair.** Source and
   destination discs need to use the *same* orientation
   convention, or the mirror math gets asymmetric and falls apart
   for one direction while seeming to work for the other.

3. **`createPortal` is for scene-graph, not React-tree.**
   Components inside a createPortal subtree get a different
   sub-store. Pointer events, hover state, and other live R3F
   state aren't necessarily shared. Default to keeping interactive
   components at the root context and re-parenting their THREE
   nodes manually if needed.

4. **Per-room layers are a small, high-value isolated change.**
   Even without the bigger architecture migration, moving each
   room's geometry to a unique layer and having the portal's
   destination camera enable only that layer eliminates
   cross-room visual leakage and dramatically reduces destination
   render cost. Worth keeping even if the full per-scene migration
   is deferred.

5. **Lengyel oblique clipping has a narrow comfort zone.** It
   works well when the virtual camera is close to the destination
   plane and outside the destination space. Outside that envelope,
   the projection matrix becomes degenerate. Avoid it unless you
   specifically need the rasterizer-level near-plane clip.

6. **`shaderMaterial` defaults to `FrontSide`.** When changing a
   disc's orientation always check whether the player is looking
   at the front or back, and use `DoubleSide` for portal-style
   discs that should be visible from either side.

7. **`frameloop="demand"` requires explicit `invalidate()`** after
   any state change that should trigger a render. `state.set` does
   not auto-invalidate.

8. **Diagnostic numbers beat speculation.** A Spector capture
   counting indices per portal pass (10K vs 134K), a console log
   of `scene.children.length` after a swap, a single
   `camera.position.toFixed(1)` log on activation — each of these
   collapsed an hour of "could it be X?" into a definitive answer
   in seconds.

## Current state (paused mid-phase)

Working:

- About cube portal pie uses `<PortalDisc>` for its visual.
  Looking into it from the cube shows the room interior as an RTT
  window with parallax.
- Walking through the About pie teleports the avatar to scene-
  local About coordinates and `SceneHost` swaps the canvas to
  render the About scene.
- The avatar follows the player into the About room and back.
- Walking through the entry portal in About teleports back to the
  cube.
- Cursor mode tracks the mouse correctly.
- Projects + Writing rooms still use the legacy world-space +
  stencil pipeline (untouched).

Not working / open:

- The room → cube view through the entry portal doesn't show the
  cube as expected. The math anchoring the virtual camera at the
  cube's matching portal pose works in principle but the visible
  result still doesn't match expectation (sword handles around
  the rim). Either the `destinationEntryQuaternion` derivation
  from `clickHit` is wrong, or the player's vantage inside the
  room isn't the geometry the user is mentally picturing for
  "looking through this portal at the cube I came from."
- Projects + Writing rooms are not migrated.
- `PortalsManager`, the legacy `Portal` RTT code, layer constants,
  GridMaterial cutout uniforms, and the `STENCIL_PORTALS_ENABLED`
  flag are still present.
- `applyPortalActivation` and `CursorAvatar` carry hardcoded
  `room-about` branches; phase 4 should generalize them.

## Next concrete steps when resuming

1. **Validate the back-portal math** by shipping a test scene
   where a cube destination is rendered through a room entry
   disc, and the visible result is compared frame-by-frame
   against the legacy stencil pipeline's output for the same
   pair.
2. **Move avatar position to scene-local coords.** Add a
   `currentScene` concept that owns the avatar's coord frame.
   Wall-clamp + walk-cross + camera-follow all read scene-local.
   This eliminates the special-case branches in `CursorAvatar`.
3. **Migrate Projects + Writing** the same way as About.
4. **Delete `PortalsManager` and friends** once nothing depends
   on them.

## Code paths to remember

- New: `client/src/scenes/`, `client/src/components/scene/PortalDisc.tsx`.
- Modified: `App.tsx`, `World.tsx`, `Portals.tsx`,
  `CursorAvatar.tsx`, `portalActivation.ts`, `Portal.tsx` (added
  `PORTAL_DECORATION_LAYER`).
- Legacy still in use: `PortalsManager.tsx`, `portalRegistry.ts`,
  `portalConfig.ts`, the RTT half of `Portal.tsx`, the per-room
  `ROOM_LAYER_BASE` machinery in `Rooms.tsx`.

---

## Wave 1–4 cleanup pass (2026-05-03)

After the per-room-scene refactor stalled on the back-portal RTT
view, four agent reports converged on three high-payoff
simplifications. Waves 1, 2, and a partial 4 landed; Wave 3 was
deferred for cost/value reasons.

### Wave 1 — Pure deletions ✅

- **Deleted** `PortalsManager.tsx` (~600 lines), `portalConfig.ts`,
  `portalRegistry.ts`. The stencil-buffer pipeline and its
  `gl.render` override are gone.
- **Simplified** `Portal.tsx` from 401 → 191 lines: removed
  stencil-mode branch, RTT material, Lengyel oblique math,
  `sceneLayer` prop, registry calls, `PORTAL_LAYER` and
  `PORTAL_DECORATION_LAYER` exports. Now just a `meshStandardMaterial`
  disc + `useInteractable`.
- **Cleaned** `Portals.tsx`: dropped the per-decoration-layer
  traversal `useEffect` that existed only for stencil pipeline.
- **Cleaned** `Rooms.tsx`: dropped the per-room layer assignment
  (`mesh.layers.set(sceneLayer)`) and `ROOM_LAYER_BASE`.
- **Dropped** `hls.js` from `package.json` — never imported.
- **Updated** test mocks accordingly.

End state: one rendering path (`PortalDisc` for migrated rooms
via R3F `createPortal` into per-scene `THREE.Scene` instances).
Projects/Writing pies render as plain colored discs until they're
migrated in Wave 5.

### Wave 2 — Centralizations ✅

- **`reveal/constants.ts`** now also owns the canonical reveal-
  phase durations (`ARMED_DURATION_S/MS`, `SWINGING_DURATION_S/MS`,
  `IMPACT_DURATION_S/MS`, `HAZE_FADE_DURATION_S`).
  `RevealOrchestrator.tsx` and `Haze3D.tsx` now import from there
  rather than re-declaring locally.
- **`sceneLayers.ts`** — single home for `CURSOR_LAYER`. The
  legacy layer constants are gone; this is the only one left.
  `CursorAvatar.tsx` re-exports from this file for backwards
  compatibility with existing imports.
- **`__tests__/mocks/r3f.ts`** — shared `createR3FMock()` and
  `createDreiMock()` factories. New tests should use them. The
  ~13 existing tests still inline their mocks; migrating those is
  mechanical and low-risk and can happen incrementally.

### Wave 3 — Deferred ⏸️

The agent reports flagged two cleanups: extract `InteractionSlice`
to its own Zustand store (~153 callsites, ~20% re-render reduction
in interactive scenes) and unify the three `pendingPortalActivation`
/ `pendingNavigation` / `pendingPointerLock` signals into a single
typed event-bus (~77 callsites). Both are clarity/perf wins, not
bug fixes; both require touching every consumer plus their tests.
Deferred as a focused future pass with comprehensive test coverage.
Captured here so the next agent picks up where this one stopped.

### Wave 4 — CursorAvatar enum ✅ (partial)

- **`cursorMode.ts`** — explicit `CursorMode` enum with five
  named states (`PointerLive`, `PointerWorldFrozen`,
  `PointerCameraAnchored`, `AvatarInitialPan`, `AvatarSteady`)
  plus pure `computeCursorMode(input)` deriver and `isAvatarMode()`
  helper. The boolean rules previously scattered across
  `<PointerCursor>` and `<AvatarCursor>` now live in one place.
- **`__tests__/scene/cursorMode.test.ts`** — 8 unit tests covering
  every mode transition. If the rules change, the test fails
  visibly at review time.
- **Deferred:** the inline if/else chains in `<PointerCursor>` and
  `<AvatarCursor>` weren't rewritten to consume the enum yet —
  that's a 100+ line refactor of a critical component and the
  cursor-stuck-in-cursor-mode bug history shows how subtle the
  code is. The enum exists; consumers should migrate to it
  incrementally, starting with new branches.
- **Also deferred:** extracting `useMouselook()`/`useTouchInput()`
  hooks (200+ lines moved across components) and moving
  `avatarPos`/`avatarYaw`/`avatarPitch` from refs into the store
  (medium-high effort, biggest correctness/observability win).
  Captured here for the next pass.

### Net change after Waves 1, 2, and partial 4

- **~800 LoC of legacy machinery removed** (PortalsManager, dead
  branches in Portal.tsx, registry, config flag).
- **One source of truth** for reveal timing, the surviving layer
  constant, and (going forward) R3F test mocks.
- **One source of truth** for cursor-mode rules, with tests.
- **All 596 tests still pass** (588 pre-existing + 8 new).
- **Zero behavioural change** for the active codepath; About
  portal still works via the new architecture, Projects/Writing
  pies render as plain discs awaiting Wave 5 migration.

---

## Fault-free portal pass (Tier 1 + 2 + 3)

After Waves 1–4 landed, two focused agents reviewed the
remaining portal mechanism (rendering math + traversal control
flow). They converged on a small set of concrete fixes,
prioritized as Tier 1/2/3. All three tiers landed.

### Tier 1 — convention + race-free traversal ✅

- **R180Y quaternion on the room entry disc.** Both portals in a
  pair now share the convention "local +Z = into own scene's
  interior" — cube about-pie's `setFromUnitVectors(+Z, clickHit.normal)`
  already pointed into the cube; the room entry disc's identity
  quaternion was inconsistent (faced *away* from the room
  interior). Switching to `[0, 1, 0, 0]` makes the
  `dest × source⁻¹ × camera` math symmetric in either direction
  without needing R180Y in the formula itself.
- **`ROOM_ENTRY_INSET` bumped from 1 to 12.** A single frame of
  forward walking after teleport could re-cross the portal plane
  and bounce the avatar back; the larger inset gives buffer.
- **Early-return after walk-cross consumes
  `pendingPortalActivation`.** Prevents a same-frame race where
  click + walk-cross both fire and apply two different teleports.

### Tier 2 — `ROOM_TRAVERSAL_CONFIGS` ✅

- New file `client/src/scenes/roomConfigs.ts` declares each
  migrated room's traversal config (entry pos, walk-cross portal
  definition, wall-clamp bounds, portal-hole config). Three
  previously-hardcoded `'room-about'` branches in
  `portalActivation.ts` and `CursorAvatar.tsx` now look up via
  `getRoomTraversalConfig(roomId)` — adding Projects + Writing
  becomes a single declaration each in this file plus a
  `<RoomScene>` component.
- `SceneHost`'s `MIGRATED_ROOMS` set is replaced by reading the
  config map.
- `AboutRoom.tsx` now reads its own config from the map (entry
  portal position/quaternion/destination/radius), so the room
  scene component and the traversal config can never drift.

### Tier 3 — subsumed by Tier 1 + 2 ✅

The agent's two Tier 3 prescriptions resolved naturally without
extra surgery:

- **`CoordinateFrame` abstraction** — the proposed interface
  (worldOrigin/localHalf/toWorld/fromWorld) is mathematically
  identity for our setup because every `THREE.Scene` is at world
  origin with no parent transform. The per-room config IS the
  coord-frame container; adding `toWorld`/`fromWorld` would just
  be `(v) => v` in every entry. Deferred until a scene needs an
  actual non-identity transform.
- **R180Y in the rendering formula** — became R180Y as the
  *quaternion convention* on portal discs (Tier 1 above).
  Equivalent math, expressed once in scene declarations rather
  than burned into the formula.

### Files added in this pass

- `client/src/scenes/roomConfigs.ts` — config map.

### Files modified

- `client/src/scenes/rooms/AboutRoom.tsx` — reads from
  `ROOM_TRAVERSAL_CONFIGS`.
- `client/src/components/scene/portalActivation.ts` — config
  lookup replaces the `MIGRATED_ROOM_LOCAL_ENTRY` map.
- `client/src/components/scene/CursorAvatar.tsx` — config
  lookup replaces both hardcoded `room-about` branches; early
  return after consuming `pendingPortalActivation`.
- `client/src/components/scene/Rooms.tsx` — `ROOM_ENTRY_INSET`
  1 → 12.
- `client/src/components/scene/PortalDisc.tsx` — props accept
  readonly tuples (matches `PortalDefinition`).

### What's left for Wave 5

Migrate Projects and Writing rooms. With `ROOM_TRAVERSAL_CONFIGS`
in place, each migration is:

1. Add an entry to `ROOM_TRAVERSAL_CONFIGS` (~15 lines).
2. Create a `<ProjectsRoom>` / `<WritingRoom>` scene component
   (mirrors `<AboutRoom>`, ~80 lines each).
3. Mount it next to `<AboutRoom>` in `App.tsx`.
4. Delete that room's entry from the legacy `<Rooms>` component.

Then the legacy `<Rooms>` component, `getRoomEntryPortalDefinition`,
and the world-space-rooms branch in `applyPortalActivation` can
all be deleted — that's the actual Wave 5 cleanup.
