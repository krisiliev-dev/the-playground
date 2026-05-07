/**
 * CursorAvatar pure math — extracted from the 1100-line component so
 * the per-frame computations can be unit-tested without standing up an
 * R3F scene. The component itself stays imperative (it owns all the
 * refs, listeners, and Three.js mutations); these helpers own only
 * the math.
 *
 * Every function writes into caller-owned `Vector3` buffers where
 * applicable, so the per-frame hot path stays zero-alloc.
 */
import { Quaternion, Vector3 } from 'three';

export interface WalkKeys {
  w: boolean;
  a: boolean;
  s: boolean;
  d: boolean;
}

/** Continuous forward/back throttle, clamped to [-1, 1]. */
export const PINCH_VELOCITY_MIN = -1;
export const PINCH_VELOCITY_MAX = 1;

/**
 * Project a normalised-device-coordinate pointer position into a
 * world-space point sitting `depth` units in front of the camera.
 * Uses the supplied camera basis vectors directly (skip the
 * matrix-inverse path that `unproject` takes) so successive frames
 * don't accumulate floating-point drift around the pivot.
 *
 * `fovY` in radians, `aspect` = width/height. NDC range [-1, 1].
 */
export function projectNDCToWorld(
  out: Vector3,
  camPos: Vector3,
  camFwd: Vector3,
  camRight: Vector3,
  camUp: Vector3,
  fovY: number,
  aspect: number,
  depth: number,
  ndcX: number,
  ndcY: number,
): void {
  const halfH = depth * Math.tan(fovY / 2);
  const halfW = halfH * aspect;
  out
    .copy(camPos)
    .addScaledVector(camFwd, depth)
    .addScaledVector(camRight, ndcX * halfW)
    .addScaledVector(camUp, ndcY * halfH);
}

/**
 * Continuous pinch throttle. `currentDist` is the distance between
 * the two touch finger positions on the current frame; `startDist`
 * is the same on the frame the pinch began. Returns:
 *   - +1 (forward) when fingers have spread by `fullThrottleDelta` px
 *   - -1 (backward) when fingers have closed by `fullThrottleDelta` px
 *   - 0 if `currentDist <= 0` (degenerate frame during a 2→1 finger
 *     transition — the consumer should treat 0 as "no input this frame"
 *     rather than snapping to a velocity derived from a missing finger)
 */
export function computePinchVelocity(
  currentDist: number,
  startDist: number,
  fullThrottleDelta: number,
): number {
  if (currentDist <= 0) {
    return 0;
  }
  const delta = currentDist - startDist;
  return Math.max(PINCH_VELOCITY_MIN, Math.min(PINCH_VELOCITY_MAX, delta / fullThrottleDelta));
}

/**
 * Group-origin position for the lean-on-press animation. The cursor
 * group's visible TIP (located at `tipLocalOffset` in the model's
 * local frame, then rotated by `pressAnchorQuat` and scaled by
 * `scale`) lands exactly on `hitPoint` when the group is at the
 * returned position.
 *
 * `scratchTipWorld` is a caller-owned scratch Vector3 — used to
 * compute the rotated/scaled tip offset without allocating.
 */
export function computeLeanTarget(
  out: Vector3,
  hitPoint: Vector3,
  tipLocalOffset: Vector3,
  pressAnchorQuat: Quaternion,
  scale: number,
  scratchTipWorld: Vector3,
): void {
  scratchTipWorld.copy(tipLocalOffset).applyQuaternion(pressAnchorQuat).multiplyScalar(scale);
  out.copy(hitPoint).sub(scratchTipWorld);
}

export interface WalkVector {
  mx: number;
  my: number;
  mz: number;
  /** `Math.hypot(mx, my, mz)` — useful for the diagonal-normalisation
   *  step that prevents W+D from moving √2× faster than W alone. */
  len: number;
}

/**
 * Walk-direction vector from WASD keys + camera yaw/pitch + touch
 * forward throttle. The forward axis (W/S, plus continuous
 * `touchWalkVelocity` from a 2-finger pinch) is rotated by
 * Euler(pitch, yaw, 0, YXZ), so flying up/down "follows the camera
 * pitch" the way an FPS does. Strafe (A/D) ignores pitch — left/right
 * stays horizontal.
 */
export function computeWalkVector(
  keys: WalkKeys,
  yaw: number,
  pitch: number,
  touchWalkVelocity: number,
): WalkVector {
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);

  let mx = 0;
  let my = 0;
  let mz = 0;
  const fwdInput = (keys.w ? 1 : 0) - (keys.s ? 1 : 0) + touchWalkVelocity;
  if (fwdInput !== 0) {
    mx += fwdInput * -sy * cp;
    my += fwdInput * sp;
    mz += fwdInput * -cy * cp;
  }
  if (keys.d) {
    mx += cy;
    mz += -sy;
  }
  if (keys.a) {
    mx -= cy;
    mz -= -sy;
  }
  return { mx, my, mz, len: Math.hypot(mx, my, mz) };
}

/**
 * Walk-lean target angle (radians, around the avatar's local X axis).
 * Forward input — the same `(W ? 1 : 0) - (S ? 1 : 0) + touchWalkVelocity`
 * sum used by `computeWalkVector` — is clamped to `[-1, +1]` and
 * scaled by `leanMaxRad`. The caller smooths the result toward the
 * current lean so the body eases in and out of the tilt instead of
 * snapping.
 *
 * Clamping at the input rather than after multiplication preserves
 * the semantics: a player holding W and pushing the touch throttle
 * fully forward gets the same lean as either input alone — pushing
 * harder doesn't tilt them more than the visual budget allows.
 */
export function computeWalkLeanTarget(
  keys: WalkKeys,
  touchWalkVelocity: number,
  leanMaxRad: number,
): number {
  const fwdInput = (keys.w ? 1 : 0) - (keys.s ? 1 : 0) + touchWalkVelocity;
  const clamped = Math.max(-1, Math.min(1, fwdInput));
  return clamped * leanMaxRad;
}

/**
 * Wall-proximity factor (0..1) for the wall-ambient drone. 0 when the
 * avatar is at the cube centre, 1 when it touches a wall. Uses the
 * NEAREST wall (any axis) — the avatar is always closest to a single
 * wall at any moment, so a max-over-axes is the right shape.
 */
export function computeWallProximity(
  avatarPos: Vector3,
  cubeHalf: Vector3,
  fadeDistance: number,
): number {
  const cx = cubeHalf.x - Math.abs(avatarPos.x);
  const cy = cubeHalf.y - Math.abs(avatarPos.y);
  const cz = cubeHalf.z - Math.abs(avatarPos.z);
  const distNearest = Math.min(cx, cy, cz);
  return Math.max(0, Math.min(1, 1 - distNearest / fadeDistance));
}

/**
 * Clamp a position to inside an axis-aligned cube with `margin`
 * inset on each axis. Mutates `pos` in place. Returns nothing — the
 * caller already owns `pos`. Used for both the avatar's body
 * (margin = AVATAR_WALL_MARGIN) and the camera's offset endpoint
 * (margin = CAMERA_WALL_MARGIN).
 *
 * Optional `portalHole` carves a **square** exception in *one* wall:
 * when the position's projection onto the portal's wall plane falls
 * within `radius` of `center` under the Chebyshev (max-norm) metric
 * — i.e. inside an axis-aligned square of half-edge `radius` — the
 * clamp on that wall's specific side is skipped, so the avatar can
 * physically pass through the portal into the room beyond. The
 * opposite wall (and the other four walls) still clamp normally —
 * the hole is one-sided, not a tunnel through the entire cube.
 *
 * The portal's wall is identified by the dominant component of
 * `normal` (axis-aligned cubes have wall normals ±1 on exactly one
 * axis). The sign of that component tells us which side of the
 * cube the portal is on, so we know which clamp end to relax.
 */
export interface PortalHole {
  center: Vector3;
  normal: Vector3;
  /** Half-edge of the square hole (Chebyshev / max-norm radius). */
  radius: number;
  /** Wall-plane +X axis. Required when `quadrantOffset > 0`. */
  right?: Vector3;
  /** Wall-plane +Y axis. Required when `quadrantOffset > 0`. */
  up?: Vector3;
  /** When non-zero the hole becomes FOUR squares (one per quadrant)
   *  centred at (±quadrantOffset, ±quadrantOffset) along the wall
   *  basis. The avatar can pass through any of the four; the strips
   *  between them clamp like solid wall. */
  quadrantOffset?: number;
}

/**
 * Clamp `pos` into a box of half-extents `half` centred at `center`
 * (origin if omitted), with `margin` units of inset on every face.
 * `portalHole`, if supplied, carves a circular gap on the wall whose
 * outward normal matches `portalHole.normal`, so the avatar can pass
 * through it.
 *
 * `center` lets the same helper clamp into the main cube (centred at
 * world origin) AND into the hall outside the wall (centred at the
 * hall's world position) without callers translating `pos` themselves.
 */
export function clampToBoxInterior(
  pos: Vector3,
  half: Vector3,
  margin: number,
  portalHole?: PortalHole,
  center?: Vector3,
): void {
  const cx = center ? center.x : 0;
  const cy = center ? center.y : 0;
  const cz = center ? center.z : 0;
  const minX = cx - half.x + margin;
  const maxX = cx + half.x - margin;
  const minY = cy - half.y + margin;
  const maxY = cy + half.y - margin;
  const minZ = cz - half.z + margin;
  const maxZ = cz + half.z - margin;

  // Compute whether `pos` falls inside the portal's circular hole
  // (projection onto the wall plane is within `radius` of `center`).
  // If no hole, all six clamp-end checks below stay enabled.
  let insideHole = false;
  let skipNegX = false;
  let skipPosX = false;
  let skipNegY = false;
  let skipPosY = false;
  let skipNegZ = false;
  let skipPosZ = false;
  if (portalHole) {
    const dx = pos.x - portalHole.center.x;
    const dy = pos.y - portalHole.center.y;
    const dz = pos.z - portalHole.center.z;
    const dotN = dx * portalHole.normal.x + dy * portalHole.normal.y + dz * portalHole.normal.z;
    const tx = dx - dotN * portalHole.normal.x;
    const ty = dy - dotN * portalHole.normal.y;
    const tz = dz - dotN * portalHole.normal.z;
    if (
      portalHole.quadrantOffset !== undefined &&
      portalHole.quadrantOffset > 0 &&
      portalHole.right &&
      portalHole.up
    ) {
      // Four-quadrant symmetric Chebyshev: a position is inside SOME
      // hole iff |abs(localX) - offset| < radius AND |abs(localY) -
      // offset| < radius — same trick the GridMaterial shader uses.
      const localX = tx * portalHole.right.x + ty * portalHole.right.y + tz * portalHole.right.z;
      const localY = tx * portalHole.up.x + ty * portalHole.up.y + tz * portalHole.up.z;
      insideHole =
        Math.abs(Math.abs(localX) - portalHole.quadrantOffset) < portalHole.radius &&
        Math.abs(Math.abs(localY) - portalHole.quadrantOffset) < portalHole.radius;
    } else {
      // Single-square Chebyshev: max of absolute tangent components.
      // For axis-aligned walls the normal-axis component is zero and
      // falls out of the max for free.
      const tangentMax = Math.max(Math.abs(tx), Math.abs(ty), Math.abs(tz));
      insideHole = tangentMax < portalHole.radius;
    }
    if (insideHole) {
      // The inward normal points away from the wall; its sign on
      // the wall's axis tells us which end of the cube the wall is
      // on, and therefore which clamp side to skip. (Threshold of
      // 0.5 is robust given the components are ±1 on one axis.)
      skipNegX = portalHole.normal.x > 0.5;
      skipPosX = portalHole.normal.x < -0.5;
      skipNegY = portalHole.normal.y > 0.5;
      skipPosY = portalHole.normal.y < -0.5;
      skipNegZ = portalHole.normal.z > 0.5;
      skipPosZ = portalHole.normal.z < -0.5;
    }
  }

  if (!skipNegX && pos.x < minX) {
    pos.x = minX;
  } else if (!skipPosX && pos.x > maxX) {
    pos.x = maxX;
  }
  if (!skipNegY && pos.y < minY) {
    pos.y = minY;
  } else if (!skipPosY && pos.y > maxY) {
    pos.y = maxY;
  }
  if (!skipNegZ && pos.z < minZ) {
    pos.z = minZ;
  } else if (!skipPosZ && pos.z > maxZ) {
    pos.z = maxZ;
  }
}

/**
 * Set a Y-axis (yaw-only) quaternion in place: (0, sin(θ/2), 0,
 * cos(θ/2)). The avatar's body always faces the look direction
 * (yaw), and pitch is applied to the camera offset, not the body —
 * so the avatar quaternion is a pure Y-rotation.
 */
export function setYawQuat(out: Quaternion, yaw: number): void {
  const half = yaw * 0.5;
  out.set(0, Math.sin(half), 0, Math.cos(half));
}

/**
 * Initial-pan progress over `[0, 1]`. The pan is smoothstep-eased
 * across `duration` seconds; past the end this returns 1 so callers
 * can use `progress >= 1` as the "steady-state" gate.
 */
export function computeInitialPanProgress(elapsed: number, duration: number): number {
  if (elapsed >= duration) {
    return 1;
  }
  if (elapsed <= 0) {
    return 0;
  }
  const t = elapsed / duration;
  return t * t * (3 - 2 * t);
}

/**
 * Camera-offset shorten ratio so the camera stays inside the cube.
 * `offset` is the rotated 3rd-person offset (avatarPos + offset =
 * naive camera position). Returns the smallest ratio ≤ 1 by which
 * the offset must be scaled so the resulting camera position is
 * within `(half - margin)` on every axis.
 *
 * Returns 1 if `offsetLen` is 0 (camera already at avatar — no walk
 * to constrain) or if no wall is in the way.
 */
export function computeCameraCollisionRatio(
  avatarPos: Vector3,
  offset: Vector3,
  half: Vector3,
  margin: number,
): number {
  const offsetLen = offset.length();
  if (offsetLen <= 0) {
    return 1;
  }
  const dx = offset.x / offsetLen;
  const dy = offset.y / offsetLen;
  const dz = offset.z / offsetLen;
  const cMaxX = half.x - margin;
  const cMaxY = half.y - margin;
  const cMaxZ = half.z - margin;
  let maxT = offsetLen;
  if (Math.abs(dx) > 1e-6) {
    const t = ((dx > 0 ? cMaxX : -cMaxX) - avatarPos.x) / dx;
    if (t > 0 && t < maxT) {
      maxT = t;
    }
  }
  if (Math.abs(dy) > 1e-6) {
    const t = ((dy > 0 ? cMaxY : -cMaxY) - avatarPos.y) / dy;
    if (t > 0 && t < maxT) {
      maxT = t;
    }
  }
  if (Math.abs(dz) > 1e-6) {
    const t = ((dz > 0 ? cMaxZ : -cMaxZ) - avatarPos.z) / dz;
    if (t > 0 && t < maxT) {
      maxT = t;
    }
  }
  return Math.max(0, maxT) / offsetLen;
}
