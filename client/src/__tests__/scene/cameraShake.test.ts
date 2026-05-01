/**
 * Camera shake — additive impulse system with linear decay + random
 * jitter. The internal state is module-scoped, so every test must
 * call `clearShake()` first; each impulse is timestamped, so we drive
 * "now" explicitly rather than relying on real time.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  triggerImpactShake,
  computeShakeOffset,
  clearShake,
} from '@/components/scene/cameraShake';

describe('cameraShake', () => {
  beforeEach(() => {
    clearShake();
  });

  it('returns [0, 0, 0] when no impulses have been triggered', () => {
    expect(computeShakeOffset(0)).toEqual([0, 0, 0]);
  });

  it('produces a non-zero X/Y offset shortly after an impulse', () => {
    triggerImpactShake(0);
    const [x, y, z] = computeShakeOffset(0.05);
    // Z is hard-coded to zero (shake is screen-plane only).
    expect(z).toBe(0);
    // X/Y are random jitter; sum-of-abs should exceed zero with high
    // probability (1 in 2^31 to land at exactly 0).
    expect(Math.abs(x) + Math.abs(y)).toBeGreaterThan(0);
  });

  it('has decayed to (effectively) zero by the end of SHAKE_DURATION', () => {
    triggerImpactShake(0);
    // Sample at exactly the boundary (0.18s) — intensity term is 0
    // there, so the offset must be exactly [0, 0, 0].
    expect(computeShakeOffset(0.18)).toEqual([0, 0, 0]);
  });

  it('Z component is always 0', () => {
    triggerImpactShake(0);
    for (let i = 0; i < 50; i++) {
      const [, , z] = computeShakeOffset(0.05);
      expect(z).toBe(0);
    }
  });

  it('caps total intensity at SHAKE_MAX_INTENSITY across many impulses', () => {
    // Trigger 20 impulses simultaneously — without the cap the offset
    // would scale linearly to 20×, blowing out the frame.
    for (let i = 0; i < 20; i++) {
      triggerImpactShake(0);
    }
    // mag = 0.45 * intensity, intensity capped at 1.5 → mag ≤ 0.675
    // Each axis offset ∈ [-mag, +mag], so |x|, |y| ≤ 0.675.
    let maxObservedAbs = 0;
    for (let i = 0; i < 200; i++) {
      const [x, y] = computeShakeOffset(0);
      maxObservedAbs = Math.max(maxObservedAbs, Math.abs(x), Math.abs(y));
    }
    // Allow tiny float slack.
    expect(maxObservedAbs).toBeLessThanOrEqual(0.68);
  });

  it('clearShake removes all impulses', () => {
    triggerImpactShake(0);
    triggerImpactShake(0.05);
    clearShake();
    expect(computeShakeOffset(0.06)).toEqual([0, 0, 0]);
  });

  it('drops impulses older than SHAKE_DURATION when adding new ones', () => {
    triggerImpactShake(0);
    // The next trigger is past the first impulse's window — the
    // bounded-array cleanup inside triggerImpactShake should drop the
    // first one.
    triggerImpactShake(1.0);
    // At t=1.05, only the second impulse contributes; if the first
    // had stuck around, it would still be in the array but wouldn't
    // contribute (elapsed > SHAKE_DURATION). So this is more of a
    // smoke test that the second impulse alone produces output.
    const [x, y] = computeShakeOffset(1.05);
    expect(Math.abs(x) + Math.abs(y)).toBeGreaterThan(0);
  });

  it('returns zero when all impulses are outside their decay window', () => {
    triggerImpactShake(0);
    expect(computeShakeOffset(10)).toEqual([0, 0, 0]);
  });
});
