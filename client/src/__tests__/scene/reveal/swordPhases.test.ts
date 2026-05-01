/**
 * Sword phase math — covers the pure helpers extracted from Sword.tsx's
 * useFrame. Each test pins the contract at the phase boundaries (where
 * a typo or off-by-one would silently change motion characteristics)
 * plus mid-phase sample points.
 */
import { describe, it, expect } from 'vitest';
import {
  computeOrientationPhase,
  computeSpinAngle,
  computeTiltAngle,
  computeTrajectoryProgress,
  computeVisualScale,
  smoothstep,
} from '@/components/scene/reveal/swordPhases';
import {
  SWING_DURATION,
  SWING_MID,
  SWING_POST,
  SWING_PRE,
} from '@/components/scene/reveal/constants';

const PRE_END = SWING_PRE;
const MID_END = SWING_PRE + SWING_MID;
const POST_END = SWING_DURATION;

describe('smoothstep', () => {
  it('endpoints — smoothstep(0) = 0, smoothstep(1) = 1', () => {
    expect(smoothstep(0)).toBe(0);
    expect(smoothstep(1)).toBe(1);
  });

  it('symmetric around 0.5 — smoothstep(0.5) = 0.5', () => {
    expect(smoothstep(0.5)).toBeCloseTo(0.5, 10);
  });

  it('zero derivative at endpoints (eases in + out)', () => {
    // Numerical: smoothstep(ε) should be much smaller than ε for small ε.
    const eps = 0.01;
    expect(smoothstep(eps)).toBeLessThan(eps); // ~0.0003
    expect(smoothstep(1 - eps)).toBeGreaterThan(1 - eps);
  });
});

describe('computeTrajectoryProgress', () => {
  it('starts at 0 at t=0', () => {
    expect(computeTrajectoryProgress(0)).toBe(0);
  });

  it('reaches 0.5 at the end of pre (sword arrives at formation)', () => {
    expect(computeTrajectoryProgress(PRE_END)).toBeCloseTo(0.5, 6);
  });

  it('drifts linearly through mid from 0.5 to 0.55', () => {
    expect(computeTrajectoryProgress(PRE_END + SWING_MID / 2)).toBeCloseTo(0.5 + 0.025, 6);
    expect(computeTrajectoryProgress(MID_END)).toBeCloseTo(0.55, 6);
  });

  it('reaches ~1 at the end of post (sword arrives at the wall)', () => {
    // Cubic ease-in to 1.0; numerically the limit is exactly 1.0 at t=POST_END.
    expect(computeTrajectoryProgress(POST_END)).toBeCloseTo(1, 6);
  });

  it('caps at 1 if t overshoots POST_END (defensive)', () => {
    expect(computeTrajectoryProgress(POST_END + 5)).toBeCloseTo(1, 6);
  });

  it('is monotonically non-decreasing across a dense sweep', () => {
    let prev = -Infinity;
    for (let t = 0; t <= POST_END; t += 0.05) {
      const p = computeTrajectoryProgress(t);
      expect(p).toBeGreaterThanOrEqual(prev);
      prev = p;
    }
  });
});

describe('computeTiltAngle', () => {
  it('is 0 throughout pre', () => {
    expect(computeTiltAngle(0, 0.18)).toBe(0);
    expect(computeTiltAngle(PRE_END / 2, 0.18)).toBe(0);
    // Just before pre ends — strictly less than SWING_PRE returns 0.
    expect(computeTiltAngle(PRE_END - 0.001, 0.18)).toBe(0);
  });

  it('peaks at +tiltMax at the start of mid', () => {
    expect(computeTiltAngle(PRE_END, 0.18)).toBeCloseTo(0.18, 6);
  });

  it('crosses zero at the midpoint of mid', () => {
    expect(computeTiltAngle(PRE_END + SWING_MID / 2, 0.18)).toBeCloseTo(0, 6);
  });

  it('reaches -tiltMax at the start of post', () => {
    expect(computeTiltAngle(MID_END, 0.18)).toBeCloseTo(-0.18, 6);
  });

  it('eases linearly back to 0 by end of post', () => {
    expect(computeTiltAngle(POST_END - 0.0001, 0.18)).toBeCloseTo(0, 4);
  });

  it('is 0 once the swing is over', () => {
    expect(computeTiltAngle(POST_END + 1, 0.18)).toBe(0);
  });

  it('scales linearly with tiltMax — 2× tiltMax → 2× output', () => {
    const t = PRE_END + 0.1;
    expect(computeTiltAngle(t, 0.36)).toBeCloseTo(2 * computeTiltAngle(t, 0.18), 8);
  });
});

describe('computeSpinAngle', () => {
  it('is 0 when both rotation counts are 0 — current production behaviour', () => {
    for (const t of [0, PRE_END / 2, PRE_END, MID_END, POST_END]) {
      expect(computeSpinAngle(t, 0, 0)).toBe(0);
    }
  });

  it('with preRotations=1, approaches 2π as t → end of pre (clean landing)', () => {
    // Strict t < SWING_PRE branch — at PRE_END exactly we've already
    // crossed into the mid phase (spin = 0). Sample just below to see
    // the limit value.
    expect(computeSpinAngle(PRE_END - 1e-6, 1, 0)).toBeCloseTo(2 * Math.PI, 4);
  });

  it('with postRotations=2, ends at 4π by the end of post', () => {
    // Post phase clamps phaseT at 1, so t = POST_END (or beyond) gives
    // exactly the full N×2π — no need for a sub-epsilon dance.
    expect(computeSpinAngle(POST_END, 0, 2)).toBeCloseTo(4 * Math.PI, 6);
  });

  it('holds 0 through mid regardless of rotation counts', () => {
    expect(computeSpinAngle(PRE_END + SWING_MID / 2, 3, 5)).toBe(0);
  });
});

describe('computeVisualScale', () => {
  it('starts at spawnVisualScale at t=0', () => {
    expect(computeVisualScale(0, 0.5)).toBeCloseTo(0.5, 6);
  });

  it('reaches 1.0 at end of pre (smoothstep eases in)', () => {
    expect(computeVisualScale(PRE_END, 0.5)).toBeCloseTo(1, 6);
  });

  it('holds at 1.0 through mid + post', () => {
    expect(computeVisualScale(MID_END, 0.5)).toBe(1);
    expect(computeVisualScale(POST_END, 0.5)).toBe(1);
  });

  it('is identically 1 when spawnVisualScale = 1 (current production)', () => {
    for (const t of [0, PRE_END / 2, PRE_END, MID_END, POST_END]) {
      expect(computeVisualScale(t, 1)).toBe(1);
    }
  });
});

describe('computeOrientationPhase', () => {
  const TURN = 0.5; // ORIENTATION_TURN_TIME

  it("returns 'spawn' for t early in pre", () => {
    expect(computeOrientationPhase(0, TURN)).toEqual({ phase: 'spawn', alpha: 0 });
    expect(computeOrientationPhase(PRE_END - TURN - 0.001, TURN)).toEqual({
      phase: 'spawn',
      alpha: 0,
    });
  });

  it("transitions to 'spawn-to-mid' in the last `turnTime` seconds of pre", () => {
    const result = computeOrientationPhase(PRE_END - TURN, TURN);
    expect(result.phase).toBe('spawn-to-mid');
    expect(result.alpha).toBe(0);

    const mid = computeOrientationPhase(PRE_END - TURN / 2, TURN);
    expect(mid.phase).toBe('spawn-to-mid');
    expect(mid.alpha).toBeCloseTo(smoothstep(0.5), 6); // 0.5

    const end = computeOrientationPhase(PRE_END - 0.001, TURN);
    expect(end.phase).toBe('spawn-to-mid');
    expect(end.alpha).toBeGreaterThan(0.99);
  });

  it("returns 'mid' through the formation hold", () => {
    expect(computeOrientationPhase(PRE_END, TURN)).toEqual({ phase: 'mid', alpha: 0 });
    expect(computeOrientationPhase(PRE_END + SWING_MID / 2, TURN)).toEqual({
      phase: 'mid',
      alpha: 0,
    });
  });

  it("returns 'mid-to-end' through post, alpha eases 0 → 1", () => {
    const start = computeOrientationPhase(MID_END, TURN);
    expect(start.phase).toBe('mid-to-end');
    // Floating-point: smoothstep(0) is mathematically 0 but the
    // expression `0*0*(3-0)` can leave a sub-epsilon residue when
    // MID_END isn't representable exactly. toBeCloseTo here.
    expect(start.alpha).toBeCloseTo(0, 10);

    const half = computeOrientationPhase(MID_END + SWING_POST / 2, TURN);
    expect(half.phase).toBe('mid-to-end');
    expect(half.alpha).toBeCloseTo(smoothstep(0.5), 6);

    const end = computeOrientationPhase(POST_END - 0.0001, TURN);
    expect(end.phase).toBe('mid-to-end');
    expect(end.alpha).toBeCloseTo(1, 4);
  });

  it('orientation alpha is clamped at 1.0 past the end of post', () => {
    const past = computeOrientationPhase(POST_END + 1, TURN);
    expect(past.phase).toBe('mid-to-end');
    expect(past.alpha).toBe(1);
  });
});
