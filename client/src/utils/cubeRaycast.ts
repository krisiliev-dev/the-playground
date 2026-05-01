import { Vector3 } from 'three';

export interface CubeHit {
  /** World-space hit point on the wall. */
  point: Vector3;
  /** Inward-facing normal (points toward the cube interior / camera). */
  normal: Vector3;
  /** Distance along the ray to the wall (t in `origin + dir·t`). Useful
   *  for callers that want to displace something part-way along the
   *  ray rather than land exactly on the wall. */
  t: number;
  /** Which axis the hit was on (0=X, 1=Y, 2=Z). */
  axis: 0 | 1 | 2;
}

interface SlabHit {
  t: number;
  axis: 0 | 1 | 2;
  /** +1 if the wall is at +half on this axis, -1 if at -half. */
  sign: 1 | -1;
}

/**
 * Slab-method core — finds the smallest positive t at which the ray
 * `origin + dir·t` crosses an axis-aligned wall of an axis-aligned cube
 * centered at the origin with the given half-extents.
 *
 * Returns the t/axis/sign of the closest hit, or `null` if every
 * direction component is degenerate (all |dir.x|, |dir.y|, |dir.z| <
 * 1e-8 — the ray is effectively a point).
 *
 * Pure: no allocation, no Three.js dependencies beyond Vector3 field
 * reads. Exported (rather than nested inside `intersectInsideCube`) so
 * callers that only need the distance — `computeSpawnPoint`, the
 * BulletTimeDirector spawn capture — can skip the hit-point + normal
 * allocation that `intersectInsideCube` does.
 */
function firstWallSlabHit(origin: Vector3, direction: Vector3, half: Vector3): SlabHit | null {
  let bestT = Infinity;
  let bestAxis: 0 | 1 | 2 = 0;
  let bestSign: 1 | -1 = 1;

  for (let i = 0 as 0 | 1 | 2; i < 3; i = ((i + 1) | 0) as 0 | 1 | 2) {
    const di = i === 0 ? direction.x : i === 1 ? direction.y : direction.z;
    if (Math.abs(di) < 1e-8) {
      continue;
    }
    const oi = i === 0 ? origin.x : i === 1 ? origin.y : origin.z;
    const hi = i === 0 ? half.x : i === 1 ? half.y : half.z;
    const t1 = (hi - oi) / di;
    const t2 = (-hi - oi) / di;
    if (t1 > 0 && t1 < bestT) {
      bestT = t1;
      bestAxis = i;
      bestSign = 1;
    }
    if (t2 > 0 && t2 < bestT) {
      bestT = t2;
      bestAxis = i;
      bestSign = -1;
    }
  }
  if (!Number.isFinite(bestT)) {
    return null;
  }
  return { t: bestT, axis: bestAxis, sign: bestSign };
}

/**
 * Distance along a ray to the first axis-aligned cube wall it meets.
 * Returns `Infinity` if the ray's direction is degenerate (no positive-t
 * crossing exists on any axis).
 *
 * This is the lightweight version of `intersectInsideCube` for callers
 * that only need the distance — e.g. the reveal-sequence spawn-point
 * computation, which casts `camRight` from the click camera position
 * to the nearest side wall.
 */
export function firstWallT(origin: Vector3, direction: Vector3, half: Vector3): number {
  const hit = firstWallSlabHit(origin, direction, half);
  return hit ? hit.t : Infinity;
}

/**
 * Slab-method intersection of a ray with the inside of an axis-aligned cube
 * centered at the origin. Returns the first wall the ray exits through, with
 * a normal pointing inward.
 *
 * Half-extents are REQUIRED — pass them from the live environment config so
 * this never goes stale when the cube resizes.
 */
export function intersectInsideCube(
  origin: Vector3,
  direction: Vector3,
  half: Vector3,
): CubeHit | null {
  const hit = firstWallSlabHit(origin, direction, half);
  if (!hit) {
    return null;
  }
  const point = new Vector3(
    origin.x + direction.x * hit.t,
    origin.y + direction.y * hit.t,
    origin.z + direction.z * hit.t,
  );
  const normal = new Vector3();
  if (hit.axis === 0) {
    normal.x = -hit.sign;
  } else if (hit.axis === 1) {
    normal.y = -hit.sign;
  } else {
    normal.z = -hit.sign;
  }
  return { point, normal, t: hit.t, axis: hit.axis };
}
