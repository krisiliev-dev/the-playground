/**
 * Reveal-sequence spawn geometry — the wall-cast + spawn-point math
 * shared between `Sword.tsx` (per-sword spawn position) and
 * `BulletTimeDirector.tsx` (camera lookAt during the chase phase).
 *
 * Both files previously inlined the same slab-method ray-cast +
 * lateral offset + per-axis clamp; this module is the single source.
 *
 * Pure: every function takes an `out: Vector3` and writes into it
 * rather than allocating. The Sword's useFrame runs at 60 fps and the
 * scene already has 12 sword instances, so per-frame allocation in
 * spawn-point computation would amount to ~720 Vector3s/sec of
 * garbage. Pass-in-out keeps the hot path zero-alloc.
 */
import { Vector3 } from 'three';
import { firstWallT } from '@/utils';

/** Forward distance from the click camera to the spawn point. Same as
 *  the camera-relative depth at which the swords first appear in
 *  frame, deep behind the formation pose. */
export const SPAWN_FIXED_FWD = 80;

/** Vertical offset above the click camera at the spawn point. Small
 *  positive value so the trajectory has a slight downward bow into
 *  the formation, never the camera's own eye level. */
export const SPAWN_FIXED_UP = 20;

/** Inset from the cube wall — spawn lands this many units inside the
 *  side wall surface so the sword isn't embedded in the wall when it
 *  appears. Also drives the per-axis clamp so spawn never escapes
 *  the cube interior regardless of camera orientation. */
export const SPAWN_WALL_INSET = 30;

/**
 * Compute the spawn point in world space. The spawn is on the wall
 * the camera is facing along `camRight` (cast a ray from `camPos`
 * along `camRight` to the nearest cube wall, back off by
 * `SPAWN_WALL_INSET`), then offset forward + up by the fixed
 * camera-relative offsets.
 *
 * Result is clamped per-axis to `(half - SPAWN_WALL_INSET)` so a
 * camera rotated such that camFwd or camUp has a significant
 * X/Y/Z component can't push the spawn past a non-camRight wall.
 *
 * Writes into `out` and returns it for chaining.
 */
export function computeSpawnPoint(
  out: Vector3,
  camPos: Vector3,
  camRight: Vector3,
  camFwd: Vector3,
  camUp: Vector3,
  half: Vector3,
): Vector3 {
  const tWall = firstWallT(camPos, camRight, half);
  // tWall is finite for any non-degenerate camRight. If somehow it
  // isn't (camRight ≈ 0 — pathological, shouldn't happen with a
  // unit-vector basis), max(0, …) below clamps to 0, the lateral
  // offset becomes 0, and the spawn just sits at camPos + fwd/up
  // offsets. Better than NaN propagating.
  const lateralDist = Number.isFinite(tWall) ? Math.max(0, tWall - SPAWN_WALL_INSET) : 0;
  out
    .copy(camPos)
    .addScaledVector(camRight, lateralDist)
    .addScaledVector(camFwd, SPAWN_FIXED_FWD)
    .addScaledVector(camUp, SPAWN_FIXED_UP);

  // Per-axis clamp. The fwd + up offsets can push the spawn past a
  // wall that's NOT camRight — e.g. with camRight along +X and camFwd
  // along -Z, the +Z wall is closer than the +X wall after the fwd
  // offset is applied. Clamping each component independently keeps
  // the spawn inside the cube regardless of orientation.
  const limX = half.x - SPAWN_WALL_INSET;
  const limY = half.y - SPAWN_WALL_INSET;
  const limZ = half.z - SPAWN_WALL_INSET;
  out.x = Math.max(-limX, Math.min(limX, out.x));
  out.y = Math.max(-limY, Math.min(limY, out.y));
  out.z = Math.max(-limZ, Math.min(limZ, out.z));
  return out;
}
