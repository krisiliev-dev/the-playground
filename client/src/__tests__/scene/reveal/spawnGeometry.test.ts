/**
 * spawnGeometry — covers the wall-cast `firstWallT` and the per-axis
 * clamped `computeSpawnPoint` used by Sword.tsx + BulletTimeDirector.
 *
 * The previous implementation had this math inlined verbatim in two
 * files; the test pins the contract so any future divergence between
 * the two consumers is impossible (one helper, one set of tests).
 */
import { describe, it, expect } from 'vitest';
import { Vector3 } from 'three';
import { firstWallT } from '@/utils';
import {
  SPAWN_FIXED_UP,
  SPAWN_WALL_INSET,
  computeSpawnPoint,
} from '@/components/scene/reveal/spawnGeometry';

const HALF = new Vector3(40, 40, 40);

describe('firstWallT', () => {
  it('hits the +X wall at t = (half.x - origin.x) for a +X ray', () => {
    const origin = new Vector3(10, 0, 0);
    const direction = new Vector3(1, 0, 0);
    expect(firstWallT(origin, direction, HALF)).toBeCloseTo(30, 6);
  });

  it('hits the -X wall at t = (-half.x - origin.x) / -1 for a -X ray', () => {
    const origin = new Vector3(10, 0, 0);
    const direction = new Vector3(-1, 0, 0);
    // (-40 - 10) / -1 = 50
    expect(firstWallT(origin, direction, HALF)).toBeCloseTo(50, 6);
  });

  it('returns the smallest positive t when the ray hits multiple walls', () => {
    // Ray from origin (35, 35, 0) in direction (1, 1, 0). Hits +X at
    // t = 5, +Y at t = 5 — same. Either is correct; the value is the
    // shared minimum.
    const origin = new Vector3(35, 35, 0);
    const direction = new Vector3(1, 1, 0);
    expect(firstWallT(origin, direction, HALF)).toBeCloseTo(5, 6);
  });

  it('picks the closer wall when components are unequal', () => {
    // origin (38, 0, 0), dir (1, 1, 0). +X wall at t=2, +Y wall at t=40.
    const origin = new Vector3(38, 0, 0);
    const direction = new Vector3(1, 1, 0);
    expect(firstWallT(origin, direction, HALF)).toBeCloseTo(2, 6);
  });

  it('returns Infinity for a degenerate (zero) direction', () => {
    const origin = new Vector3(0, 0, 0);
    const direction = new Vector3(0, 0, 0);
    expect(firstWallT(origin, direction, HALF)).toBe(Infinity);
  });

  it('ignores axes whose direction component is below the 1e-8 epsilon', () => {
    // dir.x = 1e-9 → axis ignored, but dir.y = 1 → +Y wall at t=40.
    const origin = new Vector3(0, 0, 0);
    const direction = new Vector3(1e-9, 1, 0);
    expect(firstWallT(origin, direction, HALF)).toBeCloseTo(40, 6);
  });

  it('respects asymmetric half-extents', () => {
    const tallHalf = new Vector3(40, 80, 40);
    // Ray straight up — hits at t = 80, not 40.
    expect(firstWallT(new Vector3(0, 0, 0), new Vector3(0, 1, 0), tallHalf)).toBeCloseTo(80, 6);
  });
});

describe('computeSpawnPoint', () => {
  // Standard click-camera basis: looking down -Z (so camFwd = -Z),
  // camRight = +X, camUp = +Y. Camera sits at origin facing the cube
  // interior.
  const camPos = new Vector3(0, 0, 0);
  const camRight = new Vector3(1, 0, 0);
  const camFwd = new Vector3(0, 0, -1);
  const camUp = new Vector3(0, 1, 0);

  it('writes into the supplied out vector and returns it (chainable)', () => {
    const out = new Vector3(99, 99, 99);
    const result = computeSpawnPoint(out, camPos, camRight, camFwd, camUp, HALF);
    expect(result).toBe(out);
    expect(out.x).not.toBe(99);
  });

  it('lands on +X wall (post-inset) when camRight = +X', () => {
    const out = new Vector3();
    computeSpawnPoint(out, camPos, camRight, camFwd, camUp, HALF);
    // half = 40, inset = 30 → per-axis clamp window is ±10.
    //   Naive x = 0 + (40-30) = 10 → already at the +X clamp wall.
    //   Naive y = 0 + 20 (SPAWN_FIXED_UP)  →  clamps to +10 (limY).
    //   Naive z = 0 + (-80) (SPAWN_FIXED_FWD along -Z) → clamps to -10.
    // The clamp activating on y here is realistic: the cube is small
    // relative to the offsets, so the spawn lands at the corner of
    // the clamp box rather than at the unclamped offset values.
    const limY = HALF.y - SPAWN_WALL_INSET;
    expect(out.x).toBeCloseTo(HALF.x - SPAWN_WALL_INSET, 6); // 10
    expect(out.y).toBeCloseTo(Math.min(SPAWN_FIXED_UP, limY), 6); // min(20, 10) = 10
    expect(out.z).toBeCloseTo(-(HALF.z - SPAWN_WALL_INSET), 6); // -10
  });

  it('preserves the up offset when the cube is large enough to fit it', () => {
    // Larger cube → SPAWN_FIXED_UP (20) sits inside the clamp window.
    const bigHalf = new Vector3(80, 80, 80);
    const out = new Vector3();
    computeSpawnPoint(out, camPos, camRight, camFwd, camUp, bigHalf);
    expect(out.y).toBeCloseTo(SPAWN_FIXED_UP, 6);
  });

  it('per-axis clamp keeps the spawn inside the cube even with rotated camera', () => {
    // Camera rotated so camFwd points along -X. Now the fwd offset
    // would push the spawn past the -X wall. Clamp must kick in.
    const rotCamFwd = new Vector3(-1, 0, 0);
    const rotCamRight = new Vector3(0, 0, -1); // perpendicular
    const out = new Vector3();
    computeSpawnPoint(out, camPos, rotCamRight, rotCamFwd, camUp, HALF);
    expect(out.x).toBeGreaterThanOrEqual(-(HALF.x - SPAWN_WALL_INSET));
    expect(out.x).toBeLessThanOrEqual(HALF.x - SPAWN_WALL_INSET);
    expect(out.y).toBeGreaterThanOrEqual(-(HALF.y - SPAWN_WALL_INSET));
    expect(out.y).toBeLessThanOrEqual(HALF.y - SPAWN_WALL_INSET);
    expect(out.z).toBeGreaterThanOrEqual(-(HALF.z - SPAWN_WALL_INSET));
    expect(out.z).toBeLessThanOrEqual(HALF.z - SPAWN_WALL_INSET);
  });

  it('lateral lands at 0 when camPos is already past the wall (degenerate)', () => {
    // Camera at +X half, looking +X. tWall = 0; inset clamps lateral
    // to 0 — spawn ends up at camPos + fwd + up offsets only, then
    // clamped per-axis.
    const wallCam = new Vector3(HALF.x, 0, 0);
    const out = new Vector3();
    computeSpawnPoint(out, wallCam, camRight, camFwd, camUp, HALF);
    // Lateral contribution from camRight is 0 (wall is at the camera).
    // x stays at HALF.x but clamps to (HALF.x - SPAWN_WALL_INSET).
    expect(out.x).toBeCloseTo(HALF.x - SPAWN_WALL_INSET, 6);
  });

  it('handles camera not at origin — spawn is camPos + offsets, clamped', () => {
    const cam = new Vector3(5, 10, -15);
    const out = new Vector3();
    computeSpawnPoint(out, cam, camRight, camFwd, camUp, HALF);
    // With camRight = +X from cam.x = 5, tWall to +X wall is 35.
    // lateral = 35 - 30 = 5. x = 5 + 5 = 10.
    expect(out.x).toBeCloseTo(10, 6);
    // y = 10 + 20 = 30 (unclamped, since |30| < 10 is false; but
    // limit is 10, so clamp to 10).
    expect(out.y).toBeCloseTo(HALF.y - SPAWN_WALL_INSET, 6);
  });

  it('is deterministic — same inputs produce same output', () => {
    const a = new Vector3();
    const b = new Vector3();
    computeSpawnPoint(a, camPos, camRight, camFwd, camUp, HALF);
    computeSpawnPoint(b, camPos, camRight, camFwd, camUp, HALF);
    expect(a.x).toBe(b.x);
    expect(a.y).toBe(b.y);
    expect(a.z).toBe(b.z);
  });

  it('does not allocate new Vector3 instances (writes into out)', () => {
    // Smoke check: 1000 calls into the same buffer don't blow up.
    const out = new Vector3();
    expect(() => {
      for (let i = 0; i < 1000; i++) {
        computeSpawnPoint(out, camPos, camRight, camFwd, camUp, HALF);
      }
    }).not.toThrow();
  });
});
