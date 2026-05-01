/**
 * Interactable — synth-event suppression module-level helpers.
 *
 * Covers `setTouchInProgress` and `isInteractionSynthSuppressed` —
 * the iOS-Safari double-fire gate. The suppression is a stateful
 * combination of a boolean (true for the entire duration of any touch)
 * + a 400 ms post-touchend timestamp buffer (covers the synthetic
 * mouse events iOS dispatches after touchend).
 *
 * Module state is shared across tests (these are file-scoped lets, not
 * a class), so each test resets explicitly with setTouchInProgress.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setTouchInProgress, isInteractionSynthSuppressed } from '@/components/scene/Interactable';

describe('Interactable synth-event suppression', () => {
  beforeEach(() => {
    // Mock performance.now alongside setTimeout/clearTimeout — the
    // suppression buffer reads `performance.now()`, so without faking
    // it `advanceTimersByTime` wouldn't move the clock the buffer is
    // checking against.
    vi.useFakeTimers({ toFake: ['performance', 'setTimeout', 'clearTimeout', 'Date'] });
    // Drain any prior state. setTouchInProgress(false) buffers for 400
    // ms; advance past it so each test starts unsuppressed.
    setTouchInProgress(false);
    vi.advanceTimersByTime(500);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reports unsuppressed in the steady idle state', () => {
    expect(isInteractionSynthSuppressed()).toBe(false);
  });

  it('suppresses for the entire duration a touch is in progress', () => {
    setTouchInProgress(true);
    expect(isInteractionSynthSuppressed()).toBe(true);

    // 5 seconds into the hold — still suppressed (the boolean dominates,
    // independent of the 400 ms buffer).
    vi.advanceTimersByTime(5000);
    expect(isInteractionSynthSuppressed()).toBe(true);
  });

  it('keeps suppressing for ~400 ms after touch ends, then releases', () => {
    setTouchInProgress(true);
    setTouchInProgress(false);
    expect(isInteractionSynthSuppressed()).toBe(true);

    // Just before the buffer expires.
    vi.advanceTimersByTime(399);
    expect(isInteractionSynthSuppressed()).toBe(true);

    // After the buffer expires.
    vi.advanceTimersByTime(2);
    expect(isInteractionSynthSuppressed()).toBe(false);
  });

  it('a second touch beginning resets the boolean even if the prior buffer was active', () => {
    setTouchInProgress(true);
    setTouchInProgress(false);
    vi.advanceTimersByTime(100);
    // Mid-buffer — still suppressed.
    expect(isInteractionSynthSuppressed()).toBe(true);

    setTouchInProgress(true);
    // Boolean takes precedence; suppression continues.
    expect(isInteractionSynthSuppressed()).toBe(true);

    // 1 second into this new touch (well past the prior buffer's 400 ms),
    // we're still suppressed because the boolean is true.
    vi.advanceTimersByTime(1000);
    expect(isInteractionSynthSuppressed()).toBe(true);
  });

  it('the post-touchend buffer refreshes on each touch end', () => {
    // Touch 1.
    setTouchInProgress(true);
    setTouchInProgress(false);
    vi.advanceTimersByTime(200);
    expect(isInteractionSynthSuppressed()).toBe(true);

    // Touch 2 — ends 200ms later.
    setTouchInProgress(true);
    setTouchInProgress(false);
    expect(isInteractionSynthSuppressed()).toBe(true);

    // 401 ms past touch 1's end — but only 1 ms past touch 2's end.
    // Touch 2's buffer dominates → still suppressed.
    vi.advanceTimersByTime(1);
    expect(isInteractionSynthSuppressed()).toBe(true);

    // 401 ms past touch 2's end now — released.
    vi.advanceTimersByTime(400);
    expect(isInteractionSynthSuppressed()).toBe(false);
  });
});
