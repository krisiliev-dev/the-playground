/**
 * Core type definitions for the Portfolio World.
 *
 * These types define the shape of the 3D environment, player state,
 * and navigation system. They're designed to be multiplayer-ready:
 * player state is a standalone object that can be synced over the wire
 * without coupling to rendering logic.
 */

import type { Vector3Tuple } from 'three';

// ─── Player ──────────────────────────────────────────────────────────

/** Represents a player (visitor) in the 3D world. */
export interface Player {
  /** Unique identifier — local for now, server-assigned later for multiplayer. */
  readonly id: string;
  /** Position in world space [x, y, z]. */
  position: Vector3Tuple;
  /** Rotation as Euler angles [x, y, z] in radians. */
  rotation: Vector3Tuple;
  /** Display name (could be "Guest" or a chosen name later). */
  name: string;
  /** Color of the cursor avatar. */
  cursorColor: string;
}

// ─── World Zones ─────────────────────────────────────────────────────

/**
 * A zone is a section of the 3D world that serves a specific purpose.
 * Zones are navigable — clicking one moves the player's camera there.
 */
export interface WorldZone {
  /** Unique identifier for the zone. */
  readonly id: string;
  /** Human-readable label shown in the UI. */
  label: string;
  /** Center position of the zone in world space. */
  position: Vector3Tuple;
  /** Where the camera should look when entering this zone. */
  lookAt: Vector3Tuple;
  /** Type of content this zone holds. */
  type: ZoneType;
}

export type ZoneType = 'portfolio' | 'about' | 'social' | 'projects' | 'contact';

// ─── Environment ─────────────────────────────────────────────────────

/**
 * Describes the entire 3D environment state.
 * This is the object that gets hot-reloaded when you edit the world live.
 * Keeping it serialisable (no functions, no class instances) is critical
 * for both live-editing and future multiplayer sync.
 */
export interface EnvironmentConfig {
  /** Dimensions of the box world [width, height, depth]. */
  dimensions: Vector3Tuple;
  /** Background / ambient color of the environment. */
  ambientColor: string;
  /** Intensity of the ambient light (0-1). */
  ambientIntensity: number;
  /** Fog settings for depth. */
  fog: {
    color: string;
    near: number;
    far: number;
  };
  /** All navigable zones in the world. */
  zones: WorldZone[];
}

// ─── Navigation ──────────────────────────────────────────────────────

/**
 * Maps natural browser interactions to 3D movement.
 * This abstraction lets us swap input methods (mouse, touch, gamepad)
 * without changing the movement system.
 */
export interface NavigationInput {
  /** Vertical scroll → Y-axis movement. */
  scrollDeltaY: number;
  /** Horizontal scroll/swipe → Y-axis rotation (yaw). */
  scrollDeltaX: number;
  /** Pinch zoom → Z-axis movement (forward/backward). */
  pinchDelta: number;
  /** Click target — if a zone was clicked, navigate there. */
  targetZoneId: string | null;
}

// ─── App State ───────────────────────────────────────────────────────

/**
 * Top-level application state.
 * Zustand store will implement this interface.
 */
export interface AppState {
  /** The local player. */
  player: Player;
  /** Current environment configuration. */
  environment: EnvironmentConfig;
  /** Which zone the player is currently in (null = free roaming). */
  activeZoneId: string | null;
  /** Whether the experience has finished loading. */
  isReady: boolean;
}
