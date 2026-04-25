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

/**
 * Linear five-step state machine that drives the Phase 4 reveal beat.
 *
 * - `idle`: portal pulses subtly on the back wall, nothing else has happened.
 * - `armed`: user clicked; sword is materialising / starting its swing.
 * - `swinging`: blade is mid-arc, sound is whooshing.
 * - `impact`: blade has struck; cracks begin propagating; VIBE starts to glow.
 * - `revealed`: VIBE is fully lit, low reverb hum loops, sword is buried.
 *
 * Transitions are forward-only — once revealed, we stay there.
 */
export type RevealState = 'idle' | 'armed' | 'swinging' | 'impact' | 'revealed';

const REVEAL_ORDER: readonly RevealState[] = ['idle', 'armed', 'swinging', 'impact', 'revealed'];

// ─── Store Actions ───────────────────────────────────────────────────

interface AppActions {
  /** Update the local player's position. */
  setPlayerPosition: (position: [number, number, number]) => void;
  /** Update the local player's rotation. */
  setPlayerRotation: (rotation: [number, number, number]) => void;
  /** Navigate to a specific zone (or null to free-roam). */
  setActiveZone: (zoneId: string | null) => void;
  /** Replace the entire environment config (for live editing). */
  updateEnvironment: (config: EnvironmentConfig) => void;
  /** Mark the experience as ready after loading completes. */
  setReady: (ready: boolean) => void;
  /**
   * Advance the Phase 4 reveal one step forward. No-op if we're already
   * in the terminal `revealed` state.
   */
  advanceReveal: () => void;
  /**
   * Reset the reveal back to `idle` — used by tests and (eventually) a
   * dev-only "replay" affordance.
   */
  resetReveal: () => void;
  /** Toggle the Phase 5 cursor-avatar on/off. */
  toggleCursorAvatar: () => void;
  /** Set the Phase 5 cursor-avatar state directly. */
  setCursorAvatarActive: (active: boolean) => void;
}

// ─── Initial State ───────────────────────────────────────────────────

const createInitialPlayer = (): Player => ({
  id: generateId(),
  position: [0, 0, 5],
  rotation: [0, 0, 0],
  name: 'Guest',
  cursorColor: '#00ff88',
});

interface RevealSlice {
  /** Current step of the Phase 4 reveal beat. */
  revealState: RevealState;
}

// ─── Store ───────────────────────────────────────────────────────────

/**
 * The main Zustand store. Components subscribe to slices of this state
 * using selectors to avoid unnecessary re-renders.
 *
 * @example
 * ```tsx
 * // In a component — only re-renders when position changes
 * const position = useWorldStore((s) => s.player.position);
 * ```
 */
export const useWorldStore = create<AppState & AppActions & RevealSlice>((set) => ({
  // State
  player: createInitialPlayer(),
  environment: DEFAULT_ENVIRONMENT,
  activeZoneId: null,
  isReady: false,
  revealState: 'idle',
  cursorAvatarActive: false,

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
      if (idx < 0 || idx >= REVEAL_ORDER.length - 1) return state;
      const next = REVEAL_ORDER[idx + 1];
      if (!next) return state;
      return { revealState: next };
    }),

  resetReveal: () => set({ revealState: 'idle' }),

  toggleCursorAvatar: () =>
    set((state) => ({ cursorAvatarActive: !state.cursorAvatarActive })),

  setCursorAvatarActive: (active) => set({ cursorAvatarActive: active }),
}));
