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
}

// ─── Initial State ───────────────────────────────────────────────────

const createInitialPlayer = (): Player => ({
  id: generateId(),
  position: [0, 0, 5],
  rotation: [0, 0, 0],
  name: 'Guest',
  cursorColor: '#00ff88',
});

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
export const useWorldStore = create<AppState & AppActions>((set) => ({
  // State
  player: createInitialPlayer(),
  environment: DEFAULT_ENVIRONMENT,
  activeZoneId: null,
  isReady: false,

  // Actions
  setPlayerPosition: (position) =>
    set((state) => ({
      player: { ...state.player, position },
    })),

  setPlayerRotation: (rotation) =>
    set((state) => ({
      player: { ...state.player, rotation },
    })),

  setActiveZone: (zoneId) =>
    set({ activeZoneId: zoneId }),

  updateEnvironment: (config) =>
    set({ environment: config }),

  setReady: (ready) =>
    set({ isReady: ready }),
}));
