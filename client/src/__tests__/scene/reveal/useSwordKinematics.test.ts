/**
 * useSwordKinematics — verifies the motion-to-audio binding contract.
 * The hook exposes a per-frame `update(targetPos, targetQuat, dt,
 * handle)` function. We render it via `renderHook` to get a stable
 * function across calls, drive it with hand-computed positions, and
 * assert both the returned speed value and the side effects on a
 * mocked PositionalLoopHandle.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { Quaternion, Vector3 } from 'three';
import { useSwordKinematics } from '@/components/scene/reveal/useSwordKinematics';
import type { PositionalLoopHandle } from '@/components/audio/SfxManager';

function makeHandle(): PositionalLoopHandle & {
  setPosition: ReturnType<typeof vi.fn>;
  setVolume: ReturnType<typeof vi.fn>;
  setPlaybackRate: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
} {
  return {
    setPosition: vi.fn(),
    setVolume: vi.fn(),
    setPlaybackRate: vi.fn(),
    stop: vi.fn(),
  };
}

describe('useSwordKinematics', () => {
  let update: ReturnType<typeof useSwordKinematics>;

  beforeEach(() => {
    const { result } = renderHook(() => useSwordKinematics());
    update = result.current;
  });

  it('returns 0 speed on the first call (prev = origin, target = origin)', () => {
    const handle = makeHandle();
    const speed = update(new Vector3(0, 0, 0), new Quaternion(0, 0, 0, 1), 1 / 60, handle);
    expect(speed).toBe(0);
  });

  it('returns positive speed after movement', () => {
    const handle = makeHandle();
    // First call seeds the prevPos.
    update(new Vector3(0, 0, 0), new Quaternion(0, 0, 0, 1), 1 / 60, handle);
    // Second call: moved 6 units in 0.1s → speed = 60.
    const speed = update(new Vector3(6, 0, 0), new Quaternion(0, 0, 0, 1), 0.1, handle);
    expect(speed).toBeCloseTo(60, 5);
  });

  it('drives handle.setPosition with the target coordinates', () => {
    const handle = makeHandle();
    update(new Vector3(1, 2, 3), new Quaternion(0, 0, 0, 1), 1 / 60, handle);
    expect(handle.setPosition).toHaveBeenCalledWith(1, 2, 3);
  });

  it('sets volume to 0 when the sword is stationary', () => {
    const handle = makeHandle();
    // Two calls with same position → speed = 0 → volume = min(1.5, 0/80) = 0
    update(new Vector3(0, 0, 0), new Quaternion(0, 0, 0, 1), 1 / 60, handle);
    update(new Vector3(0, 0, 0), new Quaternion(0, 0, 0, 1), 1 / 60, handle);
    // Last call's volume value should be 0.
    const lastCall = handle.setVolume.mock.calls[handle.setVolume.mock.calls.length - 1]!;
    expect(lastCall[0]).toBe(0);
  });

  it('caps volume at 1.5× even at very high speed', () => {
    const handle = makeHandle();
    update(new Vector3(0, 0, 0), new Quaternion(0, 0, 0, 1), 1 / 60, handle);
    // Move 1000 units in 0.1s → speed = 10000, but capped to 1.5
    update(new Vector3(1000, 0, 0), new Quaternion(0, 0, 0, 1), 0.1, handle);
    const lastCall = handle.setVolume.mock.calls[handle.setVolume.mock.calls.length - 1]!;
    expect(lastCall[0]).toBe(1.5);
  });

  it('calls setPlaybackRate at 0.95 base when stationary (no Doppler/spin/jerk)', () => {
    const handle = makeHandle();
    update(new Vector3(0, 0, 0), new Quaternion(0, 0, 0, 1), 1 / 60, handle);
    update(new Vector3(0, 0, 0), new Quaternion(0, 0, 0, 1), 1 / 60, handle);
    const lastCall = handle.setPlaybackRate.mock.calls[handle.setPlaybackRate.mock.calls.length - 1]!;
    // Jerk component random, but jerkAmount = min(0.15, 0/50000) = 0 → no dither.
    // Speed pitch = 0, spin pitch = 0 → exactly 0.95.
    expect(lastCall[0]).toBe(0.95);
  });

  it('does not throw when handle is null', () => {
    expect(() =>
      update(new Vector3(1, 0, 0), new Quaternion(0, 0, 0, 1), 1 / 60, null),
    ).not.toThrow();
  });

  it('still computes and returns speed when handle is null', () => {
    update(new Vector3(0, 0, 0), new Quaternion(0, 0, 0, 1), 1 / 60, null);
    const speed = update(new Vector3(3, 4, 0), new Quaternion(0, 0, 0, 1), 0.1, null);
    // |Δpos| = 5, dt = 0.1 → speed = 50.
    expect(speed).toBeCloseTo(50, 5);
  });

  it('captures angular velocity through pure rotation (no translation)', () => {
    const handle = makeHandle();
    const startQuat = new Quaternion(0, 0, 0, 1);
    const rotated = new Quaternion();
    rotated.setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 4); // 45° yaw

    update(new Vector3(0, 0, 0), startQuat, 1 / 60, handle);
    update(new Vector3(0, 0, 0), rotated, 0.1, handle);

    // Speed is 0 (no translation), but spin should contribute to pitch.
    // angSpeed = (PI/4) / 0.1 ≈ 7.85 rad/s. spinPitch = min(0.2, 7.85/18) ≈ 0.436 → capped at 0.2.
    // setPlaybackRate = 0.95 + 0 + 0.2 + ~0 = 1.15.
    const lastCall = handle.setPlaybackRate.mock.calls[handle.setPlaybackRate.mock.calls.length - 1]!;
    expect(lastCall[0]).toBeGreaterThan(0.95);
    expect(lastCall[0]).toBeLessThanOrEqual(1.15);
  });
});
