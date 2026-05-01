/**
 * Sword visual + audio effect math — pure helpers for the spawn
 * flash, impact flash, and slam audio modulation.
 *
 * Each function takes only numbers (and, where needed, a `rand`
 * callable so jittered values can be deterministic in tests). The
 * imperative work — writing `sprite.scale.setScalar`, calling
 * `sfx.play(...)` — stays in `Sword.tsx`; these helpers only own
 * the math.
 */

export interface FlashFrame {
  /** World-units uniform scale for the sprite this frame. */
  scale: number;
  /** Opacity in [0, 1]. */
  opacity: number;
}

/**
 * Spawn-flash animation frame. The flash scales linearly from
 * `initialScale` → `maxScale` over the full duration; opacity has
 * two segments — rises linearly from 0 to 1 over the first
 * `riseFraction` of the duration, then linearly decays to 0 over
 * the remainder. Past the duration, opacity is clamped to 0.
 *
 * Scale value past the end is undefined-but-bounded — the consumer
 * should gate on opacity == 0 (sprite invisible) before deciding
 * whether to write the scale at all. We always return *some* scale
 * so callers don't have to special-case "elapsed > duration".
 */
export function computeSpawnFlashFrame(
  elapsed: number,
  duration: number,
  initialScale: number,
  maxScale: number,
  riseFraction: number,
): FlashFrame {
  if (elapsed < 0 || elapsed >= duration) {
    return { scale: maxScale, opacity: 0 };
  }
  const p = elapsed / duration;
  const scale = initialScale + p * (maxScale - initialScale);
  let opacity: number;
  if (p < riseFraction) {
    opacity = p / riseFraction;
  } else {
    opacity = Math.max(0, 1 - (p - riseFraction) / (1 - riseFraction));
  }
  return { scale, opacity };
}

/**
 * Impact-flash animation frame. Simpler than the spawn flash:
 * scale ramps `initialScale` → `maxScale` linearly; opacity is a
 * hard-pop then linear fade from 1 to 0 over the duration. Past the
 * duration, opacity is 0.
 */
export function computeImpactFlashFrame(
  elapsed: number,
  duration: number,
  initialScale: number,
  maxScale: number,
): FlashFrame {
  if (elapsed < 0 || elapsed >= duration) {
    return { scale: maxScale, opacity: 0 };
  }
  const p = elapsed / duration;
  const scale = initialScale + p * (maxScale - initialScale);
  const opacity = 1 - p;
  return { scale, opacity };
}

/**
 * Velocity → volume multiplier for the slam cue. Clamps to a soft
 * ceiling so a freakishly fast impact can't overdrive the bus, and
 * to a floor so even a slow approach still produces audible slam.
 *
 * Returns: `clamp(0.7 + v / 80, 0.7, 1.6)`. The constants are tuned
 * by ear — 0.7 = barely audible at v=0; 1.6 = solidly punchy at
 * v >= 72. Below 0 (couldn't really happen) the result is 0.7.
 */
export function computeSlamVelocityFactor(velocity: number): number {
  if (!Number.isFinite(velocity) || velocity <= 0) {
    return 0.7;
  }
  return Math.min(1.6, 0.7 + velocity / 80);
}

/**
 * Velocity → pitch jitter envelope for the slam cue. The base
 * 0.6 jitter is wide enough to give 12 cascading slams clearly
 * different fundamental frequencies; the velocity-derived bonus
 * (capped at +0.15 around v >= 60) widens slightly for harder hits
 * so they don't all sit at the same pitch ceiling.
 */
export function computeSlamPitchJitter(velocity: number): number {
  if (!Number.isFinite(velocity) || velocity <= 0) {
    return 0.6;
  }
  return 0.6 + Math.min(0.15, velocity / 400);
}

/**
 * Symmetric per-axis jitter offset around 0. Returns a value in
 * `[-range/2, +range/2]`. `rand()` should yield in [0, 1) (mulberry32
 * or `Math.random`).
 *
 * Used to spread the slam emitter position around the wall hit point
 * by ±SLAM_POS_JITTER on each axis — the panner picks up slightly
 * different stereo positions for each cascade slam, helping the ear
 * separate them instead of merging into a single block.
 */
export function jitterAxis(rand: () => number, range: number): number {
  return (rand() - 0.5) * range;
}
