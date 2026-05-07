/**
 * CursorAvatar pure math — covers the helpers extracted from the
 * 1100-line component. Each function is testable in isolation against
 * bare numbers + Three.js Vector3/Quaternion, no R3F scene needed.
 */
import { describe, it, expect } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import {
  clampToBoxInterior,
  computeCameraCollisionRatio,
  computeInitialPanProgress,
  computeLeanTarget,
  computePinchVelocity,
  computeWalkLeanTarget,
  computeWalkVector,
  computeWallProximity,
  projectNDCToWorld,
  setYawQuat,
} from '@/components/scene/cursorAvatarMath';

const HALF = new Vector3(40, 40, 40);

describe('projectNDCToWorld', () => {
  // Standard camera looking down -Z, identity orientation.
  const camPos = new Vector3(0, 0, 0);
  const camFwd = new Vector3(0, 0, -1);
  const camRight = new Vector3(1, 0, 0);
  const camUp = new Vector3(0, 1, 0);
  const fovY = (60 * Math.PI) / 180; // 60 deg vertical
  const aspect = 16 / 9;
  const depth = 3;

  it('NDC (0, 0) projects to the camera-forward point at the given depth', () => {
    const out = new Vector3();
    projectNDCToWorld(out, camPos, camFwd, camRight, camUp, fovY, aspect, depth, 0, 0);
    expect(out.x).toBeCloseTo(0, 6);
    expect(out.y).toBeCloseTo(0, 6);
    expect(out.z).toBeCloseTo(-depth, 6);
  });

  it('NDC (+1, 0) projects to the right edge of the screen at depth', () => {
    const out = new Vector3();
    projectNDCToWorld(out, camPos, camFwd, camRight, camUp, fovY, aspect, depth, 1, 0);
    const expectedHalfW = depth * Math.tan(fovY / 2) * aspect;
    expect(out.x).toBeCloseTo(expectedHalfW, 6);
    expect(out.z).toBeCloseTo(-depth, 6);
  });

  it('NDC (0, +1) projects to the top edge of the screen at depth', () => {
    const out = new Vector3();
    projectNDCToWorld(out, camPos, camFwd, camRight, camUp, fovY, aspect, depth, 0, 1);
    const expectedHalfH = depth * Math.tan(fovY / 2);
    expect(out.y).toBeCloseTo(expectedHalfH, 6);
  });

  it('respects camera position offset', () => {
    const offCam = new Vector3(10, 5, -20);
    const out = new Vector3();
    projectNDCToWorld(out, offCam, camFwd, camRight, camUp, fovY, aspect, depth, 0, 0);
    expect(out.x).toBeCloseTo(10, 6);
    expect(out.y).toBeCloseTo(5, 6);
    expect(out.z).toBeCloseTo(-20 - depth, 6);
  });
});

describe('computePinchVelocity', () => {
  it('returns 0 for zero delta (held steady)', () => {
    expect(computePinchVelocity(100, 100, 150)).toBe(0);
  });

  it('clamps to +1 when fingers spread past fullThrottleDelta', () => {
    expect(computePinchVelocity(500, 100, 150)).toBe(1);
  });

  it('clamps to -1 when fingers close past fullThrottleDelta', () => {
    expect(computePinchVelocity(0.1, 200, 150)).toBeCloseTo(-1, 6);
  });

  it('returns linear interpolation inside the throttle range', () => {
    // 75 px spread / 150 px full throttle = +0.5
    expect(computePinchVelocity(175, 100, 150)).toBeCloseTo(0.5, 6);
    // -75 px close = -0.5
    expect(computePinchVelocity(25, 100, 150)).toBeCloseTo(-0.5, 6);
  });

  it('returns 0 for currentDist <= 0 (degenerate frame, no fingers)', () => {
    // The bug fix gate: without this, delta = -startDist would clamp
    // to -1 even though no real pinch happened.
    expect(computePinchVelocity(0, 100, 150)).toBe(0);
    expect(computePinchVelocity(-5, 100, 150)).toBe(0);
  });
});

describe('computeLeanTarget', () => {
  it('with identity quaternion + scale=1, group origin = hit - tipLocalOffset', () => {
    const out = new Vector3();
    const scratch = new Vector3();
    const hit = new Vector3(10, 5, -3);
    const tip = new Vector3(0.5, 1, 0); // tip is at upper-right of model
    computeLeanTarget(out, hit, tip, new Quaternion(), 1, scratch);
    expect(out.x).toBeCloseTo(10 - 0.5, 6);
    expect(out.y).toBeCloseTo(5 - 1, 6);
    expect(out.z).toBeCloseTo(-3, 6);
  });

  it('scales the tip offset by `scale` before subtracting', () => {
    const out = new Vector3();
    const scratch = new Vector3();
    const hit = new Vector3(0, 0, 0);
    const tip = new Vector3(0, 1, 0);
    computeLeanTarget(out, hit, tip, new Quaternion(), 0.03, scratch);
    expect(out.y).toBeCloseTo(-0.03, 8);
  });

  it('rotates the tip offset by pressAnchorQuat', () => {
    // 90deg around +Z rotates +Y → -X (right-hand-rule)
    const ninetyZ = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2);
    const out = new Vector3();
    const scratch = new Vector3();
    const hit = new Vector3(0, 0, 0);
    const tip = new Vector3(0, 1, 0);
    computeLeanTarget(out, hit, tip, ninetyZ, 1, scratch);
    expect(out.x).toBeCloseTo(1, 6); // group origin pushed +X to compensate for tip's -X swing
    expect(out.y).toBeCloseTo(0, 6);
  });

  it('group + (rotated, scaled tip) = hit, the contract that pins the tip on target', () => {
    // For arbitrary inputs, the lean-target invariant is that adding
    // back the rotated-scaled tip recovers the hit point. This is
    // the load-bearing property of the function.
    const quat = new Quaternion()
      .setFromAxisAngle(new Vector3(0.3, 0.8, 0.2).normalize(), 1.2)
      .normalize();
    const tip = new Vector3(0.5, 1, -0.2);
    const hit = new Vector3(7, -3, 4);
    const scale = 0.03;
    const out = new Vector3();
    const scratch = new Vector3();
    computeLeanTarget(out, hit, tip, quat, scale, scratch);

    // Reconstruct: out + (tip rotated by quat, scaled) should equal hit.
    const rotatedTip = tip.clone().applyQuaternion(quat).multiplyScalar(scale);
    const recovered = out.clone().add(rotatedTip);
    expect(recovered.distanceTo(hit)).toBeLessThan(1e-9);
  });
});

describe('computeWalkVector', () => {
  const idleKeys = { w: false, a: false, s: false, d: false };

  it('returns zeros when no keys held and no touch throttle', () => {
    const w = computeWalkVector(idleKeys, 0, 0, 0);
    expect(w).toEqual({ mx: 0, my: 0, mz: 0, len: 0 });
  });

  it('W with yaw=0 walks in -Z (camera forward at identity orientation)', () => {
    const w = computeWalkVector({ ...idleKeys, w: true }, 0, 0, 0);
    expect(w.mx).toBeCloseTo(0, 6);
    expect(w.my).toBeCloseTo(0, 6);
    expect(w.mz).toBeCloseTo(-1, 6);
  });

  it('S with yaw=0 walks in +Z', () => {
    const w = computeWalkVector({ ...idleKeys, s: true }, 0, 0, 0);
    expect(w.mz).toBeCloseTo(1, 6);
  });

  it('D strafes in +X with yaw=0 (right-of-camera)', () => {
    const w = computeWalkVector({ ...idleKeys, d: true }, 0, 0, 0);
    expect(w.mx).toBeCloseTo(1, 6);
    expect(w.mz).toBeCloseTo(0, 6);
  });

  it('A strafes in -X with yaw=0 (left-of-camera)', () => {
    const w = computeWalkVector({ ...idleKeys, a: true }, 0, 0, 0);
    expect(w.mx).toBeCloseTo(-1, 6);
  });

  it('W with pitch=PI/4 has both my and mz components (FPS-style flying)', () => {
    const w = computeWalkVector({ ...idleKeys, w: true }, 0, Math.PI / 4, 0);
    expect(w.my).toBeCloseTo(Math.sin(Math.PI / 4), 6);
    expect(w.mz).toBeCloseTo(-Math.cos(Math.PI / 4), 6);
  });

  it('A/D strafe ignores pitch (stays horizontal)', () => {
    const w = computeWalkVector({ ...idleKeys, d: true }, 0, Math.PI / 4, 0);
    expect(w.my).toBeCloseTo(0, 6);
    expect(w.mx).toBeCloseTo(1, 6);
  });

  it('touchWalkVelocity adds to the forward axis as a continuous throttle', () => {
    const w = computeWalkVector(idleKeys, 0, 0, 0.5);
    expect(w.mz).toBeCloseTo(-0.5, 6);
  });

  it('W + 2-finger pinch sums on the forward axis (input is additive)', () => {
    const w = computeWalkVector({ ...idleKeys, w: true }, 0, 0, 0.5);
    expect(w.mz).toBeCloseTo(-1.5, 6);
  });

  it('W + S cancel each other out (1 - 1 = 0 forward input)', () => {
    const w = computeWalkVector({ ...idleKeys, w: true, s: true }, 0, 0, 0);
    expect(w.len).toBeCloseTo(0, 6);
  });

  it('len is exactly Math.hypot(mx, my, mz)', () => {
    const w = computeWalkVector({ w: true, a: true, s: false, d: false }, 0, 0, 0);
    expect(w.len).toBeCloseTo(Math.hypot(w.mx, w.my, w.mz), 10);
  });
});

describe('computeWallProximity', () => {
  it('is 0 at the cube centre', () => {
    expect(computeWallProximity(new Vector3(0, 0, 0), HALF, 12)).toBe(0);
  });

  it('is 0 just outside the fade band', () => {
    // distNearest = 40 - 27 = 13 > fadeDistance 12 → factor = 0.
    expect(computeWallProximity(new Vector3(27, 0, 0), HALF, 12)).toBe(0);
  });

  it('rises linearly inside the fade band', () => {
    // distNearest = 40 - 34 = 6, fade = 12 → factor = 1 - 6/12 = 0.5.
    expect(computeWallProximity(new Vector3(34, 0, 0), HALF, 12)).toBeCloseTo(0.5, 6);
  });

  it('caps at 1 at the wall', () => {
    expect(computeWallProximity(new Vector3(40, 0, 0), HALF, 12)).toBe(1);
  });

  it('uses the nearest wall (any axis), not just X', () => {
    // Avatar is far on X (distNearest=10 to +X wall) but very close to
    // Y (distNearest=2 to +Y wall). Nearest = 2 → factor = 1 - 2/12.
    expect(computeWallProximity(new Vector3(30, 38, 0), HALF, 12)).toBeCloseTo(1 - 2 / 12, 6);
  });

  it('clamps to 1 when avatar is inside the wall (negative distNearest)', () => {
    // distNearest = 40 - 50 = -10 → 1 - (-10)/12 = 1.83 → clamped to 1.
    expect(computeWallProximity(new Vector3(50, 0, 0), HALF, 12)).toBe(1);
  });
});

describe('clampToBoxInterior', () => {
  it('leaves position untouched when already inside (margin window)', () => {
    const pos = new Vector3(10, 5, -3);
    clampToBoxInterior(pos, HALF, 8);
    expect(pos.equals(new Vector3(10, 5, -3))).toBe(true);
  });

  it('clamps each axis independently to ±(half - margin)', () => {
    const pos = new Vector3(50, -100, 0);
    clampToBoxInterior(pos, HALF, 8);
    expect(pos.x).toBe(40 - 8);
    expect(pos.y).toBe(-(40 - 8));
    expect(pos.z).toBe(0);
  });

  it('mutates in place — same vector reference', () => {
    const pos = new Vector3(100, 0, 0);
    const ret = pos;
    clampToBoxInterior(pos, HALF, 8);
    expect(ret).toBe(pos);
    expect(pos.x).toBe(32);
  });

  describe('with portalHole', () => {
    // Hole on the +X wall (point [40, 0, 0], inward normal [-1, 0, 0]),
    // disc radius 10. Avatar projection onto the wall plane is just
    // (y, z); inside-disc means sqrt(y² + z²) < 10.
    const PLUS_X_HOLE = {
      center: new Vector3(40, 0, 0),
      normal: new Vector3(-1, 0, 0),
      radius: 10,
    };

    it('skips the +X clamp when the avatar projects inside the disc', () => {
      // Avatar past the +X wall (x > 32 = limX) but tangentially
      // centred → in the hole → +X clamp doesn't fire.
      const pos = new Vector3(100, 0, 0);
      clampToBoxInterior(pos, HALF, 8, PLUS_X_HOLE);
      expect(pos.x).toBe(100);
    });

    it('still clamps the +X wall when the projection is outside the disc', () => {
      // Avatar past the +X wall but tangentially way out (y = 50 >
      // disc radius 10) → not in hole → normal clamp.
      const pos = new Vector3(100, 50, 0);
      clampToBoxInterior(pos, HALF, 8, PLUS_X_HOLE);
      expect(pos.x).toBe(32);
      // Y also clamps independently because (50 > 32 = limY).
      expect(pos.y).toBe(32);
    });

    it('still clamps the OPPOSITE (-X) wall even when in the +X hole', () => {
      // Hole is one-sided. An avatar in the hole's tangent zone
      // but on the wrong side of the cube can't tunnel through to
      // the +X wall via a non-existent -X exception.
      const pos = new Vector3(-100, 0, 0);
      clampToBoxInterior(pos, HALF, 8, PLUS_X_HOLE);
      expect(pos.x).toBe(-32);
    });

    it('passes through when no portalHole is provided (back-compat)', () => {
      const pos = new Vector3(100, 0, 0);
      clampToBoxInterior(pos, HALF, 8);
      expect(pos.x).toBe(32);
    });
  });
});

describe('setYawQuat', () => {
  it('produces identity quaternion at yaw=0', () => {
    const q = new Quaternion();
    setYawQuat(q, 0);
    expect(q.x).toBe(0);
    expect(q.y).toBe(0);
    expect(q.z).toBe(0);
    expect(q.w).toBe(1);
  });

  it('writes a Y-axis-only rotation (x=z=0)', () => {
    const q = new Quaternion();
    setYawQuat(q, Math.PI / 4);
    expect(q.x).toBe(0);
    expect(q.z).toBe(0);
    expect(q.y).toBeCloseTo(Math.sin(Math.PI / 8), 8);
    expect(q.w).toBeCloseTo(Math.cos(Math.PI / 8), 8);
  });

  it('rotating (0, 0, -1) by setYawQuat(yaw) gives the correct world forward', () => {
    // Avatar yaw rotates the body's local -Z (forward) into world space.
    // For yaw=PI/2, world forward should be -X.
    const q = new Quaternion();
    setYawQuat(q, Math.PI / 2);
    const fwd = new Vector3(0, 0, -1).applyQuaternion(q);
    expect(fwd.x).toBeCloseTo(-1, 6);
    expect(fwd.y).toBeCloseTo(0, 6);
    expect(fwd.z).toBeCloseTo(0, 6);
  });

  it('mutates in place and writes nothing else', () => {
    const q = new Quaternion(0.1, 0.2, 0.3, 0.4);
    setYawQuat(q, 0);
    // After setYawQuat(0), the quaternion is identity regardless of
    // its prior contents.
    expect(q.equals(new Quaternion())).toBe(true);
  });
});

describe('computeInitialPanProgress', () => {
  it('returns 0 at elapsed=0', () => {
    expect(computeInitialPanProgress(0, 1.5)).toBe(0);
  });

  it('returns 1 at elapsed >= duration (clamps so callers can gate on >= 1)', () => {
    expect(computeInitialPanProgress(1.5, 1.5)).toBe(1);
    expect(computeInitialPanProgress(5, 1.5)).toBe(1);
  });

  it('returns 0 for negative elapsed (clock skew defensive)', () => {
    expect(computeInitialPanProgress(-1, 1.5)).toBe(0);
  });

  it('returns smoothstep at the midpoint (eased = 0.5)', () => {
    expect(computeInitialPanProgress(0.75, 1.5)).toBeCloseTo(0.5, 10);
  });

  it('eases in/out — derivative at endpoints is 0 (small ε is much smaller than ε itself)', () => {
    const eps = 0.01;
    const earlyProgress = computeInitialPanProgress(eps, 1);
    expect(earlyProgress).toBeLessThan(eps); // ~0.0003
  });

  it('is monotonic across a sweep', () => {
    let prev = -Infinity;
    for (let t = 0; t <= 1.5; t += 0.05) {
      const p = computeInitialPanProgress(t, 1.5);
      expect(p).toBeGreaterThanOrEqual(prev);
      prev = p;
    }
  });
});

describe('computeCameraCollisionRatio', () => {
  it('returns 1 when offset has zero length (no collision possible)', () => {
    expect(computeCameraCollisionRatio(new Vector3(0, 0, 0), new Vector3(0, 0, 0), HALF, 3)).toBe(
      1,
    );
  });

  it('returns 1 when the offset endpoint is inside the cube minus margin', () => {
    // Avatar at origin, offset 5 in +Z. Cube allows z up to 40-3=37.
    // 5 < 37 → no collision → ratio = 1.
    expect(computeCameraCollisionRatio(new Vector3(0, 0, 0), new Vector3(0, 0, 5), HALF, 3)).toBe(
      1,
    );
  });

  it('shortens the offset when the endpoint would punch through a wall', () => {
    // Avatar at +Z=30, offset 20 in +Z. Endpoint at z=50, but cube
    // limit is 37 → ratio = (37-30)/20 = 0.35.
    const ratio = computeCameraCollisionRatio(
      new Vector3(0, 0, 30),
      new Vector3(0, 0, 20),
      HALF,
      3,
    );
    expect(ratio).toBeCloseTo(7 / 20, 6);
  });

  it('picks the closer wall when the offset would hit multiple', () => {
    // Avatar at (30, 30, 0), offset (20, 20, 0). +X wall at t=7/20=0.35,
    // +Y wall same. Either wall gives 0.35 — pick the smaller-or-equal.
    const ratio = computeCameraCollisionRatio(
      new Vector3(30, 30, 0),
      new Vector3(20, 20, 0),
      HALF,
      3,
    );
    expect(ratio).toBeCloseTo(7 / 20, 6);
  });

  it('treats sub-1e-6 axis components as not contributing (no false intersections)', () => {
    // Offset is essentially +X with a tiny Y wobble that could spuriously
    // produce a "Y-wall" intersection; the helper should skip Y.
    const ratio = computeCameraCollisionRatio(
      new Vector3(0, 39, 0),
      new Vector3(20, 1e-9, 0),
      HALF,
      3,
    );
    // No Y collision considered — only X drives. avatar X=0, offset
    // 20 in X. X wall at 37. ratio = 37/20 = 1.85 → clamped to 1.
    expect(ratio).toBe(1);
  });
});

describe('computeWalkLeanTarget', () => {
  const idle = { w: false, a: false, s: false, d: false } as const;
  const LEAN_MAX = (20 * Math.PI) / 180; // matches CursorAvatar.tsx

  it('returns 0 when no forward input is active', () => {
    expect(computeWalkLeanTarget(idle, 0, LEAN_MAX)).toBe(0);
  });

  it('W alone tilts forward by the full lean budget', () => {
    expect(computeWalkLeanTarget({ ...idle, w: true }, 0, LEAN_MAX)).toBeCloseTo(LEAN_MAX, 10);
  });

  it('S alone tilts backward by the full lean budget (negative)', () => {
    expect(computeWalkLeanTarget({ ...idle, s: true }, 0, LEAN_MAX)).toBeCloseTo(-LEAN_MAX, 10);
  });

  it('A and D do not contribute to the forward lean', () => {
    expect(computeWalkLeanTarget({ ...idle, a: true }, 0, LEAN_MAX)).toBe(0);
    expect(computeWalkLeanTarget({ ...idle, d: true }, 0, LEAN_MAX)).toBe(0);
  });

  it('partial touch throttle scales linearly inside the [-1, 1] window', () => {
    expect(computeWalkLeanTarget(idle, 0.5, LEAN_MAX)).toBeCloseTo(0.5 * LEAN_MAX, 10);
    expect(computeWalkLeanTarget(idle, -0.25, LEAN_MAX)).toBeCloseTo(-0.25 * LEAN_MAX, 10);
  });

  it('W + full forward touch clamps at the lean budget (no extra tilt)', () => {
    // The clamp is the load-bearing detail: pushing harder than 1
    // forward unit must NOT tilt the avatar past the visual budget.
    expect(computeWalkLeanTarget({ ...idle, w: true }, 1, LEAN_MAX)).toBeCloseTo(LEAN_MAX, 10);
  });

  it('S + full backward touch clamps at -lean budget', () => {
    expect(computeWalkLeanTarget({ ...idle, s: true }, -1, LEAN_MAX)).toBeCloseTo(-LEAN_MAX, 10);
  });

  it('W + S cancel out (both true → zero forward input → zero lean)', () => {
    expect(computeWalkLeanTarget({ ...idle, w: true, s: true }, 0, LEAN_MAX)).toBe(0);
  });

  it('passing leanMaxRad=0 silences the lean for any input', () => {
    expect(computeWalkLeanTarget({ ...idle, w: true }, 1, 0)).toBe(0);
  });
});
