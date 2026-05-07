/**
 * Unit tests for the cursor-mode state machine.
 *
 * These tests pin down the boolean rules that used to live as
 * inline if/else chains in `<PointerCursor>`. If the rules
 * change in `cursorMode.ts`, the test file fails — making the
 * change visible at review time instead of as a behavioural
 * regression in the cursor.
 */
import { describe, expect, it } from 'vitest';
import { CursorMode, computeCursorMode, isAvatarMode } from '@/components/scene/cursorMode';
import { SWING_PRE } from '@/components/scene/reveal/constants';

describe('computeCursorMode', () => {
  it('returns PointerLive at idle', () => {
    expect(
      computeCursorMode({
        revealState: 'idle',
        controlsDismissed: false,
        swingTime: 0,
        panProgress: null,
      }),
    ).toBe(CursorMode.PointerLive);
  });

  it('returns PointerWorldFrozen during armed', () => {
    expect(
      computeCursorMode({
        revealState: 'armed',
        controlsDismissed: false,
        swingTime: 0,
        panProgress: null,
      }),
    ).toBe(CursorMode.PointerWorldFrozen);
  });

  it('returns PointerWorldFrozen for the early swinging phase', () => {
    expect(
      computeCursorMode({
        revealState: 'swinging',
        controlsDismissed: false,
        swingTime: SWING_PRE - 0.1,
        panProgress: null,
      }),
    ).toBe(CursorMode.PointerWorldFrozen);
  });

  it('returns PointerCameraAnchored once SWING_PRE has elapsed', () => {
    expect(
      computeCursorMode({
        revealState: 'swinging',
        controlsDismissed: false,
        swingTime: SWING_PRE,
        panProgress: null,
      }),
    ).toBe(CursorMode.PointerCameraAnchored);
  });

  it('returns PointerLive at impact and revealed (before controls dismissed)', () => {
    for (const revealState of ['impact', 'revealed'] as const) {
      expect(
        computeCursorMode({
          revealState,
          controlsDismissed: false,
          swingTime: 0,
          panProgress: null,
        }),
      ).toBe(CursorMode.PointerLive);
    }
  });

  it('returns AvatarInitialPan during the pointer→avatar pan', () => {
    expect(
      computeCursorMode({
        revealState: 'revealed',
        controlsDismissed: true,
        swingTime: 0,
        panProgress: 0.5,
      }),
    ).toBe(CursorMode.AvatarInitialPan);
  });

  it('returns AvatarSteady once pan completes (or no pan tracked)', () => {
    expect(
      computeCursorMode({
        revealState: 'revealed',
        controlsDismissed: true,
        swingTime: 0,
        panProgress: 1,
      }),
    ).toBe(CursorMode.AvatarSteady);
    expect(
      computeCursorMode({
        revealState: 'revealed',
        controlsDismissed: true,
        swingTime: 0,
        panProgress: null,
      }),
    ).toBe(CursorMode.AvatarSteady);
  });
});

describe('isAvatarMode', () => {
  it('is true only for the two avatar modes', () => {
    expect(isAvatarMode(CursorMode.AvatarInitialPan)).toBe(true);
    expect(isAvatarMode(CursorMode.AvatarSteady)).toBe(true);
    expect(isAvatarMode(CursorMode.PointerLive)).toBe(false);
    expect(isAvatarMode(CursorMode.PointerWorldFrozen)).toBe(false);
    expect(isAvatarMode(CursorMode.PointerCameraAnchored)).toBe(false);
  });
});
