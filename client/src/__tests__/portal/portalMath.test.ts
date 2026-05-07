/**
 * Pure-function tests for the portal math layer. Pins the
 * geometric semantics of:
 *
 *   - `signedDistanceToPortal` and `portalNormal`
 *   - `localPlanePos` / `isInsideRectangle`
 *   - `teleportPose` — including the R₁₈₀_Y flip
 *   - `findCrossedPortal` — sidedness, bounds, pair validation
 *   - `getPaired` — symmetric pairing validation
 *
 * No rendering, no R3F. These tests run in plain vitest with the
 * three.js classes as their only dependency.
 */
import { describe, it, expect } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import {
  bobbedEndpoint,
  findCrossedPortal,
  isInsideRectangle,
  isOnActiveSide,
  localPlanePos,
  planPortalLeap,
  portalNormal,
  signedDistanceToPortal,
  teleportPose,
  virtualCameraPose,
} from '@/components/scene/portal/portalMath';
import { getEndpoint, getPaired, type PortalEndpoint } from '@/content/portals';

/** Two portals on the back wall, paired with each other. The same
 *  shape as the real test config in `portals.ts` — duplicated here
 *  so registry-config changes don't silently break math tests. */
const A: PortalEndpoint = {
  id: 'A',
  pairedWith: 'B',
  position: [-100, 0, -380],
  quaternion: [0, 0, 0, 1],
  size: { width: 60, height: 80 },
  sidedness: 'single',
  rim: { color: '#00ffcc', particleCount: 0 },
};
const B: PortalEndpoint = {
  id: 'B',
  pairedWith: 'A',
  position: [+100, 0, -380],
  quaternion: [0, 0, 0, 1],
  size: { width: 60, height: 80 },
  sidedness: 'single',
  rim: { color: '#ff6ec7', particleCount: 0 },
};
const PAIR: ReadonlyArray<PortalEndpoint> = [A, B];

describe('portalNormal', () => {
  it('returns world +Z for an identity-quaternion endpoint', () => {
    const n = portalNormal(A);
    expect(n.x).toBeCloseTo(0, 6);
    expect(n.y).toBeCloseTo(0, 6);
    expect(n.z).toBeCloseTo(1, 6);
  });

  it('returns world -X for an endpoint rotated 90° around Y', () => {
    const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2);
    const tilted: PortalEndpoint = {
      ...A,
      quaternion: [q.x, q.y, q.z, q.w],
    };
    const n = portalNormal(tilted);
    expect(n.x).toBeCloseTo(1, 6);
    expect(n.y).toBeCloseTo(0, 6);
    expect(n.z).toBeCloseTo(0, 6);
    // Sanity: 90° around Y sends local +Z onto world +X (right-hand rule).
  });
});

describe('signedDistanceToPortal', () => {
  it('is positive on the active side', () => {
    expect(signedDistanceToPortal({ x: -100, y: 0, z: 0 }, A)).toBeGreaterThan(0);
  });

  it('is negative on the inactive side', () => {
    expect(signedDistanceToPortal({ x: -100, y: 0, z: -500 }, A)).toBeLessThan(0);
  });

  it('is zero on the plane', () => {
    expect(signedDistanceToPortal({ x: -100, y: 0, z: -380 }, A)).toBeCloseTo(0, 6);
  });

  it('measures perpendicular distance only (parallel offsets do not count)', () => {
    // Move +50 along the rectangle's X axis without crossing the
    // plane — distance should be unchanged from the on-axis case.
    const onAxis = signedDistanceToPortal({ x: -100, y: 0, z: 100 }, A);
    const offAxis = signedDistanceToPortal({ x: -50, y: 0, z: 100 }, A);
    expect(onAxis).toBeCloseTo(offAxis, 6);
  });
});

describe('isOnActiveSide', () => {
  it('returns true on the active side', () => {
    expect(isOnActiveSide({ x: -100, y: 0, z: 0 }, A)).toBe(true);
  });

  it('returns false on the inactive side', () => {
    expect(isOnActiveSide({ x: -100, y: 0, z: -500 }, A)).toBe(false);
  });

  it('treats exact-on-plane as active (half-open boundary)', () => {
    // The cascade's backside-transparency gate uses this: a camera
    // landing exactly on the plane must NOT briefly skip the
    // through-view as it walks across.
    expect(isOnActiveSide({ x: -100, y: 0, z: -380 }, A)).toBe(true);
  });

  it('flips sign correctly for an endpoint rotated 90° around Y', () => {
    // A 90° Y-rotation sends local +Z onto world +X — so the active
    // side is now +X relative to the endpoint's position.
    const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2);
    const tilted: PortalEndpoint = {
      ...A,
      quaternion: [q.x, q.y, q.z, q.w],
    };
    expect(isOnActiveSide({ x: A.position[0] + 10, y: 0, z: A.position[2] }, tilted)).toBe(true);
    expect(isOnActiveSide({ x: A.position[0] - 10, y: 0, z: A.position[2] }, tilted)).toBe(false);
  });

  it('parallel offsets do not flip the result (perp-distance only)', () => {
    // Move tangentially along the rectangle without crossing the
    // plane → side classification stays the same.
    expect(isOnActiveSide({ x: -50, y: 30, z: 100 }, A)).toBe(true);
    expect(isOnActiveSide({ x: -50, y: 30, z: -500 }, A)).toBe(false);
  });
});

describe('localPlanePos / isInsideRectangle', () => {
  it('maps a centered position to (0, 0) in local plane coords', () => {
    const lp = localPlanePos({ x: -100, y: 0, z: -380 }, A);
    expect(lp.x).toBeCloseTo(0, 6);
    expect(lp.y).toBeCloseTo(0, 6);
  });

  it('inside rectangle: a point inside the 60×80 bounds returns true', () => {
    expect(isInsideRectangle({ x: -100 + 25, y: 30, z: -380 }, A)).toBe(true);
  });

  it('outside rectangle: a point past the width bound returns false', () => {
    expect(isInsideRectangle({ x: -100 + 31, y: 0, z: -380 }, A)).toBe(false);
  });

  it('outside rectangle: a point past the height bound returns false', () => {
    expect(isInsideRectangle({ x: -100, y: 41, z: -380 }, A)).toBe(false);
  });

  it('treats edge points as inside (inclusive)', () => {
    expect(isInsideRectangle({ x: -100 + 30, y: 0, z: -380 }, A)).toBe(true);
    expect(isInsideRectangle({ x: -100, y: 40, z: -380 }, A)).toBe(true);
  });
});

describe('teleportPose — R₁₈₀_Y flip', () => {
  it('a centered crossing through A emerges centered in front of B (active side)', () => {
    // Player just past A's plane, on its inactive side, dead center.
    const pose = teleportPose({ x: -100, y: 0, z: -381 }, 0, A, B);
    // Expected behavior matches Portal-game: the player walks INTO
    // A's active side and emerges IN FRONT of B's active side
    // (walking forward, out of B). Concretely, 1 unit past A's
    // plane on the inactive side (z = -381) maps to 1 unit IN
    // FRONT of B's plane on the active side (z = -379) — the two
    // portal faces are identified front-to-front via the
    // R₁₈₀_Y flip, so "behind A" and "in front of B" are the same
    // place in the connection.
    expect(pose.position.x).toBeCloseTo(100, 6);
    expect(pose.position.y).toBeCloseTo(0, 6);
    expect(pose.position.z).toBeCloseTo(-379, 6);
  });

  it('a player offset right of A emerges offset left of B (front-to-front mirroring)', () => {
    // Player +20 along A's local +X (20 units to the right of A's
    // center), 1 unit past A's plane.
    const pose = teleportPose({ x: -100 + 20, y: 0, z: -381 }, 0, A, B);
    // R₁₈₀_Y negates local x: emerge -20 along B's local +X (20
    // units to the LEFT of B's center). The z flip puts them on
    // B's active side (z = -379), 1 unit in front of B's plane.
    expect(pose.position.x).toBeCloseTo(100 - 20, 6);
    expect(pose.position.y).toBeCloseTo(0, 6);
    expect(pose.position.z).toBeCloseTo(-379, 6);
  });

  it('preserves the y component (the up axis is invariant)', () => {
    const pose = teleportPose({ x: -100, y: 25, z: -381 }, 0, A, B);
    expect(pose.position.y).toBeCloseTo(25, 6);
  });

  it('rotates yaw by 180° when paired portals share orientation', () => {
    // Player walking forward (yaw=0 → facing -Z) into A. After the
    // R₁₈₀_Y flip, they emerge facing +Z (yaw = π) at B.
    const pose = teleportPose({ x: -100, y: 0, z: -381 }, 0, A, B);
    // Normalise yaw to (-π, π] for comparison stability.
    const norm = ((pose.yaw + Math.PI) % (2 * Math.PI)) - Math.PI;
    expect(Math.abs(Math.abs(norm) - Math.PI)).toBeLessThan(1e-4);
  });

  it('round-trips: A→B→A returns the player to the original pose', () => {
    const start = { x: -100 + 15, y: 7, z: -381 };
    const startYaw = 0;
    const afterAtoB = teleportPose(start, startYaw, A, B);
    const afterBtoA = teleportPose(afterAtoB.position, afterAtoB.yaw, B, A);
    expect(afterBtoA.position.x).toBeCloseTo(start.x, 5);
    expect(afterBtoA.position.y).toBeCloseTo(start.y, 5);
    expect(afterBtoA.position.z).toBeCloseTo(start.z, 5);
  });
});

describe('findCrossedPortal', () => {
  it('detects an active-side crossing through A and resolves to B', () => {
    const result = findCrossedPortal(
      { x: -100, y: 0, z: -370 }, // 10 in front of A's plane
      { x: -100, y: 0, z: -390 }, // 10 past A's plane on the inactive side
      PAIR,
    );
    expect(result?.source.id).toBe('A');
    expect(result?.destination.id).toBe('B');
    expect(result?.position.x).toBeCloseTo(100, 5);
  });

  it('does NOT teleport on a single-sided endpoint crossed from the inactive side', () => {
    const result = findCrossedPortal(
      { x: -100, y: 0, z: -390 }, // behind A
      { x: -100, y: 0, z: -370 }, // crossing back to active side
      PAIR,
    );
    expect(result).toBeNull();
  });

  it('does NOT teleport when the crossing point is outside the rectangle', () => {
    const result = findCrossedPortal(
      { x: -100, y: 100, z: -370 }, // 100 above the rectangle's top edge (height/2 = 40)
      { x: -100, y: 100, z: -390 },
      PAIR,
    );
    expect(result).toBeNull();
  });

  it('does NOT teleport when the player stays on one side', () => {
    const result = findCrossedPortal(
      { x: -100, y: 0, z: -370 },
      { x: -100, y: 0, z: -371 }, // both still on active side
      PAIR,
    );
    expect(result).toBeNull();
  });

  it('does teleport from the inactive side when sidedness is double', () => {
    const doubleA = { ...A, sidedness: 'double' as const };
    const doubleB = { ...B, sidedness: 'double' as const };
    const result = findCrossedPortal(
      { x: -100, y: 0, z: -390 },
      { x: -100, y: 0, z: -370 },
      [doubleA, doubleB],
    );
    expect(result?.source.id).toBe('A');
  });
});

describe('getPaired', () => {
  it('returns the partner of a properly paired endpoint', () => {
    expect(getPaired('A', PAIR)?.id).toBe('B');
    expect(getPaired('B', PAIR)?.id).toBe('A');
  });

  it('returns null for an unknown id', () => {
    expect(getPaired('does-not-exist', PAIR)).toBeNull();
  });

  it('resolves chain pairings (A→B→C→A) — reciprocity not required', () => {
    const chain: ReadonlyArray<PortalEndpoint> = [
      A, // pairedWith: 'B'
      { ...B, pairedWith: 'C' },
      { ...A, id: 'C', pairedWith: 'A' },
    ];
    // Each endpoint's `pairedWith` resolves to a real endpoint in the
    // chain — that's the only validity requirement. Reciprocity is
    // not required (the 3-cycle has no reciprocal edges by design).
    expect(getPaired('A', chain)?.id).toBe('B');
    expect(getPaired('B', chain)?.id).toBe('C');
    expect(getPaired('C', chain)?.id).toBe('A');
  });

  it('returns null when pairedWith resolves to nothing', () => {
    const dangling: ReadonlyArray<PortalEndpoint> = [
      { ...A, pairedWith: 'nonexistent' },
    ];
    expect(getPaired('A', dangling)).toBeNull();
  });
});

describe('getEndpoint', () => {
  it('finds an endpoint by id', () => {
    expect(getEndpoint('A', PAIR)?.id).toBe('A');
  });

  it('returns null for unknown ids', () => {
    expect(getEndpoint('does-not-exist', PAIR)).toBeNull();
  });
});

describe('planPortalLeap — click-to-portal target plan', () => {
  // Portal A is single-sided, position (-100, 0, -380), normal +Z
  // (identity quaternion). Active side is z > -380.
  const OVERSHOOT = 8;

  it('returns target one overshoot past the active face when avatar is on active side', () => {
    // Avatar at z = -370 (10 units in front of A's plane, active).
    // Expected target = source.position + normal * (-overshoot)
    //                 = (-100, 0, -380) + (0, 0, 1) * -8
    //                 = (-100, 0, -388) — 8 units past the plane on
    //                 the inactive side.
    const t = planPortalLeap({ x: -100, y: 0, z: -370 }, A, OVERSHOOT);
    expect(t).not.toBeNull();
    expect(t![0]).toBeCloseTo(-100, 6);
    expect(t![1]).toBeCloseTo(0, 6);
    expect(t![2]).toBeCloseTo(-388, 6);
  });

  it('returns null when avatar is on the inactive side of a single-sided portal', () => {
    // Avatar at z = -400 (behind A). A is single-sided, so click
    // from behind must be a no-op — the back face has no through-view.
    expect(planPortalLeap({ x: -100, y: 0, z: -400 }, A, OVERSHOOT)).toBeNull();
  });

  it('treats exact-on-plane as active side (half-open boundary)', () => {
    // Matches the rest of portalMath's convention: zero counts as
    // active. The leap from the plane lands on the inactive side.
    const t = planPortalLeap({ x: -100, y: 0, z: -380 }, A, OVERSHOOT);
    expect(t).not.toBeNull();
    expect(t![2]).toBeCloseTo(-388, 6);
  });

  it('respects overshoot magnitude proportionally', () => {
    const t8 = planPortalLeap({ x: -100, y: 0, z: -370 }, A, 8);
    const t16 = planPortalLeap({ x: -100, y: 0, z: -370 }, A, 16);
    // Doubling overshoot doubles the distance from the plane.
    expect(t16![2]).toBeCloseTo(-396, 6);
    expect(t8![2]).toBeCloseTo(-388, 6);
  });

  it('double-sided + active side: same result as single-sided active', () => {
    const doubleA = { ...A, sidedness: 'double' as const };
    const tSingle = planPortalLeap({ x: -100, y: 0, z: -370 }, A, OVERSHOOT);
    const tDouble = planPortalLeap({ x: -100, y: 0, z: -370 }, doubleA, OVERSHOOT);
    expect(tSingle).toEqual(tDouble);
  });

  it('double-sided + inactive side: target is on active side (sign flips)', () => {
    // Double-sided portal: clicks from behind ARE valid. The leap
    // should send the avatar through the back to emerge on the
    // active side. sign = +1 → target = source + normal * overshoot.
    const doubleA = { ...A, sidedness: 'double' as const };
    const t = planPortalLeap({ x: -100, y: 0, z: -400 }, doubleA, OVERSHOOT);
    expect(t).not.toBeNull();
    // (-100, 0, -380) + (0, 0, 1) * 8 = (-100, 0, -372)
    expect(t![2]).toBeCloseTo(-372, 6);
  });

  it('handles a 90°-rotated portal (active side along world +X)', () => {
    // 90° around Y rotates local +Z into world +X. Active side is
    // now world +X relative to the source.
    const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2);
    const tilted: PortalEndpoint = { ...A, quaternion: [q.x, q.y, q.z, q.w] };
    // Avatar 10 in +X from source = active side.
    const t = planPortalLeap({ x: -90, y: 0, z: -380 }, tilted, OVERSHOOT);
    expect(t).not.toBeNull();
    // target = (-100, 0, -380) + (1, 0, 0) * -8 = (-108, 0, -380)
    expect(t![0]).toBeCloseTo(-108, 6);
    expect(t![1]).toBeCloseTo(0, 6);
    expect(t![2]).toBeCloseTo(-380, 6);
  });

  it('rotated single-sided + inactive side: returns null', () => {
    const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2);
    const tilted: PortalEndpoint = { ...A, quaternion: [q.x, q.y, q.z, q.w] };
    // Avatar -10 in X from source = inactive side of the rotated portal.
    expect(planPortalLeap({ x: -110, y: 0, z: -380 }, tilted, OVERSHOOT)).toBeNull();
  });
});

describe('virtualCameraPose — recursive camera transform', () => {
  // A camera at (-100, 0, -370), 10 units in front of A, looking
  // forward (-Z) with the identity quaternion.
  const CAM_AT_A_FRONT = { x: -100, y: 0, z: -370 };
  const IDENTITY = { x: 0, y: 0, z: 0, w: 1 };

  it('mirrors a centered front-of-A camera to a centered behind-B vCam', () => {
    // Player 10 in front of A's plane (active side) emerges 10 BEHIND
    // B's plane on B's INACTIVE side — the vCam viewpoint that "sees
    // out of B's front face" matches what a camera at (-100, 0, -370)
    // sees of A's front face. Front-to-front identification + the
    // R₁₈₀_Y flip puts the vCam at z = -380 + 10 = -370... wait, let
    // me reason: source.z = -380, cam.z = -370 → local cam z = +10.
    // After flip → -10 in dest local. Dest world z = -380 + (-10) =
    // -390 → 10 BEHIND B's plane (B's inactive side). The vCam
    // "looks out of" the back of B at +Z (i.e. looking back toward A's
    // active side through the world).
    const out = virtualCameraPose(CAM_AT_A_FRONT, IDENTITY, A, B);
    expect(out.position.x).toBeCloseTo(100, 6);
    expect(out.position.y).toBeCloseTo(0, 6);
    expect(out.position.z).toBeCloseTo(-390, 6);
  });

  it('preserves camera Y unchanged (Y-flip identification only)', () => {
    const cam = { x: -100, y: 17, z: -370 };
    const out = virtualCameraPose(cam, IDENTITY, A, B);
    expect(out.position.y).toBeCloseTo(17, 6);
  });

  it('mirrors X-offset across the portal pair', () => {
    // Camera offset +25 along A's local X: in dest frame that becomes
    // -25 (R₁₈₀_Y flips local X). Dest at +100, so emerges at +75.
    const cam = { x: -100 + 25, y: 0, z: -370 };
    const out = virtualCameraPose(cam, IDENTITY, A, B);
    expect(out.position.x).toBeCloseTo(75, 6);
  });

  it('rotates yaw by 180° for paired endpoints sharing orientation', () => {
    // A camera looking at A's front face (yaw=0, facing -Z) maps to a
    // vCam looking at B's back face (facing +Z, yaw = π). This is
    // what makes the recursive through-view's chain math work.
    const out = virtualCameraPose(CAM_AT_A_FRONT, IDENTITY, A, B);
    const q = new Quaternion(
      out.quaternion.x,
      out.quaternion.y,
      out.quaternion.z,
      out.quaternion.w,
    );
    const fwd = new Vector3(0, 0, -1).applyQuaternion(q);
    // After 180° flip, world -Z forward becomes +Z.
    expect(fwd.z).toBeCloseTo(1, 5);
    expect(Math.abs(fwd.x)).toBeLessThan(1e-5);
    expect(Math.abs(fwd.y)).toBeLessThan(1e-5);
  });

  it('preserves camera pitch magnitude through the flip', () => {
    // Camera looking 30° down. The vCam's pitch component (Y-projection
    // of its forward vector) should still be 30° in magnitude — only
    // yaw gets π added by the R₁₈₀_Y flip. Pitch-only quaternion
    // (around local X): (sin(p/2), 0, 0, cos(p/2)).
    const pitch = -Math.PI / 6;
    const halfP = pitch * 0.5;
    const camQuat = { x: Math.sin(halfP), y: 0, z: 0, w: Math.cos(halfP) };

    const out = virtualCameraPose(CAM_AT_A_FRONT, camQuat, A, B);
    const q = new Quaternion(
      out.quaternion.x,
      out.quaternion.y,
      out.quaternion.z,
      out.quaternion.w,
    );
    const fwd = new Vector3(0, 0, -1).applyQuaternion(q);
    expect(Math.abs(fwd.y)).toBeCloseTo(Math.abs(Math.sin(pitch)), 5);
  });

  it('round-trips: A→B→A returns the camera to its original pose', () => {
    // A camera at A→B's vCam pose, mapped from B back to A, should
    // arrive at the original camera pose. This is the load-bearing
    // invariant for paired-portal recursion: depth-2 through depth-0
    // camera composition collapses to identity for a 2-cycle.
    const cam = { x: -100 + 12, y: 8, z: -370 };
    const camQuat = { x: 0, y: 0, z: 0, w: 1 };
    const stepA = virtualCameraPose(cam, camQuat, A, B);
    const stepB = virtualCameraPose(stepA.position, stepA.quaternion, B, A);
    expect(stepB.position.x).toBeCloseTo(cam.x, 4);
    expect(stepB.position.y).toBeCloseTo(cam.y, 4);
    expect(stepB.position.z).toBeCloseTo(cam.z, 4);
  });

  it('does not mutate the source/destination endpoint objects', () => {
    const sourceSnapshot: PortalEndpoint = JSON.parse(JSON.stringify(A)) as PortalEndpoint;
    const destSnapshot: PortalEndpoint = JSON.parse(JSON.stringify(B)) as PortalEndpoint;
    virtualCameraPose(CAM_AT_A_FRONT, IDENTITY, A, B);
    expect(A).toEqual(sourceSnapshot);
    expect(B).toEqual(destSnapshot);
  });
});

describe('virtualCameraPose — same-portal cascade chain', () => {
  // The cascade renderer recurses into the SAME `ps` (not the paired
  // one), composing T_AB with itself: vCam_{N+1} = T_AB(vCam_N).
  // This test pins the chain math that produces the iconic "infinite
  // tunnel" tunnel — every applied step shifts the vCam by (B − A)
  // along the source-to-dest axis, so successive levels are at
  // strictly increasing distance from the cube.
  //
  // Use face-to-face portals on the X axis (mirroring the real test
  // config in `portals.ts`) so the chain step is geometrically clean.
  const SQRT_HALF = Math.SQRT1_2;
  const A_X: PortalEndpoint = {
    id: 'A',
    pairedWith: 'B',
    position: [-150, 0, 0],
    quaternion: [0, SQRT_HALF, 0, SQRT_HALF], // +90° Y → local +Z = world +X
    size: { width: 60, height: 80 },
    sidedness: 'single',
    rim: { color: '#00ffcc', particleCount: 0 },
  };
  const B_X: PortalEndpoint = {
    id: 'B',
    pairedWith: 'A',
    position: [+150, 0, 0],
    quaternion: [0, -SQRT_HALF, 0, SQRT_HALF], // -90° Y → local +Z = world -X
    size: { width: 60, height: 80 },
    sidedness: 'single',
    rim: { color: '#ff6ec7', particleCount: 0 },
  };
  const STEP = B_X.position[0] - A_X.position[0]; // +300 along world X

  it('the first step shifts vCam by (B − A) along the axis', () => {
    // Player at world origin looking world -X (toward A). After T_AB
    // the vCam should sit at world +300 (one step along +X), still
    // facing world -X (since the cube is "to the left" of vCam_0).
    const cam = { x: 0, y: 0, z: 0 };
    // +90° around Y: rotates default forward (-Z) onto world -X.
    const camQuat = { x: 0, y: SQRT_HALF, z: 0, w: SQRT_HALF };
    const out = virtualCameraPose(cam, camQuat, A_X, B_X);
    expect(out.position.x).toBeCloseTo(STEP, 5);
    expect(out.position.y).toBeCloseTo(0, 5);
    expect(out.position.z).toBeCloseTo(0, 5);
  });

  it('iterating T_AB N times accumulates N steps along the axis', () => {
    // Compose T_AB with itself eight times. Each composition adds
    // STEP to the vCam's X coordinate — that's the property that
    // strictly increases distance from the cube at every cascade
    // level (the "perspective-shrinks-the-tunnel" mechanism).
    let pos = { x: 0, y: 0, z: 0 };
    let quat = { x: 0, y: SQRT_HALF, z: 0, w: SQRT_HALF }; // forward = -X
    for (let n = 1; n <= 8; n += 1) {
      const out = virtualCameraPose(pos, quat, A_X, B_X);
      expect(out.position.x).toBeCloseTo(STEP * n, 4);
      expect(out.position.y).toBeCloseTo(0, 4);
      expect(out.position.z).toBeCloseTo(0, 4);
      pos = out.position;
      quat = out.quaternion;
    }
  });

  it('forward direction is preserved across same-portal recursion', () => {
    // Same-`ps` recursion composes T_AB with itself — the chain
    // shouldn't flip direction at every step. Specifically: a camera
    // looking world -X should still look world -X at every level (no
    // 180° alternation as the paired-`ps` version would have produced).
    let pos = { x: 0, y: 0, z: 0 };
    let quat = { x: 0, y: SQRT_HALF, z: 0, w: SQRT_HALF }; // forward = -X
    for (let n = 1; n <= 4; n += 1) {
      const out = virtualCameraPose(pos, quat, A_X, B_X);
      const q = new Quaternion(
        out.quaternion.x,
        out.quaternion.y,
        out.quaternion.z,
        out.quaternion.w,
      );
      const fwd = new Vector3(0, 0, -1).applyQuaternion(q);
      expect(fwd.x).toBeCloseTo(-1, 4);
      expect(Math.abs(fwd.y)).toBeLessThan(1e-4);
      expect(Math.abs(fwd.z)).toBeLessThan(1e-4);
      pos = out.position;
      quat = out.quaternion;
    }
  });
});

describe('bobbedEndpoint', () => {
  const BASE: PortalEndpoint = {
    id: 'A',
    pairedWith: 'B',
    position: [-150, 12, 7],
    quaternion: [0, 0, 0, 1],
    size: { width: 60, height: 80 },
    sidedness: 'single',
    rim: { color: '#00ffcc', particleCount: 0 },
  };

  it('shifts only Y by the given offset', () => {
    const lifted = bobbedEndpoint(BASE, 0.6);
    expect(lifted.position[0]).toBe(-150);
    expect(lifted.position[1]).toBeCloseTo(12.6, 6);
    expect(lifted.position[2]).toBe(7);
  });

  it('returns a fresh endpoint object — input is unchanged', () => {
    const before: PortalEndpoint = JSON.parse(JSON.stringify(BASE)) as PortalEndpoint;
    const lifted = bobbedEndpoint(BASE, 0.6);
    expect(BASE).toEqual(before);
    expect(lifted).not.toBe(BASE);
    expect(lifted.position).not.toBe(BASE.position);
  });

  it('preserves all non-position fields (id, pairedWith, quaternion, size, etc.)', () => {
    const lifted = bobbedEndpoint(BASE, 1.5);
    expect(lifted.id).toBe(BASE.id);
    expect(lifted.pairedWith).toBe(BASE.pairedWith);
    expect(lifted.quaternion).toEqual(BASE.quaternion);
    expect(lifted.size).toEqual(BASE.size);
    expect(lifted.sidedness).toBe(BASE.sidedness);
    expect(lifted.rim).toEqual(BASE.rim);
  });

  it('a zero offset is a no-op (same X, Y, Z)', () => {
    const lifted = bobbedEndpoint(BASE, 0);
    expect(lifted.position).toEqual(BASE.position);
  });

  it('handles negative offsets (cube bobbing downward)', () => {
    const lifted = bobbedEndpoint(BASE, -0.5);
    expect(lifted.position[1]).toBeCloseTo(11.5, 6);
  });
});
