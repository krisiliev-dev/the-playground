/**
 * Reveal constants — invariant checks.
 *
 * These constants are now imported by Sword, BulletTimeDirector, and
 * CursorAvatar. The test pins the invariants those consumers all assume:
 *   - SWING_DURATION = SWING_PRE + SWING_MID + SWING_POST exactly
 *     (any drift would silently desync per-phase timing across files).
 *   - SWING_DURATION_MS = SWING_DURATION × 1000 (legacy SWORD_CONSTANTS
 *     export expects this).
 *   - All durations are positive finite numbers (a 0 or NaN would put
 *     the swing logic in an infinite-loop / divide-by-zero state).
 */
import { describe, it, expect } from 'vitest';
import {
  ARMED_DURATION,
  MID_FORWARD,
  SWING_DURATION,
  SWING_DURATION_MS,
  SWING_MID,
  SWING_POST,
  SWING_PRE,
} from '@/components/scene/reveal/constants';

describe('reveal constants', () => {
  it('SWING_DURATION equals the sum of the three phase durations', () => {
    expect(SWING_DURATION).toBeCloseTo(SWING_PRE + SWING_MID + SWING_POST, 10);
  });

  it('SWING_DURATION_MS is SWING_DURATION × 1000', () => {
    expect(SWING_DURATION_MS).toBeCloseTo(SWING_DURATION * 1000, 6);
  });

  it('all durations are positive finite numbers', () => {
    for (const v of [ARMED_DURATION, SWING_PRE, SWING_MID, SWING_POST, SWING_DURATION]) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThan(0);
    }
  });

  it('MID_FORWARD is positive (forward distance camera→letter plane)', () => {
    expect(Number.isFinite(MID_FORWARD)).toBe(true);
    expect(MID_FORWARD).toBeGreaterThan(0);
  });

  it('phase ordering reads naturally — pre is the longest', () => {
    // Not a strict invariant of the system (you could in principle
    // have SWING_MID > SWING_PRE), but it's a load-bearing assumption
    // of the audio + camera choreography (the chase camera ramps in
    // during pre because that phase has the most time to spare). If
    // you ever flip this, check the chase-ramp duration too.
    expect(SWING_PRE).toBeGreaterThanOrEqual(SWING_MID);
    expect(SWING_PRE).toBeGreaterThanOrEqual(SWING_POST);
  });
});
