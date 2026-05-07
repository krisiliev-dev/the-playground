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

const SHAKE_DURATION = 0.18;
const SHAKE_MAGNITUDE = 0.45;
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
const DEFAULT_WORLD_DURATION_MS = SHAKE_DURATION * 1000;

interface ShakeImpulse {
  time: number;
  /** 0..1+. 1.0 is a full-strength impulse. Receivers of *remote*
   *  shake events scale this by distance attenuation so a far-away
   *  impact produces a milder shake. */
  weight: number;
}

const impulses: ShakeImpulse[] = [];

export function triggerImpactShake(now: number, weight = 1.0): void {
  if (weight <= 0) {
    return;
  }
  impulses.push({ time: now, weight });
  // Drop impulses older than the shake window — keeps the array bounded.
  while (impulses.length > 0 && now - impulses[0]!.time > SHAKE_DURATION) {
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
  // 1. Local — full-strength impulse for the originator.
  triggerImpactShake(now, 1.0);
  // 2. Network — broadcast for everyone else.
  emitSceneEvent({
    kind: 'camera_shake',
    position,
    radius: opts.radius ?? DEFAULT_WORLD_RADIUS,
    intensity: opts.intensity ?? DEFAULT_WORLD_INTENSITY,
    duration_ms: opts.durationMs ?? DEFAULT_WORLD_DURATION_MS,
  });
}

/** Returns a 3-tuple offset for the current frame. Decays each impulse
 *  linearly over SHAKE_DURATION; sums decays across overlapping impulses
 *  (capped); applies random jitter scaled by intensity. Z is fixed at
 *  0 — shake is screen-plane only so it doesn't push the camera into or
 *  out of the scene (which would feel like a depth glitch, not a hit). */
export function computeShakeOffset(now: number): [number, number, number] {
  let totalIntensity = 0;
  for (const imp of impulses) {
    const elapsed = now - imp.time;
    if (elapsed < 0 || elapsed > SHAKE_DURATION) {
      continue;
    }
    totalIntensity += (1 - elapsed / SHAKE_DURATION) * imp.weight;
  }
  totalIntensity = Math.min(SHAKE_MAX_INTENSITY, totalIntensity);
  if (totalIntensity <= 0) {
    return [0, 0, 0];
  }
  const mag = SHAKE_MAGNITUDE * totalIntensity;
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
