/**
 * Pure animation math for the remote-cascade visual.
 *
 * The receiver (`RemoteSwordCascade.tsx`) wires inbound
 * `sword_swing` events to streaks and `sword_impact` events to
 * sparks; this module owns the per-frame numbers (position
 * along the streak, opacity ramp, spark fade) so the rendering
 * component stays a thin shell over standard R3F idioms.
 *
 * Why a separate file: the receiver mounts inside the canvas
 * and is awkward to test in isolation. The math is pure and
 * worth its own focused tests.
 */

/** How long a remote streak takes to traverse from→to, in
 *  seconds. Intentionally shorter than the local cascade's
 *  5.5s SWING_DURATION (which is dominated by a formation
 *  hold) — for a third-person observer the streak should
 *  read as a fast, decisive flight rather than a multi-stage
 *  performance. Hand-tuned: long enough to be readable, short
 *  enough that 12 streaks don't pile up on screen. */
export const REMOTE_STREAK_DURATION_S = 1.4;

/** Extra time the streak's trailing fade lingers after the
 *  blade arrives. Lets the trail dissipate naturally rather
 *  than snapping invisible at impact. */
export const REMOTE_STREAK_FADE_TAIL_S = 0.3;

/** Total streak lifetime (flight + fade tail). After this much
 *  elapsed time the streak should be removed from the active
 *  list. */
export const REMOTE_STREAK_TOTAL_S = REMOTE_STREAK_DURATION_S + REMOTE_STREAK_FADE_TAIL_S;

/** Spark lifetime for `sword_impact` — short pop matching the
 *  local impact-flash duration. */
export const REMOTE_SPARK_DURATION_S = 0.22;

export interface StreakFrame {
  /** Linear interpolation factor along from→to, in [0, 1]. */
  progress: number;
  /** Opacity in [0, 1]. */
  opacity: number;
}

/**
 * Per-frame numbers for a remote streak.
 *
 * Progress is `clamp(elapsed / duration, 0, 1)` — the streak
 * holds at the impact endpoint while the trail fades.
 *
 * Opacity has three segments:
 *   0..riseEnd   — fade in (0 → 1)
 *   riseEnd..1.0 of flight — held at 1
 *   1.0..total   — fade out (1 → 0) during the tail
 *
 * Past `total`, opacity is 0 and the streak is finished.
 */
export function computeStreakFrame(
  elapsed: number,
  flightDuration: number = REMOTE_STREAK_DURATION_S,
  fadeTail: number = REMOTE_STREAK_FADE_TAIL_S,
): StreakFrame {
  const total = flightDuration + fadeTail;
  if (elapsed <= 0) {
    return { progress: 0, opacity: 0 };
  }
  if (elapsed >= total) {
    return { progress: 1, opacity: 0 };
  }
  const progress = Math.min(1, elapsed / flightDuration);

  // Rise over the first 12% of flight — quick fade-in so the
  // streak is visible nearly immediately but doesn't pop in.
  const RISE_FRACTION = 0.12;
  const riseEnd = flightDuration * RISE_FRACTION;

  let opacity: number;
  if (elapsed < riseEnd) {
    opacity = elapsed / riseEnd;
  } else if (elapsed < flightDuration) {
    opacity = 1;
  } else {
    // Tail phase: fade 1 → 0 linearly over fadeTail.
    opacity = Math.max(0, 1 - (elapsed - flightDuration) / fadeTail);
  }
  return { progress, opacity };
}

export interface SparkFrame {
  /** Uniform world-space scale for the sprite. */
  scale: number;
  /** Opacity in [0, 1]. */
  opacity: number;
}

/**
 * Per-frame numbers for the impact spark sprite. Scale ramps
 * up linearly while opacity hard-pops to 1 then fades to 0 —
 * mirrors the local `computeImpactFlashFrame` so remote sparks
 * read like the same effect.
 */
export function computeSparkFrame(
  elapsed: number,
  duration: number = REMOTE_SPARK_DURATION_S,
  initialScale = 1,
  maxScale = 8,
): SparkFrame {
  if (elapsed < 0 || elapsed >= duration) {
    return { scale: maxScale, opacity: 0 };
  }
  const p = elapsed / duration;
  const scale = initialScale + p * (maxScale - initialScale);
  const opacity = 1 - p;
  return { scale, opacity };
}
