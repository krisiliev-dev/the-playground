/**
 * Slab-method ray-vs-cube intersection. The math is well-trodden; the
 * tests here pin the *contract* — what direction the normal points,
 * what wall is "first" for a given ray, and edge cases (degenerate
 * rays, rays parallel to a wall). If a sword spawns behind the camera,
 * the bug is almost always in this function or its callers, so the
 * smoke tests catch the easy regressions.
 */
import { describe, it, expect } from 'vitest';
import { Vector3 } from 'three';
import { intersectInsideCube } from '@/utils/cubeRaycast';

describe('intersectInsideCube', () => {
  const half = new Vector3(40, 40, 40);

  it('hits the +X wall with an inward-facing -X normal', () => {
    const hit = intersectInsideCube(new Vector3(0, 0, 0), new Vector3(1, 0, 0), half);
    expect(hit).not.toBeNull();
    expect(hit!.point.x).toBeCloseTo(40);
    expect(hit!.point.y).toBeCloseTo(0);
    expect(hit!.point.z).toBeCloseTo(0);
    // Inward-facing means pointing toward the cube interior, i.e. -X.
    expect(hit!.normal.x).toBe(-1);
    expect(hit!.normal.y).toBe(0);
    expect(hit!.normal.z).toBe(0);
  });

  it('hits the -X wall with an inward-facing +X normal', () => {
    const hit = intersectInsideCube(new Vector3(0, 0, 0), new Vector3(-1, 0, 0), half);
    expect(hit!.point.x).toBeCloseTo(-40);
    expect(hit!.normal.x).toBe(1);
  });

  it('hits the back wall (-Z) for the typical "click straight ahead" ray', () => {
    // Camera at origin looking down -Z, click at screen centre.
    const hit = intersectInsideCube(new Vector3(0, 0, 0), new Vector3(0, 0, -1), half);
    expect(hit!.point.z).toBeCloseTo(-40);
    expect(hit!.normal.z).toBe(1);
  });

  it('returns the nearest wall when the ray hits multiple', () => {
    // Direction (3, 0, -4): Z reaches first because 40/4 < 40/3.
    const hit = intersectInsideCube(
      new Vector3(0, 0, 0),
      new Vector3(3, 0, -4).normalize(),
      half,
    );
    expect(hit).not.toBeNull();
    expect(Math.abs(hit!.point.z)).toBeCloseTo(40);
    // X has not yet reached its wall.
    expect(Math.abs(hit!.point.x)).toBeLessThan(40);
  });

  it('respects asymmetric (non-cube) half-extents', () => {
    const tallHalf = new Vector3(10, 100, 10);
    const hit = intersectInsideCube(new Vector3(0, 0, 0), new Vector3(0, 1, 0), tallHalf);
    expect(hit!.point.y).toBeCloseTo(100);
    expect(hit!.normal.y).toBe(-1);
  });

  it('handles a non-origin start point', () => {
    const hit = intersectInsideCube(new Vector3(20, 0, 0), new Vector3(1, 0, 0), half);
    expect(hit!.point.x).toBeCloseTo(40);
    expect(hit!.normal.x).toBe(-1);
  });

  it('returns null for a degenerate (zero-length) direction', () => {
    expect(
      intersectInsideCube(new Vector3(0, 0, 0), new Vector3(0, 0, 0), half),
    ).toBeNull();
  });

  it('handles a ray exactly parallel to one axis', () => {
    // X-direction only, Y-component zero — the Y-axis branch must skip
    // (avoid div-by-zero) and the X-axis branch must produce the hit.
    const hit = intersectInsideCube(
      new Vector3(0, 30, 0),
      new Vector3(1, 0, 0),
      half,
    );
    expect(hit).not.toBeNull();
    expect(hit!.point.x).toBeCloseTo(40);
    expect(hit!.point.y).toBeCloseTo(30);
  });

  it('hit point lies exactly on the t-length of the ray', () => {
    const origin = new Vector3(5, 7, -3);
    const dir = new Vector3(0.6, 0.0, -0.8); // already normalised
    const hit = intersectInsideCube(origin, dir, half);
    expect(hit).not.toBeNull();
    // Reconstruct: hit.point = origin + dir * t, so t = (hit.point.x - origin.x) / dir.x
    const tx = (hit!.point.x - origin.x) / dir.x;
    const tz = (hit!.point.z - origin.z) / dir.z;
    // Both axes should give the same t (collinearity check).
    expect(tx).toBeCloseTo(tz, 5);
  });

  it('handles half-extent of zero gracefully (degenerate cube)', () => {
    const flatHalf = new Vector3(0, 40, 40);
    // X-axis is degenerate; Y/Z should still work.
    const hit = intersectInsideCube(new Vector3(0, 0, 0), new Vector3(0, 1, 0), flatHalf);
    expect(hit).not.toBeNull();
    expect(hit!.point.y).toBeCloseTo(40);
  });
});
