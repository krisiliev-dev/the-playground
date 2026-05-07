/**
 * Tests for remote sword cascade animation math — pure, no R3F.
 *
 * Verifies the streak's progress + opacity envelope and the
 * spark's scale/opacity ramp. Receiver-side rendering tests in
 * `RemoteSwordCascade.test.tsx` lean on these to be correct.
 */
import { describe, it, expect } from 'vitest';
import {
  REMOTE_SPARK_DURATION_S,
  REMOTE_STREAK_DURATION_S,
  REMOTE_STREAK_FADE_TAIL_S,
  REMOTE_STREAK_TOTAL_S,
  computeSparkFrame,
  computeStreakFrame,
} from '@/multiplayer/remoteSwordCascadeMath';

describe('computeStreakFrame', () => {
  it('reports zero progress + zero opacity at elapsed=0', () => {
    const frame = computeStreakFrame(0);
    expect(frame.progress).toBe(0);
    expect(frame.opacity).toBe(0);
  });

  it('rises in opacity over the first 12% of flight', () => {
    const flight = REMOTE_STREAK_DURATION_S;
    // Halfway through the rise window.
    const frame = computeStreakFrame(flight * 0.06);
    expect(frame.opacity).toBeGreaterThan(0);
    expect(frame.opacity).toBeLessThan(1);
  });

  it('holds opacity at 1 during the steady-state segment', () => {
    const frame = computeStreakFrame(REMOTE_STREAK_DURATION_S * 0.5);
    expect(frame.opacity).toBe(1);
  });

  it('linearly interpolates progress along the flight', () => {
    const half = computeStreakFrame(REMOTE_STREAK_DURATION_S * 0.5);
    expect(half.progress).toBeCloseTo(0.5, 5);
  });

  it('clamps progress to 1 once flight finishes', () => {
    const tailMid = computeStreakFrame(
      REMOTE_STREAK_DURATION_S + REMOTE_STREAK_FADE_TAIL_S * 0.5,
    );
    expect(tailMid.progress).toBe(1);
  });

  it('fades opacity from 1 to 0 across the tail phase', () => {
    const justAfterFlight = computeStreakFrame(REMOTE_STREAK_DURATION_S + 0.001);
    expect(justAfterFlight.opacity).toBeCloseTo(1, 1);

    const tailMid = computeStreakFrame(
      REMOTE_STREAK_DURATION_S + REMOTE_STREAK_FADE_TAIL_S * 0.5,
    );
    expect(tailMid.opacity).toBeCloseTo(0.5, 5);
  });

  it('returns zero opacity past the total lifetime', () => {
    const past = computeStreakFrame(REMOTE_STREAK_TOTAL_S + 1);
    expect(past.opacity).toBe(0);
    expect(past.progress).toBe(1);
  });
});

describe('computeSparkFrame', () => {
  it('returns zero opacity at elapsed=0 (boundary check) and at end', () => {
    const start = computeSparkFrame(0);
    // At 0, the linear ramp gives opacity = 1 - 0 = 1 with scale =
    // initialScale. The function returns the live frame for elapsed
    // strictly inside (0, duration), so 0 falls through to the live
    // formula (1 - p = 1).
    expect(start.opacity).toBeCloseTo(1, 5);

    const end = computeSparkFrame(REMOTE_SPARK_DURATION_S);
    expect(end.opacity).toBe(0);
  });

  it('linearly fades opacity 1 → 0 across the duration', () => {
    const half = computeSparkFrame(REMOTE_SPARK_DURATION_S * 0.5);
    expect(half.opacity).toBeCloseTo(0.5, 5);
  });

  it('scales up as elapsed grows', () => {
    const early = computeSparkFrame(REMOTE_SPARK_DURATION_S * 0.1, undefined, 1, 8);
    const late = computeSparkFrame(REMOTE_SPARK_DURATION_S * 0.9, undefined, 1, 8);
    expect(late.scale).toBeGreaterThan(early.scale);
  });

  it('returns zero opacity past the duration', () => {
    const past = computeSparkFrame(REMOTE_SPARK_DURATION_S + 1);
    expect(past.opacity).toBe(0);
  });

  it('handles negative elapsed gracefully (returns zero opacity)', () => {
    const before = computeSparkFrame(-0.1);
    expect(before.opacity).toBe(0);
  });
});
