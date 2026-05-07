/**
 * Camera shake — a tiny additive impulse system.
 *
 * Anything in the scene can call `triggerImpactShake(now)` to add a
 * decaying shake impulse. The `<ShakeGroup>` component reads the state
 * each frame and applies a position offset to whatever it wraps —
 * shaking the world is visually equivalent to shaking the camera.
 *
 * Multiple impacts within SHAKE_DURATION accumulate; intensity caps at
 * SHAKE_MAX_INTENSITY so a barrage of impacts doesn't blow out the
 * frame. The actual offset each frame is high-frequency random jitter
 * scaled by the current intensity.
 *
 * For multiplayer (per ADR-006): use `triggerWorldImpactShake` to
 * shake locally AND broadcast a `camera_shake` SceneEvent so other
 * players within range feel the impact too. Receivers attenuate the
 * weight by their distance from the impact and call
 * `triggerImpactShake(now, weight)` directly.
 */
import { emitSceneEvent } from '@/multiplayer/sceneEvents';

/** Default impulse duration (seconds) when callers don't supply
 *  one. Local sword slams use this; admin-triggered shakes can
 *  override via `triggerImpactShake(now, weight, durationSec)`. */
const SHAKE_DURATION_DEFAULT = 0.18;
const SHAKE_MAGNITUDE = 0.45;
/** Cap on TOTAL intensity from stacking impulses — protects
 *  against many-player slam clusters from blowing out the frame.
 *  A *single* impulse with weight beyond this still produces its
 *  full magnitude (see computeShakeOffset). */
const SHAKE_MAX_INTENSITY = 1.5;

/** Default radius and intensity for world-impact shakes. Sized to
 *  cover the typical avatar-to-impact distance with the camera at
 *  its default ~z=-360 spawn — sword slams against the main cube's
 *  far wall need to reach a player whose camera is hundreds of units
 *  back. Linear falloff means closer players still feel a stronger
 *  shake; this just extends the *audible* radius.
 *
 *  Per-effect callers can override via opts.radius for tighter
 *  effects (e.g. a footstep would use ~30, a thunderclap ~1000). */
const DEFAULT_WORLD_RADIUS = 500;
const DEFAULT_WORLD_INTENSITY = 1.0;
const DEFAULT_WORLD_DURATION_MS = SHAKE_DURATION_DEFAULT * 1000;

interface ShakeImpulse {
  time: number;
  /** 0..∞. 1.0 is the "standard" impulse strength. Receivers of
   *  remote shake events scale this by distance attenuation so a
   *  far-away impact produces a milder shake. Admin-triggered
   *  events may use weight > 1 to drive a deliberately large
   *  shake; the per-impulse magnitude path in computeShakeOffset
   *  honours that even when the stacking cap kicks in. */
  weight: number;
  /** Decay window in seconds. Defaults to SHAKE_DURATION_DEFAULT
   *  for local triggers; admin events override via the
   *  `duration_ms` field on the wire. */
  duration: number;
}

const impulses: ShakeImpulse[] = [];

export function triggerImpactShake(
  now: number,
  weight = 1.0,
  durationSec = SHAKE_DURATION_DEFAULT,
): void {
  if (weight <= 0 || durationSec <= 0) {
    return;
  }
  impulses.push({ time: now, weight, duration: durationSec });
  // Drop impulses older than their own decay window — bounded
  // memory regardless of mixed durations across active impulses.
  while (impulses.length > 0 && now - impulses[0]!.time > impulses[0]!.duration) {
    impulses.shift();
  }
}

/**
 * Shared world-impact shake (per ADR-006). Shakes the local camera
 * at full strength AND broadcasts a `camera_shake` event so other
 * players within radius feel a proportionally-attenuated shake.
 *
 * The local shake matches `triggerImpactShake(now)` exactly — the
 * caller (the local player) is at the impact, so they get the full
 * effect. Remote receivers compute their distance to `position` and
 * scale shake weight linearly from 1.0 (at distance 0) to 0.0 (at
 * `radius`).
 */
export function triggerWorldImpactShake(
  now: number,
  position: [number, number, number],
  opts: {
    radius?: number;
    intensity?: number;
    durationMs?: number;
  } = {},
): void {
  const durationMs = opts.durationMs ?? DEFAULT_WORLD_DURATION_MS;
  const intensity = opts.intensity ?? DEFAULT_WORLD_INTENSITY;
  // 1. Local — full-strength impulse for the originator. Pass the
  //    event's intensity + duration so the local impulse matches
  //    what receivers will produce from the broadcast.
  triggerImpactShake(now, intensity, durationMs / 1000);
  // 2. Network — broadcast for everyone else.
  emitSceneEvent({
    kind: 'camera_shake',
    position,
    radius: opts.radius ?? DEFAULT_WORLD_RADIUS,
    intensity,
    duration_ms: durationMs,
  });
}

/** Returns a 3-tuple offset for the current frame. Decays each
 *  impulse linearly over its own per-impulse duration; computes
 *  effective intensity as max(stacked-and-capped, single-largest)
 *  so an admin-triggered weight-5 impulse produces its full
 *  magnitude even though the stacking cap is 1.5. Random jitter
 *  scaled by effective intensity. Z is fixed at 0 — shake is
 *  screen-plane only so it doesn't push the camera into or out
 *  of the scene (which would feel like a depth glitch, not a
 *  hit). */
export function computeShakeOffset(now: number): [number, number, number] {
  let stacked = 0;
  let largest = 0;
  for (const imp of impulses) {
    const elapsed = now - imp.time;
    if (elapsed < 0 || elapsed > imp.duration) {
      continue;
    }
    const decayed = (1 - elapsed / imp.duration) * imp.weight;
    stacked += decayed;
    if (decayed > largest) {
      largest = decayed;
    }
  }
  // Stacking cap protects against many-player slam clusters
  // saturating; the single-largest path lets a deliberately big
  // impulse (admin trigger with intensity > 1) drive full
  // magnitude.
  const effective = Math.max(Math.min(SHAKE_MAX_INTENSITY, stacked), largest);
  if (effective <= 0) {
    return [0, 0, 0];
  }
  const mag = SHAKE_MAGNITUDE * effective;
  return [(Math.random() * 2 - 1) * mag, (Math.random() * 2 - 1) * mag, 0];
}

/**
 * Compute a distance-attenuated shake weight given the local viewer's
 * world position, the impact position, and a falloff radius.
 *
 * Linear falloff from 1.0 at distance 0 to 0.0 at `radius`. Outside
 * the radius, returns 0 (no shake). Pure — exported for tests.
 */
export function attenuateByDistance(
  viewerPos: readonly [number, number, number],
  impactPos: readonly [number, number, number],
  radius: number,
): number {
  if (radius <= 0) {
    return 0;
  }
  const dx = viewerPos[0] - impactPos[0];
  const dy = viewerPos[1] - impactPos[1];
  const dz = viewerPos[2] - impactPos[2];
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (dist >= radius) {
    return 0;
  }
  return 1 - dist / radius;
}

/** Test-only — wipes the impulse queue so per-test isolation works.
 *  Production code should never call this; if you want to suppress
 *  shake for a moment, just stop calling `triggerImpactShake`. */
export function clearShake(): void {
  impulses.length = 0;
}
