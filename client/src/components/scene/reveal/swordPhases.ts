/**
 * Sword phase math — pure functions that compute the per-frame pose
 * driver values (trajectory progress, tilt, spin, visual scale,
 * orientation phase) from the swing time `t`.
 *
 * All functions take `t` (seconds since this sword's swing started,
 * net of stagger) and return a single number or a small named object.
 * No Three.js types in or out — quaternion math stays in Sword.tsx
 * because it requires per-frame buffers that don't translate cleanly
 * to a pure function. The orientation helper here returns the
 * abstract *phase + slerp alpha*, and Sword.tsx applies that alpha
 * between its captured `spawnQuat`, `midQuat`, and `endQuat`.
 *
 * The split lets us unit-test the phase logic against bare numbers
 * without instantiating Three.js, while the imperative quaternion
 * application stays where the per-frame allocation cost is minimised.
 */
import { SWING_MID, SWING_POST, SWING_PRE } from './constants';

/** Cubic ease in/out — `t * t * (3 - 2t)` over [0, 1]. The standard
 *  smoothstep used throughout the reveal sequence. Exposed so callers
 *  that interpolate quaternions can reuse it for the slerp alpha. */
export function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

/**
 * Progress p ∈ [0, 1] along the spawn→mid→end Catmull-Rom curve at
 * swing-time `t`. Drives `trajectoryCurve.getPoint(p)` in Sword.tsx.
 *
 * Three phases:
 *   - Pre  (t < SWING_PRE)         — ease-out cubic, p maps to [0, 0.5].
 *                                    Sword decelerates into the mid pose.
 *   - Mid  (t < SWING_PRE+MID)     — linear drift, p [0.5, 0.55].
 *                                    Subtle motion through the formation.
 *   - Post (t < SWING_DURATION)    — ease-in cubic, p [0.55, 1.0].
 *                                    Sword accelerates into the wall.
 *
 * Out-of-range `t` (negative, or past SWING_DURATION) is the caller's
 * responsibility to gate — Sword.tsx covers those with separate
 * stagger / settle branches that don't call this function.
 */
export function computeTrajectoryProgress(t: number): number {
  if (t < SWING_PRE) {
    const phaseT = t / SWING_PRE;
    const eased = 1 - Math.pow(1 - phaseT, 3);
    return 0.5 * eased;
  }
  if (t < SWING_PRE + SWING_MID) {
    const phaseT = (t - SWING_PRE) / SWING_MID;
    return 0.5 + 0.05 * phaseT;
  }
  const phaseT = Math.min(1, (t - SWING_PRE - SWING_MID) / SWING_POST);
  const eased = phaseT * phaseT * phaseT;
  return 0.55 + 0.45 * eased;
}

/**
 * Italics tilt angle (radians) at swing-time `t`. The sword's broadside
 * leans `+tiltMax` at the start of mid, eases through 0, hits
 * `-tiltMax` at the start of post, then unwinds to 0 by end-of-post —
 * gives the held formation a subtle "italic → reverse-italic" sway.
 *
 * Returns 0 outside the mid + post window.
 */
export function computeTiltAngle(t: number, tiltMax: number): number {
  if (t < SWING_PRE) {
    return 0;
  }
  if (t < SWING_PRE + SWING_MID) {
    const midPhaseT = (t - SWING_PRE) / SWING_MID;
    return tiltMax * (1 - 2 * midPhaseT);
  }
  if (t < SWING_PRE + SWING_MID + SWING_POST) {
    const postPhaseT = (t - SWING_PRE - SWING_MID) / SWING_POST;
    return -tiltMax * (1 - postPhaseT);
  }
  return 0;
}

/**
 * Spin angle (radians, around the camera-up axis) at swing-time `t`.
 * Eased so each phase ends at exactly N×2π — that's identity, so the
 * sword lands cleanly without residual rotation. Spin is zero through
 * mid so the formation reads as a held pose, not a frozen tumble.
 *
 * With the current rotation counts both = 0, this always returns 0.
 * The function exists so the curve is testable + tunable independently.
 */
export function computeSpinAngle(t: number, preRotations: number, postRotations: number): number {
  if (t < SWING_PRE) {
    const phaseT = t / SWING_PRE;
    const easeOut = 1 - Math.pow(1 - phaseT, 3);
    return preRotations * 2 * Math.PI * easeOut;
  }
  if (t < SWING_PRE + SWING_MID) {
    return 0;
  }
  const phaseT = Math.min(1, (t - SWING_PRE - SWING_MID) / SWING_POST);
  const easeOut = 1 - Math.pow(1 - phaseT, 3);
  return postRotations * 2 * Math.PI * easeOut;
}

/**
 * Visual scale at swing-time `t`. Ramps from `spawnVisualScale` (the
 * tiny size at the far spawn) to 1.0 (full size at formation) over
 * the pre phase, smoothstep-eased. Holds at 1.0 through mid + post.
 *
 * With `spawnVisualScale = 1.0` (current value — apparent size growth
 * comes from real depth via perspective) this always returns 1; the
 * function exists so the curve can be tuned without code surgery.
 */
export function computeVisualScale(t: number, spawnVisualScale: number): number {
  if (t < SWING_PRE) {
    const phaseT = t / SWING_PRE;
    return spawnVisualScale + (1 - spawnVisualScale) * smoothstep(phaseT);
  }
  return 1;
}

/** Discriminated union of orientation phase names. */
export type OrientationPhaseName = 'spawn' | 'spawn-to-mid' | 'mid' | 'mid-to-end';

export interface OrientationPhase {
  phase: OrientationPhaseName;
  /** Slerp alpha (0..1) inside a transition phase. For the static
   *  phases ('spawn', 'mid') always 0 — caller should `copy(quat)`
   *  rather than slerp. */
  alpha: number;
}

/**
 * Which orientation phase is active at swing-time `t`, plus the slerp
 * alpha to use for the transition phases.
 *
 * The slerp targets are caller-owned (Sword.tsx captures `spawnQuat`,
 * `midQuat`, `endQuat` in its useMemo'd buffers) — this helper only
 * names the phase + computes the eased alpha so the phase logic itself
 * is testable against bare numbers.
 *
 * Phase boundaries:
 *   t < SWING_PRE - orientationTurnTime         → 'spawn'
 *   t < SWING_PRE                               → 'spawn-to-mid' (slerp)
 *   t < SWING_PRE + SWING_MID                   → 'mid'
 *   else                                        → 'mid-to-end' (slerp)
 */
export function computeOrientationPhase(t: number, orientationTurnTime: number): OrientationPhase {
  if (t < SWING_PRE - orientationTurnTime) {
    return { phase: 'spawn', alpha: 0 };
  }
  if (t < SWING_PRE) {
    const ot = (t - (SWING_PRE - orientationTurnTime)) / orientationTurnTime;
    return { phase: 'spawn-to-mid', alpha: smoothstep(ot) };
  }
  if (t < SWING_PRE + SWING_MID) {
    return { phase: 'mid', alpha: 0 };
  }
  const ot = Math.min(1, (t - SWING_PRE - SWING_MID) / SWING_POST);
  return { phase: 'mid-to-end', alpha: smoothstep(ot) };
}

/** Whether a sword pose is safe to write to its group. A single
 *  non-finite component (NaN / ±Infinity) in the position or scale
 *  reaches drei's `<Trail>` point buffer, which then logs
 *  `computeBoundingSphere(): Computed radius is NaN` every frame.
 *  Sword.tsx skips writing a pose that fails this check and keeps the
 *  last good one instead. */
export function isFinitePose(
  position: { x: number; y: number; z: number },
  quaternion: { x: number; y: number; z: number; w: number },
  scale: number,
): boolean {
  return (
    Number.isFinite(position.x) &&
    Number.isFinite(position.y) &&
    Number.isFinite(position.z) &&
    Number.isFinite(quaternion.x) &&
    Number.isFinite(quaternion.y) &&
    Number.isFinite(quaternion.z) &&
    Number.isFinite(quaternion.w) &&
    Number.isFinite(scale)
  );
}
