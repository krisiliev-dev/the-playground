import { Vector3 } from 'three';

export interface CubeHit {
  /** World-space hit point on the wall. */
  point: Vector3;
  /** Inward-facing normal (points toward the cube interior / camera). */
  normal: Vector3;
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
  let bestT = Infinity;
  let axis = 0;
  let sign: 1 | -1 = 1;

  // Slab method: for each axis, compute t at +half and -half walls,
  // keep the smallest positive t (first wall the ray exits through).
  // Read components directly off Vector3 fields to avoid per-call
  // tuple allocations on the click hot path.
  for (let i = 0; i < 3; i++) {
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
      axis = i;
      sign = 1;
    }
    if (t2 > 0 && t2 < bestT) {
      bestT = t2;
      axis = i;
      sign = -1;
    }
  }

  if (!Number.isFinite(bestT)) {
    return null;
  }

  const point = new Vector3(
    origin.x + direction.x * bestT,
    origin.y + direction.y * bestT,
    origin.z + direction.z * bestT,
  );
  const normal = new Vector3();
  if (axis === 0) {
    normal.x = -sign;
  } else if (axis === 1) {
    normal.y = -sign;
  } else {
    normal.z = -sign;
  }
  return { point, normal };
}
