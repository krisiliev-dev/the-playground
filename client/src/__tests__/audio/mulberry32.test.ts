/**
 * mulberry32 — small seeded PRNG used by SfxManager's IR generator
 * (and exported so tests can pin sample sequences). Verifies:
 *   - Range [0, 1).
 *   - Determinism: same seed → same sequence.
 *   - Decorrelation: distinct seeds yield distinct sequences (even
 *     adjacent seeds, since mulberry32 mixes well by design).
 *   - Robustness across 32-bit boundary inputs (negative, > 2^31).
 */
import { describe, it, expect } from 'vitest';
import { mulberry32 } from '@/components/audio/SfxManager';

describe('mulberry32', () => {
  it('returns values in the half-open interval [0, 1)', () => {
    const rand = mulberry32(1234);
    for (let i = 0; i < 1000; i++) {
      const v = rand();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('is deterministic — same seed produces the same sequence', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 100; i++) {
      expect(a()).toBe(b());
    }
  });

  it('decorrelates adjacent seeds — sequences differ from frame 1', () => {
    const a = mulberry32(42);
    const b = mulberry32(43);
    // Mulberry32 is well-mixed: even seeds 42 and 43 should produce
    // different first values. We don't compare beyond a few terms — the
    // contract is "they diverge", not "they share no values ever".
    const aFirst3 = [a(), a(), a()];
    const bFirst3 = [b(), b(), b()];
    expect(aFirst3).not.toEqual(bFirst3);
  });

  it('handles negative + large seeds without throwing or producing NaN', () => {
    for (const seed of [-1, -1234567, 0, 1, 0xffffffff, 1e9]) {
      const rand = mulberry32(seed);
      const v = rand();
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('produces a usable stream — first few values are not all the same constant', () => {
    const rand = mulberry32(123);
    const samples = new Set<number>();
    for (let i = 0; i < 20; i++) {
      samples.add(rand());
    }
    // 20 draws should give 20 distinct values for any reasonable PRNG.
    expect(samples.size).toBe(20);
  });
});
