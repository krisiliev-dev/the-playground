/**
 * Central application state managed by Zustand.
 *
 * Design decision: All mutable state lives here, not in component state.
 * This makes it trivial to add multiplayer later — we just need to sync
 * this store's player slice with a WebSocket connection. The rest of
 * the app reads from the same store and doesn't care where updates come from.
 *
 * @see https://zustand-demo.pmnd.rs/ for Zustand docs
 */

import { create } from 'zustand';
import type { AppState, EnvironmentConfig, Player } from '@/types';
import { generateId } from '@/utils/id';
import { DEFAULT_ENVIRONMENT } from '@/utils/defaults';
import type { PortalEndpoint } from '@/content/portals';
import type { Entity, EntityId } from '@/multiplayer/types';

// ─── Phase 4 — Sword + VIBE Reveal ───────────────────────────────────

export type RevealState = 'idle' | 'armed' | 'swinging' | 'impact' | 'revealed';

const REVEAL_ORDER: readonly RevealState[] = ['idle', 'armed', 'swinging', 'impact', 'revealed'];

/**
 * Where the user clicked, projected onto a cube wall. Stored as plain
 * tuples so the store stays JSON-serialisable for future multiplayer sync.
 */
export interface ClickHit {
  point: [number, number, number];
  /** Inward-facing wall normal at the hit (points toward camera). */
  normal: [number, number, number];
}

/**
 * Camera pose captured at click time. Frozen for the rest of the
 * reveal — the cascade's spawn/mid positions are camera-relative
 * (per the click-time POV), so the geometry must not drift if
 * the camera moves during the swing.
 *
 * Stored alongside `clickHit` so multiplayer broadcast can carry
 * both via the `presence` channel — receivers replicate the
 * cascade in their own scene using the originator's POV.
 */
export interface ClickCamPose {
  position: [number, number, number];
  /** (x, y, z, w) — Three.js convention. */
  quaternion: [number, number, number, number];
}

// ─── Store Actions ───────────────────────────────────────────────────

interface AppActions {
  setPlayerPosition: (position: [number, number, number]) => void;
  setPlayerRotation: (rotation: [number, number, number]) => void;
  setActiveZone: (zoneId: string | null) => void;
  updateEnvironment: (config: EnvironmentConfig) => void;
  setReady: (ready: boolean) => void;
  /** Move the reveal one step forward; clamps at `revealed`. */
  advanceReveal: () => void;
  /** Reset reveal back to `idle`. */
  resetReveal: () => void;
  /** Persist where the user clicked so the sword/cracks/VIBE land there. */
  setClickHit: (hit: ClickHit | null) => void;
  /** Persist the camera pose at click time. Captured by the reveal
   *  orchestrator's click handler; mirrored over multiplayer
   *  presence so remote viewers can replicate the cascade with
   *  the originator's POV. Cleared on `resetReveal`. */
  setClickCamPose: (pose: ClickCamPose | null) => void;
  /** Stamp the wall-clock moment a reveal phase began. Updated
   *  whenever the reveal state advances; broadcast via presence
   *  so remote receivers can compute "elapsed since this state
   *  began" using their own clock relative to the wire-arrival
   *  time. Stored as `performance.now() / 1000`. */
  setRevealStateEnteredAt: (epochSeconds: number) => void;
  /** Index into `FORMATION_SLOTS` for the local player's reveal.
   *  Assigned at click time based on actor-id ordering among
   *  connected peers; broadcast via presence so remote viewers
   *  agree on the slot. Drives both the formation cluster
   *  position and the room-exit-portal offset. */
  setRevealSlotIndex: (index: number | null) => void;
  /** Toggle the Phase 5 cursor-avatar visibility on/off. */
  toggleCursorAvatar: () => void;
  /** Set the Phase 5 cursor-avatar visibility directly. */
  setCursorAvatarActive: (active: boolean) => void;
  /** Mark the post-impact controls hint as dismissed. Triggers the
   *  camera transition into 3rd-person avatar mode. */
  setControlsDismissed: (dismissed: boolean) => void;
  /** True while the pause menu overlay is open. While set, the
   *  cursor avatar's OS-cursor hide is paused (so the user gets a
   *  real cursor for the menu), pointer-lock is forcibly released,
   *  and the InteractionController bails on mousedown/mouseup so
   *  clicks inside the menu can't drive 3D interactions. */
  setMenuOpen: (open: boolean) => void;
  /** Toggle the Simple Experience document layout. Persisted to
   *  localStorage so the user's choice survives reload. */
  setDocumentMode: (mode: boolean) => void;
  /** Set the one-shot pointer-lock signal — true when the user has
   *  asked to return to 3D from document mode and we should reclaim
   *  the lock on the next render. App clears it back to false
   *  after consuming. */
  setPendingPointerLock: (pending: boolean) => void;
  /** Set the one-shot navigation request — a route path that an
   *  in-world Portal wants App's NavigationConsumer to navigate to.
   *  Pass `null` to clear after consumption. */
  setPendingNavigation: (path: string | null) => void;
  /** Set which Room (id from ROOMS in scene/Rooms.tsx) the avatar
   *  is currently inside, or null when in the main cube. Drives
   *  the avatar's clamping bounds (room cube vs main cube) and
   *  URL sync (room.path vs '/'). */
  setCurrentRoom: (roomId: string | null) => void;
  /** Update the avatar's current bbox-derived route. Driven by
   *  CursorAvatar's per-frame routing loop; consumed by RouteSync
   *  to push to react-router. */
  setCurrentRoute: (path: string) => void;
  /** Request that the avatar be repositioned at the entry point of
   *  the named route. Set by RouteSync when the URL changes
   *  externally (deep link, browser back); consumed by
   *  RouteTeleportConsumer inside the Canvas, which actually moves
   *  the avatar's position ref and clears the request. */
  setPendingAvatarTeleport: (path: string | null) => void;
  /** Request a "leap to here" — CursorAvatar drives the avatar toward
   *  this world-space target at LEAP_SPEED until it arrives or
   *  crosses a portal plane (whichever happens first). Used by
   *  click-to-portal: `PortalMesh`'s click handler sets the leap
   *  target slightly past the portal's active face so the natural
   *  walk-through crossing detector picks up the cross and runs the
   *  same `teleportPose` pipeline as a manual walk-in. */
  setLeapTarget: (target: [number, number, number] | null) => void;
  /** Queue a click-to-portal request. Validation (single-sided gate,
   *  bob compensation) happens in CursorAvatar on consume. */
  setPendingPortalClick: (sourcePortalId: string | null) => void;
  /** Replace the active portal endpoint set. Called by the reveal
   *  orchestrator with `buildPortalEndpoints(clickHit)` output once
   *  the formation has landed; called with `[]` on `resetReveal`.
   *
   *  Prefer `addPortalEndpoints` for multiplayer-aware callers —
   *  it keeps other actors' portal sets intact instead of stomping
   *  the whole array. */
  setPortalEndpoints: (endpoints: ReadonlyArray<PortalEndpoint>) => void;
  /** Add (or replace) a single actor's portal set. The set is
   *  identified by the `<actorId>::` id prefix that
   *  `buildPortalEndpoints` writes when called with an actorId.
   *  Calling this for actor X replaces only X's portals — every
   *  other actor's set is preserved. So when player A reveals and
   *  later player B reveals, both portal clusters coexist in the
   *  scene. */
  addPortalEndpoints: (actorId: string, endpoints: ReadonlyArray<PortalEndpoint>) => void;
  /** Remove all portals tagged with `<actorId>::`. Called when a
   *  remote player disconnects (so their portals don't linger
   *  forever) and when the local player resets their reveal. */
  removePortalEndpointsByActor: (actorId: string) => void;
  /** Record which room the avatar most recently *exited*. Updated
   *  by CursorAvatar when it teleports the avatar back to the
   *  cube; consumed by the menu's Back button to "pull" the
   *  avatar back into that same room — Back is just another
   *  portal activation under the hood. */
  setLastExitedRoom: (roomId: string | null) => void;
  /** Toggle the explicit user mute. Combined with documentMode by
   *  App's audio-mute effect to set the live master volume. */
  setMuted: (muted: boolean) => void;
  /** Set which interactable the crosshair is currently aimed at, or
   *  null if nothing is in range. The InteractionController updates
   *  this each frame; individual `useInteractable` consumers read it
   *  to drive their own highlight visuals. The `point` is the
   *  raycast hit position in world space — captured here (not in a
   *  controller-private ref) so click handlers + tests can read the
   *  same value the raycaster wrote. Pass `null` for both when
   *  nothing is hovered. */
  setHoveredInteractable: (id: string | null, point?: [number, number, number] | null) => void;
  /** Mark mouse-down over an interactable. CursorAvatar reads this to
   *  lean the cursor forward to *touch* the target while held. The
   *  point is the world-space hit position from the crosshair raycast,
   *  so the cursor lerps right up to the surface the user clicked.
   *  Future draggables can also subscribe to drive per-frame motion. */
  beginInteractPress: (id: string, point: [number, number, number]) => void;
  /** Release the press. CursorAvatar lerps back to the follow rig.
   *  Called on every mouse-up regardless of where the cursor ended up. */
  endInteractPress: () => void;
}

const createInitialPlayer = (): Player => ({
  id: generateId(),
  position: [0, 0, 5],
  rotation: [0, 0, 0],
  name: 'Guest',
  cursorColor: '#00ff88',
});

interface RevealSlice {
  revealState: RevealState;
  /** Where the click landed, or null if no click yet. */
  clickHit: ClickHit | null;
  /** Camera pose captured at click time, frozen through the
   *  cascade. Null until the user clicks. */
  clickCamPose: ClickCamPose | null;
  /** `performance.now() / 1000` at the moment `revealState`
   *  last advanced. Drives presence-broadcast timestamping so
   *  late-joining remote viewers can compute "where is this
   *  reveal in its phase" rather than seeing it restart. 0 when
   *  no reveal is in progress (or has completed). */
  revealStateEnteredAt: number;
  /** Slot index assigned to the local player's reveal. Null
   *  before any reveal has been triggered. Set by
   *  `RevealOrchestrator` at click time and cleared on
   *  `resetReveal`. */
  revealSlotIndex: number | null;
  /** Whether the user has dismissed the post-impact controls hint.
   *  CursorAvatar gates its 3rd-person camera transition on this. */
  controlsDismissed: boolean;
  /** True while the pause menu overlay is open. Read by
   *  CursorAvatar (to restore the OS cursor + skip mouselook) and
   *  by InteractionController (to bail on mousedown/mouseup). */
  menuOpen: boolean;
  /** Simple Experience mode — when true, the site renders as a
   *  document (clean header + nav + scrollable content) instead of
   *  the 3D Canvas-and-overlays layout. Persisted to localStorage. */
  documentMode: boolean;
  /** One-shot signal set by DocumentShell when the user clicks
   *  "Switch to 3D experience" *while in avatar mode*. App reads
   *  + clears it on the doc → 3D render and reclaims pointer-lock,
   *  so the user resumes mouselook without a second confirming
   *  click. */
  pendingPointerLock: boolean;
  /** One-shot signal set by an in-world Portal (or other Canvas
   *  child) when the user activates a section portal. App's
   *  NavigationConsumer (which lives inside BrowserRouter, where
   *  react-router hooks are usable) reads + clears it and calls
   *  `navigate()`. The store mediates because react-router's
   *  context doesn't reliably bridge across R3F's reconciler. */
  pendingNavigation: string | null;
  /** Which Room (id from ROOMS in scene/Rooms.tsx) the avatar is
   *  currently inside, or null when in the main cube. Updated by
   *  CursorAvatar after a teleport; consumed by the avatar's
   *  clamping logic and the URL-sync effect in NavigationConsumer. */
  currentRoom: string | null;
  /** The avatar's current bbox-derived route — the deepest
   *  registered `Route` (see `content/routes.ts`) whose bbox
   *  contains the avatar's cube-local position. Updated each frame
   *  by CursorAvatar's routing loop; the source of truth for the
   *  URL (RouteSync mirrors it into react-router) and for which
   *  document slice the Simple Experience renders. */
  currentRoute: string;
  /** One-shot teleport request, set by RouteSync when the URL
   *  changes externally and the avatar needs to be moved into the
   *  matching route's bbox. Cleared by RouteTeleportConsumer once
   *  the avatar position ref has been updated. */
  pendingAvatarTeleport: string | null;
  /** Active leap target in cube-local world coords, or null when no
   *  leap is in progress. Set by CursorAvatar after `planPortalLeap`
   *  validates a click against the avatar's current side of the
   *  portal. CursorAvatar's per-frame loop overrides walk input and
   *  moves toward this target at LEAP_SPEED. Cleared on arrival or
   *  when the walk-through crossing detector fires (whichever
   *  happens first). */
  leapTarget: [number, number, number] | null;
  /** One-shot click-to-portal request. The string is a
   *  `PortalEndpoint.id` (the portal the user clicked). CursorAvatar
   *  consumes this each frame: bob-shifts the source endpoint, runs
   *  `planPortalLeap` with the avatar's live position to pick a
   *  target (or reject the click as invalid — e.g. clicked on the
   *  back of a single-sided portal), and clears the field. */
  pendingPortalClick: string | null;
  /** Active portal endpoints. Empty until the reveal sequence
   *  finishes — the formation portals are positioned relative to
   *  the click point on the wall, so they can't exist before the
   *  user has picked a wall. The portal cascade renderer + the
   *  walk-through crossing detector both read from this; the
   *  reveal orchestrator populates it via `buildPortalEndpoints`
   *  once `revealState === 'revealed'`. Cleared on `resetReveal`. */
  portalEndpoints: ReadonlyArray<PortalEndpoint>;
  /** Last room the avatar exited back to the cube. Persists past
   *  exit so the pause-menu Back button can re-enter it. Cleared
   *  when the user enters a new room (so Back from the cube always
   *  goes to the most recently exited one, not "two rooms ago"). */
  lastExitedRoom: string | null;
  /** Explicit user mute toggled from PauseMenu's audio control. The
   *  effective master volume is `documentMode || muted ? 0 : 1`,
   *  so document mode silences audio independently of the user's
   *  preference (the AudioContext is independent of the render
   *  loop, so wallAmbient and friends would keep playing into the
   *  document otherwise) and restores it on the way back. */
  muted: boolean;
}

/**
 * Read the persisted documentMode preference.
 *
 * SSR / prerender path: returns `true`. The build-time prerender
 * step renders the flat document variant so crawlers, link-preview
 * bots, and screen readers see real content; the runtime swap to
 * the 3D experience happens client-side after hydration. Initial-
 * izing the store to `true` for SSR ensures components like
 * `RoomPage` and `Home` that branch on this flag emit their
 * document-mode JSX during `renderToString` — without this default,
 * SSR would emit the 3D-mode variants, and the prerendered HTML
 * would be useless to crawlers.
 *
 * Browser runtime path: reads `localStorage`, defaulting to `false`
 * so JS users get the 3D experience unless they explicitly opted
 * into Simple Experience.
 */
const DOCUMENT_MODE_STORAGE_KEY = 'documentMode';
function readPersistedDocumentMode(): boolean {
  if (typeof window === 'undefined') {
    return true;
  }
  try {
    return window.localStorage.getItem(DOCUMENT_MODE_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}
function persistDocumentMode(mode: boolean): void {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(DOCUMENT_MODE_STORAGE_KEY, String(mode));
  } catch {
    /* localStorage may be blocked in private windows / specific
       embed contexts. Mode then becomes session-only, which is an
       acceptable degradation. */
  }
}

/**
 * Server-authoritative entity mirror — clients see the world via
 * this slice (per ADR-004). Populated by `useMultiplayerSync`:
 * `FullState` on connect seeds the map, subsequent
 * `EntityUpdates` upsert by id, `EntityDeleted` removes.
 *
 * `localPlayerId` flags which entity in the map is the client's
 * own player so rendering code can skip drawing a remote avatar
 * over the local one.
 */
interface MultiplayerSlice {
  entities: ReadonlyMap<EntityId, Entity>;
  localPlayerId: EntityId | null;
  /** Insert or replace many entities at once. Used for the
   *  initial `FullState` and per-tick `EntityUpdates`. */
  upsertEntities: (entities: ReadonlyArray<Entity>) => void;
  removeEntities: (ids: ReadonlyArray<EntityId>) => void;
  setLocalPlayerId: (id: EntityId | null) => void;
  /** Called on socket close so a stale remote-avatar map doesn't
   *  linger across reconnects. */
  clearAllEntities: () => void;
}

interface InteractionSlice {
  /** Id of the interactable the crosshair is currently aimed at,
   *  or null if nothing is in range. Updated by the InteractionController
   *  each frame; consumed by individual `useInteractable` callers for
   *  their highlight visuals. */
  hoveredInteractableId: string | null;
  /** World-space hit point on the hovered interactable's surface,
   *  paired with `hoveredInteractableId`. The InteractionController
   *  writes this each frame alongside the id; click handlers read
   *  it on mousedown to seed the press's target point. Lives in the
   *  store (not a controller-private ref) so the click → press
   *  pipeline is observable from outside, and tests can inject a
   *  hit directly. Null whenever `hoveredInteractableId` is null. */
  hoveredInteractablePoint: [number, number, number] | null;
  /** Id of the interactable currently being pressed (mouse-down landed
   *  on it, mouse-up hasn't fired yet). Decoupled from `hovered…` so
   *  callers can detect "press started here, cursor since wandered" —
   *  useful for drag interactions where the press anchors a binding. */
  pressedInteractableId: string | null;
  /** World-space point the cursor is leaning toward (the raycast hit
   *  on the interactable at the moment of mouse-down). Null when no
   *  press is active. */
  pressedTargetPoint: [number, number, number] | null;
}

export const useWorldStore = create<
  AppState & AppActions & RevealSlice & MultiplayerSlice & InteractionSlice
>((set) => ({
  // State
  player: createInitialPlayer(),
  environment: DEFAULT_ENVIRONMENT,
  activeZoneId: null,
  isReady: false,
  revealState: 'idle',
  clickHit: null,
  clickCamPose: null,
  revealStateEnteredAt: 0,
  revealSlotIndex: null,
  controlsDismissed: false,
  menuOpen: false,
  documentMode: readPersistedDocumentMode(),
  pendingPointerLock: false,
  pendingNavigation: null,
  currentRoom: null,
  currentRoute: '/',
  pendingAvatarTeleport: null,
  leapTarget: null,
  pendingPortalClick: null,
  portalEndpoints: [],
  lastExitedRoom: null,
  muted: false,
  // Avatar lives from page load — small at first (cursor-sized), then grows
  // once the reveal completes. See CursorAvatar.tsx for the scale logic.
  cursorAvatarActive: true,
  entities: new Map(),
  localPlayerId: null,
  hoveredInteractableId: null,
  hoveredInteractablePoint: null,
  pressedInteractableId: null,
  pressedTargetPoint: null,

  // Actions
  setPlayerPosition: (position) =>
    set((state) => ({
      player: { ...state.player, position },
    })),

  setPlayerRotation: (rotation) =>
    set((state) => ({
      player: { ...state.player, rotation },
    })),

  setActiveZone: (zoneId) => set({ activeZoneId: zoneId }),

  updateEnvironment: (config) => set({ environment: config }),

  setReady: (ready) => set({ isReady: ready }),

  advanceReveal: () =>
    set((state) => {
      const idx = REVEAL_ORDER.indexOf(state.revealState);
      if (idx < 0 || idx >= REVEAL_ORDER.length - 1) {
        return state;
      }
      const next = REVEAL_ORDER[idx + 1];
      if (!next) {
        return state;
      }
      return {
        revealState: next,
        revealStateEnteredAt: performance.now() / 1000,
      };
    }),

  resetReveal: () =>
    set((state) => {
      // Multiplayer-aware reset: clear only the local actor's
      // portal set, preserving any portals belonging to remote
      // players. The local actor's id is `localPlayerId ?? 'local'`
      // (the `'local'` fallback covers single-player mode where
      // no multiplayer id has been assigned yet).
      const localActorId = state.localPlayerId ?? 'local';
      const prefix = `${localActorId}::`;
      return {
        revealState: 'idle',
        clickHit: null,
        clickCamPose: null,
        revealStateEnteredAt: 0,
        revealSlotIndex: null,
        controlsDismissed: false,
        portalEndpoints: state.portalEndpoints.filter((p) => !p.id.startsWith(prefix)),
      };
    }),

  setPendingPointerLock: (pending) => set({ pendingPointerLock: pending }),

  setPendingNavigation: (path) => set({ pendingNavigation: path }),

  setCurrentRoom: (roomId) => set({ currentRoom: roomId }),

  setCurrentRoute: (path) => set({ currentRoute: path }),

  setPendingAvatarTeleport: (path) => set({ pendingAvatarTeleport: path }),
  setLeapTarget: (target) => set({ leapTarget: target }),
  setPendingPortalClick: (sourcePortalId) => set({ pendingPortalClick: sourcePortalId }),
  setPortalEndpoints: (endpoints) => set({ portalEndpoints: endpoints }),

  addPortalEndpoints: (actorId, endpoints) =>
    set((state) => {
      const prefix = `${actorId}::`;
      const others = state.portalEndpoints.filter((p) => !p.id.startsWith(prefix));
      return { portalEndpoints: [...others, ...endpoints] };
    }),

  removePortalEndpointsByActor: (actorId) =>
    set((state) => {
      const prefix = `${actorId}::`;
      return {
        portalEndpoints: state.portalEndpoints.filter((p) => !p.id.startsWith(prefix)),
      };
    }),

  setLastExitedRoom: (roomId) => set({ lastExitedRoom: roomId }),

  setMuted: (muted) => set({ muted }),

  setClickHit: (hit) => set({ clickHit: hit }),

  setClickCamPose: (pose) => set({ clickCamPose: pose }),

  setRevealStateEnteredAt: (epochSeconds) => set({ revealStateEnteredAt: epochSeconds }),

  setRevealSlotIndex: (index) => set({ revealSlotIndex: index }),

  toggleCursorAvatar: () => set((state) => ({ cursorAvatarActive: !state.cursorAvatarActive })),

  setCursorAvatarActive: (active) => set({ cursorAvatarActive: active }),

  setControlsDismissed: (dismissed) => set({ controlsDismissed: dismissed }),

  setMenuOpen: (open) => set({ menuOpen: open }),

  setDocumentMode: (mode) => {
    persistDocumentMode(mode);
    set({ documentMode: mode });
  },

  setHoveredInteractable: (id, point = null) =>
    // Always pair id + point: when id is null, point should also be
    // null (no hover, no surface). When id is non-null, callers
    // SHOULD pass a point — but if they don't (legacy call sites),
    // we clear the point so it can't go stale relative to the id.
    set({ hoveredInteractableId: id, hoveredInteractablePoint: id ? point : null }),

  beginInteractPress: (id, point) => set({ pressedInteractableId: id, pressedTargetPoint: point }),

  endInteractPress: () => set({ pressedInteractableId: null, pressedTargetPoint: null }),

  // Multiplayer slice. The Map is rebuilt for each mutation so
  // Zustand's `Object.is` shallow-equality fires for subscribers
  // — mutating a held Map in place would silently skip renders.
  upsertEntities: (entities) =>
    set((state) => {
      const next = new Map(state.entities);
      for (const entity of entities) {
        next.set(entity.id, entity);
      }
      return { entities: next };
    }),

  removeEntities: (ids) =>
    set((state) => {
      const next = new Map(state.entities);
      for (const id of ids) {
        next.delete(id);
      }
      return { entities: next };
    }),

  setLocalPlayerId: (id) => set({ localPlayerId: id }),

  clearAllEntities: () => set({ entities: new Map(), localPlayerId: null }),
}));
