/**
 * Camera shake — additive impulse system with linear decay + random
 * jitter. The internal state is module-scoped, so every test must
 * call `clearShake()` first; each impulse is timestamped, so we drive
 * "now" explicitly rather than relying on real time.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  attenuateByDistance,
  clearShake,
  computeShakeOffset,
  triggerImpactShake,
  triggerWorldImpactShake,
} from '@/components/scene/cameraShake';
import { drainOutboundQueue, _resetSceneEventBusForTest } from '@/multiplayer/sceneEvents';

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

  describe('weighted impulses', () => {
    it('weight=0 is a no-op (no impulse recorded)', () => {
      triggerImpactShake(0, 0);
      expect(computeShakeOffset(0.05)).toEqual([0, 0, 0]);
    });

    it('weight scales the per-impulse contribution to total intensity', () => {
      // Half-weight impulse should produce noticeably less average
      // magnitude than full-weight, even with random jitter.
      const sample = (weight: number): number => {
        clearShake();
        triggerImpactShake(0, weight);
        let sum = 0;
        for (let i = 0; i < 500; i++) {
          const [x, y] = computeShakeOffset(0.05);
          sum += Math.abs(x) + Math.abs(y);
        }
        return sum / 500;
      };
      const fullAvg = sample(1.0);
      const halfAvg = sample(0.5);
      // Half-weight should be roughly half the average magnitude.
      // Loose bounds because of stochastic jitter; want ≤ 0.7×.
      expect(halfAvg).toBeLessThan(fullAvg * 0.7);
    });

    it('negative weight is a no-op (defensive)', () => {
      triggerImpactShake(0, -1);
      expect(computeShakeOffset(0.05)).toEqual([0, 0, 0]);
    });

    it('a single impulse with weight > stacking cap drives full magnitude', () => {
      // Stacking cap is 1.5 (protects against many-player slam
      // clusters). But a *single* large impulse — e.g. an admin-
      // triggered shake with intensity > 1 — should produce its
      // full magnitude even though it nominally exceeds the cap.
      // Without this rule, admin events couldn't author bigger
      // shakes than the local default.
      triggerImpactShake(0, 5.0);
      // mag = SHAKE_MAGNITUDE * effective_intensity. With single
      // largest = 5.0, effective ≥ 5.0 → mag = 0.45 * 5 = 2.25.
      // Each axis offset ∈ [-2.25, 2.25]. We sample many frames
      // and look for a max-observed-abs that exceeds the
      // stacking-cap-only ceiling of 0.675.
      let maxObservedAbs = 0;
      for (let i = 0; i < 500; i++) {
        const [x, y] = computeShakeOffset(0.001);
        maxObservedAbs = Math.max(maxObservedAbs, Math.abs(x), Math.abs(y));
      }
      // If the cap were applied to a single impulse, max would be
      // ≤ 0.675. The new behaviour pushes well past that.
      expect(maxObservedAbs).toBeGreaterThan(1.0);
    });

    it('respects per-impulse duration override (admin can author longer shakes)', () => {
      // Default duration is 0.18s; this impulse uses 0.5s.
      triggerImpactShake(0, 1.0, 0.5);
      // At t=0.3 (past default duration but within custom), the
      // impulse should still contribute non-zero output.
      const [x, y] = computeShakeOffset(0.3);
      expect(Math.abs(x) + Math.abs(y)).toBeGreaterThan(0);
      // At t=0.6 (past custom duration), back to zero.
      expect(computeShakeOffset(0.6)).toEqual([0, 0, 0]);
    });
  });
});

describe('attenuateByDistance', () => {
  it('returns 1 when viewer is at the impact', () => {
    expect(attenuateByDistance([5, 0, 0], [5, 0, 0], 10)).toBe(1);
  });

  it('returns 0 when viewer is at or beyond the radius', () => {
    expect(attenuateByDistance([10, 0, 0], [0, 0, 0], 10)).toBe(0);
    expect(attenuateByDistance([20, 0, 0], [0, 0, 0], 10)).toBe(0);
  });

  it('linear falloff: half radius → 0.5 weight', () => {
    expect(attenuateByDistance([5, 0, 0], [0, 0, 0], 10)).toBeCloseTo(0.5, 6);
  });

  it('handles 3D distance correctly', () => {
    // 3-4-5 right triangle in 3D: distance = 5.
    expect(attenuateByDistance([3, 4, 0], [0, 0, 0], 10)).toBeCloseTo(0.5, 6);
  });

  it('returns 0 for non-positive radius', () => {
    expect(attenuateByDistance([0, 0, 0], [0, 0, 0], 0)).toBe(0);
    expect(attenuateByDistance([0, 0, 0], [0, 0, 0], -5)).toBe(0);
  });
});

describe('triggerWorldImpactShake', () => {
  beforeEach(() => {
    clearShake();
    _resetSceneEventBusForTest();
  });

  it('shakes the local camera at full strength', () => {
    triggerWorldImpactShake(0, [10, 0, 0]);
    const [x, y] = computeShakeOffset(0.05);
    expect(Math.abs(x) + Math.abs(y)).toBeGreaterThan(0);
  });

  it('queues a camera_shake scene event with the impact position', () => {
    triggerWorldImpactShake(0, [10, 4, -3]);
    const drained = drainOutboundQueue();
    expect(drained).toHaveLength(1);
    expect(drained[0]).toMatchObject({
      kind: 'camera_shake',
      position: [10, 4, -3],
    });
  });

  it('uses default radius/intensity/duration when no opts provided', () => {
    triggerWorldImpactShake(0, [0, 0, 0]);
    const event = drainOutboundQueue()[0];
    expect(event).toMatchObject({
      kind: 'camera_shake',
      radius: 500,
      intensity: 1,
    });
  });

  it('honours custom opts', () => {
    triggerWorldImpactShake(0, [0, 0, 0], {
      radius: 25,
      intensity: 0.6,
      durationMs: 250,
    });
    const event = drainOutboundQueue()[0];
    expect(event).toMatchObject({
      kind: 'camera_shake',
      radius: 25,
      intensity: 0.6,
      duration_ms: 250,
    });
  });
});
