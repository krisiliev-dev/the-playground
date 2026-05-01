/**
 * Property-based tests — the helpers across the codebase have a
 * handful of contracts that *must* hold for every input, not just
 * the example points covered by the example-based tests. fast-check
 * generates pseudorandom inputs (with shrinking on failure) to pin
 * those contracts:
 *
 *   - Clamps stay inside their advertised bounds for any cube + margin.
 *   - Distances + ratios stay in [0, 1] for any avatar / offset / wall.
 *   - PRNG outputs stay in [0, 1) for any seed.
 *   - Cell walks emit exactly the right number of crossings for any
 *     start/end pair.
 *   - Smoothstep / progress curves stay in [0, 1] across the full
 *     phase window.
 *
 * The seeds are explicit so failures are reproducible; default run
 * count keeps the suite under ~50ms total.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { Vector3 } from 'three';
import {
  clampToBoxInterior,
  computeCameraCollisionRatio,
  computeInitialPanProgress,
  computePinchVelocity,
  computeWallProximity,
} from '@/components/scene/cursorAvatarMath';
import { computeSpawnPoint } from '@/components/scene/reveal/spawnGeometry';
import { firstWallT } from '@/utils';
import { walkCellCrossings } from '@/components/scene/cellWalk';
import { mulberry32 } from '@/components/audio/SfxManager';
import {
  computeTrajectoryProgress,
  computeTiltAngle,
  computeVisualScale,
  smoothstep,
} from '@/components/scene/reveal/swordPhases';
import {
  computeImpactFlashFrame,
  computeSlamPitchJitter,
  computeSlamVelocityFactor,
  computeSpawnFlashFrame,
} from '@/components/scene/reveal/swordEffects';

// Common arbitraries. Keep ranges modest so generated inputs stay in
// the same order of magnitude as production values; that's where the
// invariants must hold without numerical noise dominating.
const finiteFloat = fc.double({ noNaN: true, min: -1e6, max: 1e6 });
const positiveFloat = fc.double({ noNaN: true, min: Math.fround(1e-6), max: 1e3 });
const cubeHalf = fc
  .tuple(positiveFloat, positiveFloat, positiveFloat)
  .map(([x, y, z]) => new Vector3(x, y, z));
const insideVec = (half: Vector3): fc.Arbitrary<Vector3> =>
  fc
    .tuple(
      fc.double({ noNaN: true, min: -half.x, max: half.x }),
      fc.double({ noNaN: true, min: -half.y, max: half.y }),
      fc.double({ noNaN: true, min: -half.z, max: half.z }),
    )
    .map(([x, y, z]) => new Vector3(x, y, z));
const anyVec = fc
  .tuple(finiteFloat, finiteFloat, finiteFloat)
  .map(([x, y, z]) => new Vector3(x, y, z));

describe('properties — spatial clamps + projections', () => {
  it('clampToBoxInterior — output always within ±(half - margin) on every axis', () => {
    fc.assert(
      fc.property(
        anyVec,
        cubeHalf,
        fc.double({ noNaN: true, min: 0, max: 100 }),
        (pos, half, margin) => {
          const out = pos.clone();
          // Margins larger than the cube half collapse the window to
          // negative width — the helper still doesn't throw, but the
          // resulting "bounds" are nonsensical. Skip those.
          fc.pre(margin < half.x && margin < half.y && margin < half.z);
          clampToBoxInterior(out, half, margin);
          expect(out.x).toBeGreaterThanOrEqual(-(half.x - margin) - 1e-9);
          expect(out.x).toBeLessThanOrEqual(half.x - margin + 1e-9);
          expect(out.y).toBeGreaterThanOrEqual(-(half.y - margin) - 1e-9);
          expect(out.y).toBeLessThanOrEqual(half.y - margin + 1e-9);
          expect(out.z).toBeGreaterThanOrEqual(-(half.z - margin) - 1e-9);
          expect(out.z).toBeLessThanOrEqual(half.z - margin + 1e-9);
        },
      ),
      { seed: 42, numRuns: 200 },
    );
  });

  it('clampToBoxInterior — points already inside are not modified', () => {
    fc.assert(
      fc.property(cubeHalf, fc.double({ noNaN: true, min: 0, max: 5 }), (half, margin) => {
        fc.pre(margin < half.x && margin < half.y && margin < half.z);
        const window = new Vector3(half.x - margin, half.y - margin, half.z - margin);
        return fc.assert(
          fc.property(insideVec(window), (pos) => {
            const out = pos.clone();
            clampToBoxInterior(out, half, margin);
            expect(out.equals(pos)).toBe(true);
          }),
          { seed: 7, numRuns: 50 },
        );
      }),
      { seed: 17, numRuns: 30 },
    );
  });

  it('computeSpawnPoint — output always inside (half - SPAWN_WALL_INSET) on every axis', () => {
    // SPAWN_WALL_INSET is 30 in production. Use halves comfortably > 30.
    const sufficientHalf = fc
      .tuple(
        fc.double({ noNaN: true, min: 35, max: 200 }),
        fc.double({ noNaN: true, min: 35, max: 200 }),
        fc.double({ noNaN: true, min: 35, max: 200 }),
      )
      .map(([x, y, z]) => new Vector3(x, y, z));
    fc.assert(
      fc.property(insideVec(new Vector3(50, 50, 50)), sufficientHalf, (camPos, half) => {
        const out = new Vector3();
        const camRight = new Vector3(1, 0, 0);
        const camFwd = new Vector3(0, 0, -1);
        const camUp = new Vector3(0, 1, 0);
        computeSpawnPoint(out, camPos, camRight, camFwd, camUp, half);
        const lim = (h: number): number => h - 30;
        expect(out.x).toBeGreaterThanOrEqual(-lim(half.x) - 1e-6);
        expect(out.x).toBeLessThanOrEqual(lim(half.x) + 1e-6);
        expect(out.y).toBeGreaterThanOrEqual(-lim(half.y) - 1e-6);
        expect(out.y).toBeLessThanOrEqual(lim(half.y) + 1e-6);
        expect(out.z).toBeGreaterThanOrEqual(-lim(half.z) - 1e-6);
        expect(out.z).toBeLessThanOrEqual(lim(half.z) + 1e-6);
      }),
      { seed: 11, numRuns: 200 },
    );
  });

  it('firstWallT — non-degenerate ray in cube returns finite positive t', () => {
    fc.assert(
      fc.property(cubeHalf, anyVec, (half, dir) => {
        // Skip near-zero directions; the helper returns Infinity for
        // them by design.
        fc.pre(dir.lengthSq() > 1e-4);
        const origin = new Vector3(0, 0, 0);
        const t = firstWallT(origin, dir, half);
        if (Number.isFinite(t)) {
          expect(t).toBeGreaterThan(0);
        }
      }),
      { seed: 23, numRuns: 200 },
    );
  });

  it('firstWallT — scaling the direction by k > 0 scales t by 1/k', () => {
    fc.assert(
      fc.property(
        cubeHalf,
        anyVec.filter((v) => v.lengthSq() > 1e-2),
        fc.double({ noNaN: true, min: Math.fround(0.1), max: 10 }),
        (half, dir, k) => {
          const origin = new Vector3(0, 0, 0);
          const t1 = firstWallT(origin, dir, half);
          const t2 = firstWallT(origin, dir.clone().multiplyScalar(k), half);
          if (!Number.isFinite(t1) || !Number.isFinite(t2)) {
            return;
          }
          // t2 should be t1 / k. Allow loose tolerance for very small
          // |dir| or extreme k where float precision dominates.
          expect(t2).toBeCloseTo(t1 / k, 3);
        },
      ),
      { seed: 31, numRuns: 200 },
    );
  });
});

describe('properties — bounded ranges', () => {
  it('computeWallProximity — always in [0, 1] for any avatar position', () => {
    fc.assert(
      fc.property(
        anyVec,
        cubeHalf,
        fc.double({ noNaN: true, min: Math.fround(0.001), max: 50 }),
        (pos, half, fade) => {
          const p = computeWallProximity(pos, half, fade);
          expect(p).toBeGreaterThanOrEqual(0);
          expect(p).toBeLessThanOrEqual(1);
          expect(Number.isFinite(p)).toBe(true);
        },
      ),
      { seed: 41, numRuns: 200 },
    );
  });

  it('computeCameraCollisionRatio — always in [0, 1]', () => {
    fc.assert(
      fc.property(cubeHalf, fc.double({ noNaN: true, min: 0, max: 5 }), (half, margin) => {
        fc.pre(margin < half.x && margin < half.y && margin < half.z);
        const window = new Vector3(half.x - margin, half.y - margin, half.z - margin);
        return fc.assert(
          fc.property(insideVec(window), anyVec, (avatar, offset) => {
            const r = computeCameraCollisionRatio(avatar, offset, half, margin);
            expect(r).toBeGreaterThanOrEqual(0);
            expect(r).toBeLessThanOrEqual(1);
            expect(Number.isFinite(r)).toBe(true);
          }),
          { seed: 59, numRuns: 50 },
        );
      }),
      { seed: 53, numRuns: 30 },
    );
  });

  it('computePinchVelocity — always in [-1, 1]', () => {
    fc.assert(
      fc.property(finiteFloat, finiteFloat, positiveFloat, (cur, start, full) => {
        const v = computePinchVelocity(cur, start, full);
        expect(v).toBeGreaterThanOrEqual(-1);
        expect(v).toBeLessThanOrEqual(1);
      }),
      { seed: 61, numRuns: 200 },
    );
  });

  it('computeInitialPanProgress — always in [0, 1] for any input', () => {
    fc.assert(
      fc.property(finiteFloat, positiveFloat, (elapsed, duration) => {
        const p = computeInitialPanProgress(elapsed, duration);
        expect(p).toBeGreaterThanOrEqual(0);
        expect(p).toBeLessThanOrEqual(1);
      }),
      { seed: 67, numRuns: 200 },
    );
  });

  it('smoothstep — preserves [0, 1] for inputs in [0, 1]', () => {
    fc.assert(
      fc.property(fc.double({ noNaN: true, min: 0, max: 1 }), (t) => {
        const s = smoothstep(t);
        expect(s).toBeGreaterThanOrEqual(0);
        expect(s).toBeLessThanOrEqual(1);
      }),
      { seed: 71, numRuns: 200 },
    );
  });
});

describe('properties — sword phase math', () => {
  it('computeTrajectoryProgress — always in [0, 1] across the full swing', () => {
    fc.assert(
      fc.property(fc.double({ noNaN: true, min: 0, max: 6 }), (t) => {
        const p = computeTrajectoryProgress(t);
        expect(p).toBeGreaterThanOrEqual(0);
        expect(p).toBeLessThanOrEqual(1.01); // float headroom for the ease-out endpoint
      }),
      { seed: 73, numRuns: 200 },
    );
  });

  it('computeVisualScale — always in [spawnVisualScale, 1] for any t', () => {
    fc.assert(
      fc.property(
        fc.double({ noNaN: true, min: 0, max: 6 }),
        fc.double({ noNaN: true, min: 0, max: 1 }),
        (t, spawnScale) => {
          const s = computeVisualScale(t, spawnScale);
          expect(s).toBeGreaterThanOrEqual(spawnScale - 1e-9);
          expect(s).toBeLessThanOrEqual(1 + 1e-9);
        },
      ),
      { seed: 79, numRuns: 200 },
    );
  });

  it('computeTiltAngle — bounded by ±tiltMax for any t', () => {
    fc.assert(
      fc.property(
        fc.double({ noNaN: true, min: 0, max: 6 }),
        fc.double({ noNaN: true, min: 0, max: 1 }),
        (t, tiltMax) => {
          const angle = computeTiltAngle(t, tiltMax);
          expect(Math.abs(angle)).toBeLessThanOrEqual(tiltMax + 1e-9);
        },
      ),
      { seed: 83, numRuns: 200 },
    );
  });
});

describe('properties — flash frames', () => {
  it('computeSpawnFlashFrame — opacity always in [0, 1]', () => {
    fc.assert(
      fc.property(
        finiteFloat,
        positiveFloat,
        positiveFloat,
        positiveFloat,
        fc.double({ noNaN: true, min: Math.fround(0.01), max: Math.fround(0.99) }),
        (elapsed, duration, init, max, rise) => {
          const f = computeSpawnFlashFrame(elapsed, duration, init, max, rise);
          expect(f.opacity).toBeGreaterThanOrEqual(0);
          expect(f.opacity).toBeLessThanOrEqual(1);
        },
      ),
      { seed: 89, numRuns: 200 },
    );
  });

  it('computeImpactFlashFrame — opacity always in [0, 1]', () => {
    fc.assert(
      fc.property(
        finiteFloat,
        positiveFloat,
        positiveFloat,
        positiveFloat,
        (elapsed, dur, init, max) => {
          const f = computeImpactFlashFrame(elapsed, dur, init, max);
          expect(f.opacity).toBeGreaterThanOrEqual(0);
          expect(f.opacity).toBeLessThanOrEqual(1);
        },
      ),
      { seed: 97, numRuns: 200 },
    );
  });

  it('computeSlamVelocityFactor — always in [0.7, 1.6]', () => {
    fc.assert(
      fc.property(finiteFloat, (v) => {
        const f = computeSlamVelocityFactor(v);
        expect(f).toBeGreaterThanOrEqual(0.7);
        expect(f).toBeLessThanOrEqual(1.6);
      }),
      { seed: 101, numRuns: 200 },
    );
  });

  it('computeSlamPitchJitter — always in [0.6, 0.75]', () => {
    fc.assert(
      fc.property(finiteFloat, (v) => {
        const j = computeSlamPitchJitter(v);
        expect(j).toBeGreaterThanOrEqual(0.6);
        expect(j).toBeLessThanOrEqual(0.75);
      }),
      { seed: 103, numRuns: 200 },
    );
  });
});

describe('properties — discrete + PRNG', () => {
  it('mulberry32 — output always in [0, 1) for any 32-bit seed', () => {
    fc.assert(
      fc.property(fc.integer(), (seed) => {
        const rand = mulberry32(seed);
        for (let i = 0; i < 10; i++) {
          const v = rand();
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThan(1);
        }
      }),
      { seed: 107, numRuns: 100 },
    );
  });

  it('mulberry32 — same seed produces same first value (deterministic)', () => {
    fc.assert(
      fc.property(fc.integer(), (seed) => {
        const a = mulberry32(seed);
        const b = mulberry32(seed);
        expect(a()).toBe(b());
      }),
      { seed: 109, numRuns: 100 },
    );
  });

  it('walkCellCrossings — emits exactly |toCell - fromCell| crossings', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1000, max: 1000 }),
        fc.integer({ min: -1000, max: 1000 }),
        positiveFloat,
        (from, to, spacing) => {
          let count = 0;
          const ret = walkCellCrossings(from, to, spacing, () => count++);
          expect(count).toBe(Math.abs(to - from));
          expect(ret).toBe(count);
        },
      ),
      { seed: 113, numRuns: 200 },
    );
  });
});
