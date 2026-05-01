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

export const useWorldStore = create<AppState & AppActions & RevealSlice & InteractionSlice>(
  (set) => ({
    // State
    player: createInitialPlayer(),
    environment: DEFAULT_ENVIRONMENT,
    activeZoneId: null,
    isReady: false,
    revealState: 'idle',
    clickHit: null,
    controlsDismissed: false,
    menuOpen: false,
    documentMode: readPersistedDocumentMode(),
    // Avatar lives from page load — small at first (cursor-sized), then grows
    // once the reveal completes. See CursorAvatar.tsx for the scale logic.
    cursorAvatarActive: true,
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
        return { revealState: next };
      }),

    resetReveal: () => set({ revealState: 'idle', clickHit: null, controlsDismissed: false }),

    setClickHit: (hit) => set({ clickHit: hit }),

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

    beginInteractPress: (id, point) =>
      set({ pressedInteractableId: id, pressedTargetPoint: point }),

    endInteractPress: () => set({ pressedInteractableId: null, pressedTargetPoint: null }),
  }),
);
