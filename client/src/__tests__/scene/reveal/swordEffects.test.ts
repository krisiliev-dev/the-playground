/**
 * Sword visual + audio effect math — covers the pure helpers
 * extracted from Sword.tsx's flash sprites + slam audio modulation.
 *
 * The helpers are simple enough that the tests are mostly endpoint +
 * monotonicity checks; the value is in pinning the contracts so a
 * future tuning pass (different rise fraction, different velocity
 * curve) can't accidentally invert the shape of the response.
 */
import { describe, it, expect } from 'vitest';
import {
  computeImpactFlashFrame,
  computeSlamPitchJitter,
  computeSlamVelocityFactor,
  computeSpawnFlashFrame,
  jitterAxis,
} from '@/components/scene/reveal/swordEffects';
import { mulberry32 } from '@/components/audio/SfxManager';

describe('computeSpawnFlashFrame', () => {
  const DUR = 0.35;
  const INITIAL = 8;
  const MAX = 50;
  const RISE = 0.2;

  it('opacity is 0 at elapsed=0 (start of rise — divides 0/RISE = 0)', () => {
    const f = computeSpawnFlashFrame(0, DUR, INITIAL, MAX, RISE);
    expect(f.opacity).toBe(0);
    expect(f.scale).toBeCloseTo(INITIAL, 6);
  });

  it('opacity is 1 at the rise/fall boundary', () => {
    const f = computeSpawnFlashFrame(DUR * RISE, DUR, INITIAL, MAX, RISE);
    expect(f.opacity).toBeCloseTo(1, 6);
  });

  it('opacity decays to 0 at elapsed = duration', () => {
    // Strictly < duration in the helper — sample just below for the
    // limit, exactly at returns the past-end branch (opacity = 0).
    const just = computeSpawnFlashFrame(DUR - 1e-6, DUR, INITIAL, MAX, RISE);
    expect(just.opacity).toBeLessThan(0.001);
    const at = computeSpawnFlashFrame(DUR, DUR, INITIAL, MAX, RISE);
    expect(at.opacity).toBe(0);
  });

  it('scale interpolates linearly from initial → max over the duration', () => {
    const half = computeSpawnFlashFrame(DUR / 2, DUR, INITIAL, MAX, RISE);
    expect(half.scale).toBeCloseTo((INITIAL + MAX) / 2, 6);
  });

  it('past the end, opacity = 0 and scale = max (sprite is invisible)', () => {
    const past = computeSpawnFlashFrame(DUR * 5, DUR, INITIAL, MAX, RISE);
    expect(past.opacity).toBe(0);
    expect(past.scale).toBe(MAX);
  });

  it('negative elapsed (clock skew) clamps to past-end behaviour', () => {
    const neg = computeSpawnFlashFrame(-1, DUR, INITIAL, MAX, RISE);
    expect(neg.opacity).toBe(0);
  });
});

describe('computeImpactFlashFrame', () => {
  const DUR = 0.18;
  const INITIAL = 0.6;
  const MAX = 7;

  it('opacity is 1 at elapsed=0 (hard pop)', () => {
    expect(computeImpactFlashFrame(0, DUR, INITIAL, MAX).opacity).toBe(1);
  });

  it('opacity decays linearly to 0 at duration', () => {
    expect(computeImpactFlashFrame(DUR / 2, DUR, INITIAL, MAX).opacity).toBeCloseTo(0.5, 6);
    expect(computeImpactFlashFrame(DUR - 1e-6, DUR, INITIAL, MAX).opacity).toBeLessThan(0.001);
  });

  it('scale interpolates linearly from initial → max', () => {
    const half = computeImpactFlashFrame(DUR / 2, DUR, INITIAL, MAX);
    expect(half.scale).toBeCloseTo((INITIAL + MAX) / 2, 6);
  });

  it('past the end, opacity = 0', () => {
    expect(computeImpactFlashFrame(DUR * 2, DUR, INITIAL, MAX).opacity).toBe(0);
  });
});

describe('computeSlamVelocityFactor', () => {
  it('returns the floor 0.7 for zero velocity', () => {
    expect(computeSlamVelocityFactor(0)).toBe(0.7);
  });

  it('rises linearly with velocity in the in-band region', () => {
    expect(computeSlamVelocityFactor(40)).toBeCloseTo(0.7 + 40 / 80, 6); // 1.2
    expect(computeSlamVelocityFactor(72)).toBeCloseTo(0.7 + 72 / 80, 6); // 1.6
  });

  it('caps at the ceiling 1.6 for high velocities', () => {
    expect(computeSlamVelocityFactor(200)).toBe(1.6);
    expect(computeSlamVelocityFactor(1e6)).toBe(1.6);
  });

  it('returns floor for negative or non-finite velocities (defensive)', () => {
    expect(computeSlamVelocityFactor(-5)).toBe(0.7);
    expect(computeSlamVelocityFactor(NaN)).toBe(0.7);
    // Infinity isn't `Number.isFinite`, so the helper bails to floor
    // rather than producing Infinity-tainted gain.
    expect(computeSlamVelocityFactor(Infinity)).toBe(0.7);
  });
});

describe('computeSlamPitchJitter', () => {
  it('returns base 0.6 for zero velocity', () => {
    expect(computeSlamPitchJitter(0)).toBe(0.6);
  });

  it('adds velocity bonus capped at +0.15', () => {
    expect(computeSlamPitchJitter(40)).toBeCloseTo(0.6 + 40 / 400, 6); // 0.7
    expect(computeSlamPitchJitter(60)).toBeCloseTo(0.75, 6);
    expect(computeSlamPitchJitter(120)).toBe(0.75); // clamped
    expect(computeSlamPitchJitter(1e6)).toBe(0.75);
  });

  it('returns base 0.6 for negative or non-finite velocities', () => {
    expect(computeSlamPitchJitter(-5)).toBe(0.6);
    expect(computeSlamPitchJitter(NaN)).toBe(0.6);
  });
});

describe('jitterAxis', () => {
  it('returns 0 when rand() returns 0.5 (centre of [0,1))', () => {
    expect(jitterAxis(() => 0.5, 20)).toBe(0);
  });

  it('returns -range/2 at the bottom and +range/2 just below the top of [0,1)', () => {
    expect(jitterAxis(() => 0, 20)).toBe(-10);
    expect(jitterAxis(() => 0.999999, 20)).toBeCloseTo(10, 4);
  });

  it('is deterministic when supplied a seeded PRNG', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 10; i++) {
      expect(jitterAxis(a, 20)).toBe(jitterAxis(b, 20));
    }
  });

  it('scales linearly with range', () => {
    const fixed = (): number => 0.75;
    expect(jitterAxis(fixed, 20)).toBeCloseTo(0.25 * 20, 6); // 5
    expect(jitterAxis(fixed, 100)).toBeCloseTo(0.25 * 100, 6); // 25
  });
});
