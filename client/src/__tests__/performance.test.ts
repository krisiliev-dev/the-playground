/**
 * Performance budget tests — sanity checks that the hot-path math
 * helpers stay in their expected order of magnitude. The thresholds
 * are deliberately loose (10–20× headroom over realistic timings on
 * a modern laptop) so they pass on slower CI runners but still catch
 * the kind of regression where a helper accidentally goes O(n²) or
 * starts allocating per call.
 *
 * What we measure: total wall time for N iterations of each helper.
 * The helpers are pure, take caller-owned out-vectors, and run on
 * sub-microsecond budgets in production — at 60fps the entire avatar
 * useFrame must complete in 16ms total, so per-helper budgets in the
 * tens-of-microseconds range leave plenty of slack for the rest of
 * the work.
 *
 * If a budget triggers, the FIRST thing to check is whether the test
 * runner is under load (parallel CI step, system swap, etc.). The
 * second is whether the helper changed shape — added an alloc,
 * regressed to a slower algorithm, gained an unintended import side
 * effect.
 */
import { describe, it, expect } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import {
  clampToBoxInterior,
  computeCameraCollisionRatio,
  computeLeanTarget,
  computePinchVelocity,
  computeWalkVector,
  computeWallProximity,
  projectNDCToWorld,
  setYawQuat,
} from '@/components/scene/cursorAvatarMath';
import { computeSpawnPoint } from '@/components/scene/reveal/spawnGeometry';
import { walkCellCrossings } from '@/components/scene/cellWalk';
import {
  computeArmedTarget,
  computeMidTarget,
  computePostTarget,
  computePreTarget,
} from '@/components/scene/reveal/bulletTimeMath';
import {
  computeOrientationPhase,
  computeSpinAngle,
  computeTiltAngle,
  computeTrajectoryProgress,
  computeVisualScale,
} from '@/components/scene/reveal/swordPhases';
import { generateCubeImpulse, mulberry32 } from '@/components/audio/SfxManager';

/** Helper: time `iters` calls to `fn()` and return total wall time
 *  in ms. Uses `performance.now()` for sub-millisecond resolution.
 *  Warm-up pass before the timed pass so V8's tier-0 baseline is up. */
function bench(iters: number, fn: () => void): number {
  // Warm up.
  for (let i = 0; i < Math.min(iters, 100); i++) {
    fn();
  }
  const start = performance.now();
  for (let i = 0; i < iters; i++) {
    fn();
  }
  return performance.now() - start;
}

const HALF = new Vector3(40, 40, 40);
const camPos = new Vector3(0, 0, 0);
const camFwd = new Vector3(0, 0, -1);
const camRight = new Vector3(1, 0, 0);
const camUp = new Vector3(0, 1, 0);

describe('performance budgets — sword phase math', () => {
  it('computeTrajectoryProgress: 100k calls under 100ms', () => {
    const elapsed = bench(100_000, () => {
      computeTrajectoryProgress(2.5);
    });
    expect(elapsed).toBeLessThan(100);
  });

  it('computeOrientationPhase: 100k calls under 100ms', () => {
    const elapsed = bench(100_000, () => {
      computeOrientationPhase(2.5, 0.5);
    });
    expect(elapsed).toBeLessThan(100);
  });

  it('computeTiltAngle + computeSpinAngle + computeVisualScale: 100k each under 100ms', () => {
    const a = bench(100_000, () => {
      computeTiltAngle(2.5, 0.18);
    });
    const b = bench(100_000, () => {
      computeSpinAngle(2.5, 0, 0);
    });
    const c = bench(100_000, () => {
      computeVisualScale(2.5, 1);
    });
    expect(a + b + c).toBeLessThan(300);
  });
});

describe('performance budgets — cursor avatar math', () => {
  it('projectNDCToWorld: 100k calls under 200ms', () => {
    const out = new Vector3();
    const elapsed = bench(100_000, () => {
      projectNDCToWorld(out, camPos, camFwd, camRight, camUp, Math.PI / 3, 16 / 9, 3, 0.2, 0.3);
    });
    expect(elapsed).toBeLessThan(200);
  });

  it('computeWalkVector: 100k calls under 100ms', () => {
    const keys = { w: true, a: false, s: false, d: true };
    const elapsed = bench(100_000, () => {
      computeWalkVector(keys, 0.5, 0.2, 0);
    });
    expect(elapsed).toBeLessThan(100);
  });

  it('clampToBoxInterior: 100k calls under 100ms', () => {
    const pos = new Vector3(50, 50, 50);
    const elapsed = bench(100_000, () => {
      pos.set(50, 50, 50);
      clampToBoxInterior(pos, HALF, 8);
    });
    expect(elapsed).toBeLessThan(100);
  });

  it('computeWallProximity: 100k calls under 50ms', () => {
    const pos = new Vector3(35, 0, 0);
    const elapsed = bench(100_000, () => {
      computeWallProximity(pos, HALF, 12);
    });
    expect(elapsed).toBeLessThan(50);
  });

  it('computeCameraCollisionRatio: 100k calls under 200ms', () => {
    const pos = new Vector3(30, 30, 0);
    const offset = new Vector3(0, 3, 8);
    const elapsed = bench(100_000, () => {
      computeCameraCollisionRatio(pos, offset, HALF, 3);
    });
    expect(elapsed).toBeLessThan(200);
  });

  it('computeLeanTarget: 100k calls under 200ms', () => {
    const out = new Vector3();
    const scratch = new Vector3();
    const hit = new Vector3(7, -3, 4);
    const tip = new Vector3(0.5, 1, -0.2);
    const quat = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 1.0);
    const elapsed = bench(100_000, () => {
      computeLeanTarget(out, hit, tip, quat, 0.03, scratch);
    });
    expect(elapsed).toBeLessThan(200);
  });

  it('setYawQuat: 100k calls under 50ms', () => {
    const q = new Quaternion();
    const elapsed = bench(100_000, () => {
      setYawQuat(q, 0.5);
    });
    expect(elapsed).toBeLessThan(50);
  });

  it('computePinchVelocity: 100k calls under 50ms', () => {
    const elapsed = bench(100_000, () => {
      computePinchVelocity(150, 100, 150);
    });
    expect(elapsed).toBeLessThan(50);
  });
});

describe('performance budgets — reveal sequence helpers', () => {
  it('computeSpawnPoint: 100k calls under 300ms', () => {
    const out = new Vector3();
    const elapsed = bench(100_000, () => {
      computeSpawnPoint(out, camPos, camRight, camFwd, camUp, HALF);
    });
    expect(elapsed).toBeLessThan(300);
  });

  it('computeArmedTarget: 100k calls under 200ms', () => {
    const outPos = new Vector3();
    const outLook = new Vector3();
    const wordCenter = new Vector3(0, 0, -22);
    const spawnPoint = new Vector3(50, 5, -80);
    const elapsed = bench(100_000, () => {
      computeArmedTarget(outPos, outLook, 0.4, camPos, camFwd, camRight, wordCenter, spawnPoint, 1);
    });
    expect(elapsed).toBeLessThan(200);
  });

  it('computePreTarget: 100k calls under 400ms', () => {
    // Most expensive of the camera-target helpers (multiple lerps,
    // chase-point composition, late-pre sideA blend). Bigger budget
    // than the others.
    const outPos = new Vector3();
    const outLook = new Vector3();
    const herd = new Vector3();
    const chase = new Vector3();
    const spawnPoint = new Vector3(50, 5, -80);
    const wordCenter = new Vector3(0, 0, -22);
    const sideA = new Vector3(6, 0, 0);
    const motionDir = new Vector3(0.5, 0.05, -0.85).normalize();
    const sidePerp = new Vector3().copy(motionDir).cross(camUp).normalize().negate();
    const preStartPos = new Vector3(-6, 0, -5);
    const elapsed = bench(100_000, () => {
      computePreTarget(
        outPos,
        outLook,
        herd,
        chase,
        1.5,
        preStartPos,
        spawnPoint,
        wordCenter,
        sideA,
        sidePerp,
        camUp,
        motionDir,
      );
    });
    expect(elapsed).toBeLessThan(400);
  });

  it('computeMidTarget + computePostTarget: 100k each under 200ms total', () => {
    const outPos = new Vector3();
    const outLook = new Vector3();
    const sideA = new Vector3(6, 0, 0);
    const sideB = new Vector3(-6, 0, 0);
    const wordCenter = new Vector3(0, 0, -22);
    const formationCenter = new Vector3(0, 0, -22);
    const a = bench(100_000, () => {
      computeMidTarget(outPos, outLook, 4.0, sideA, sideB, wordCenter);
    });
    const b = bench(100_000, () => {
      computePostTarget(outPos, outLook, 5.0, sideB, camPos, wordCenter, formationCenter);
    });
    expect(a + b).toBeLessThan(200);
  });
});

describe('performance budgets — cell walks and PRNG', () => {
  it('walkCellCrossings: 10k calls of 100-step walks under 200ms', () => {
    const elapsed = bench(10_000, () => {
      walkCellCrossings(0, 100, 1, () => undefined);
    });
    expect(elapsed).toBeLessThan(200);
  });

  it('mulberry32: 1M draws under 200ms', () => {
    const rand = mulberry32(42);
    const elapsed = bench(1_000_000, () => {
      rand();
    });
    expect(elapsed).toBeLessThan(200);
  });
});

describe('performance budgets — IR generation (one-shot allocation)', () => {
  it('generateCubeImpulse(44100, 15): 5 calls under 1500ms', () => {
    // Each call generates 88200 samples × 2 channels with mulberry32-
    // driven loops. Realistic per-session cost; budget includes the
    // GC pressure of returning two fresh Float32Arrays.
    const elapsed = bench(5, () => {
      generateCubeImpulse(44100, 15);
    });
    expect(elapsed).toBeLessThan(1500);
  });
});
