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
  /** Set which interactable the crosshair is currently aimed at, or
   *  null if nothing is in range. The InteractionController updates
   *  this each frame; individual `useInteractable` consumers read it
   *  to drive their own highlight visuals. */
  setHoveredInteractable: (id: string | null) => void;
  /** Bump the avatar punch counter to trigger one quick lerp-forward,
   *  lerp-back animation. CursorAvatar subscribes to the counter and
   *  fires the animation on every increment, so back-to-back interacts
   *  produce back-to-back punches. */
  triggerAvatarPunch: () => void;
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
}

interface InteractionSlice {
  /** Id of the interactable the crosshair is currently aimed at,
   *  or null if nothing is in range. Updated by the InteractionController
   *  each frame; consumed by individual `useInteractable` callers for
   *  their highlight visuals. */
  hoveredInteractableId: string | null;
  /** Monotonically-increasing punch counter — each increment triggers
   *  one CursorAvatar lerp-forward/lerp-back animation. */
  avatarPunchSeq: number;
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
    // Avatar lives from page load — small at first (cursor-sized), then grows
    // once the reveal completes. See CursorAvatar.tsx for the scale logic.
    cursorAvatarActive: true,
    hoveredInteractableId: null,
    avatarPunchSeq: 0,

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

    setHoveredInteractable: (id) => set({ hoveredInteractableId: id }),

    triggerAvatarPunch: () => set((state) => ({ avatarPunchSeq: state.avatarPunchSeq + 1 })),
  }),
);
