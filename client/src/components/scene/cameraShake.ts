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
 */
const SHAKE_DURATION = 0.18;
const SHAKE_MAGNITUDE = 0.45;
const SHAKE_MAX_INTENSITY = 1.5;

interface ShakeImpulse {
  time: number;
}

const impulses: ShakeImpulse[] = [];

export function triggerImpactShake(now: number): void {
  impulses.push({ time: now });
  // Drop impulses older than the shake window — keeps the array bounded.
  while (impulses.length > 0 && now - impulses[0]!.time > SHAKE_DURATION) {
    impulses.shift();
  }
}

/** Returns a 3-tuple offset for the current frame. Decays each impulse
 *  linearly over SHAKE_DURATION; sums decays across overlapping impulses
 *  (capped); applies random jitter scaled by intensity. */
export function computeShakeOffset(now: number): [number, number, number] {
  let totalIntensity = 0;
  for (const imp of impulses) {
    const elapsed = now - imp.time;
    if (elapsed < 0 || elapsed > SHAKE_DURATION) {
      continue;
    }
    totalIntensity += 1 - elapsed / SHAKE_DURATION;
  }
  totalIntensity = Math.min(SHAKE_MAX_INTENSITY, totalIntensity);
  if (totalIntensity <= 0) {
    return [0, 0, 0];
  }
  const mag = SHAKE_MAGNITUDE * totalIntensity;
  return [(Math.random() - 0.5) * mag * 2, (Math.random() - 0.5) * mag * 2, 0];
}

export function clearShake(): void {
  impulses.length = 0;
}
