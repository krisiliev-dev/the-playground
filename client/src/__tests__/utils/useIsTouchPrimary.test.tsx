/**
 * useIsTouchPrimary — verifies the hook reads `matchMedia('(pointer:
 * coarse)')` and reacts to media-query change events.
 *
 * Setup mocks the matchMedia constructor (the global stub in setup.ts
 * always returns matches=false; here we install a stateful one with a
 * real listener registry so we can dispatch change events) and tears it
 * down per test so suite ordering is irrelevant.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useIsTouchPrimary } from '@/utils';

interface FakeMQL {
  matches: boolean;
  media: string;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
  // Plus minimal MediaQueryList shape — unused by the hook but the
  // type cast in production code expects them.
  onchange: null;
  addListener: () => void;
  removeListener: () => void;
  dispatchEvent: () => boolean;
}

function makeFakeMQL(matches: boolean): FakeMQL {
  return {
    matches,
    media: '(pointer: coarse)',
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: () => false,
  };
}

describe('useIsTouchPrimary', () => {
  let originalMatchMedia: typeof window.matchMedia;
  let currentMQL: FakeMQL;

  beforeEach(() => {
    originalMatchMedia = window.matchMedia;
    currentMQL = makeFakeMQL(false);
    window.matchMedia = ((query: string) => {
      currentMQL.media = query;
      return currentMQL as unknown as MediaQueryList;
    }) as typeof window.matchMedia;
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  it('returns false when (pointer: coarse) does not match (desktop)', () => {
    currentMQL = makeFakeMQL(false);
    const { result } = renderHook(() => useIsTouchPrimary());
    expect(result.current).toBe(false);
  });

  it('returns true when (pointer: coarse) matches (touch device)', () => {
    currentMQL = makeFakeMQL(true);
    const { result } = renderHook(() => useIsTouchPrimary());
    expect(result.current).toBe(true);
  });

  it('subscribes to change events on mount and unsubscribes on unmount', () => {
    currentMQL = makeFakeMQL(false);
    const { unmount } = renderHook(() => useIsTouchPrimary());

    expect(currentMQL.addEventListener).toHaveBeenCalledTimes(1);
    expect(currentMQL.addEventListener).toHaveBeenCalledWith('change', expect.any(Function));
    expect(currentMQL.removeEventListener).not.toHaveBeenCalled();

    unmount();
    expect(currentMQL.removeEventListener).toHaveBeenCalledTimes(1);
  });

  it('flips state when the media query change handler fires (hybrid device)', () => {
    currentMQL = makeFakeMQL(false);
    const { result } = renderHook(() => useIsTouchPrimary());
    expect(result.current).toBe(false);

    // Pull the registered handler out of the addEventListener mock and
    // invoke it with a synthetic change event.
    const registered = currentMQL.addEventListener.mock.calls[0]?.[1] as
      | ((e: MediaQueryListEvent) => void)
      | undefined;
    expect(registered).toBeDefined();

    act(() => {
      registered?.({ matches: true } as MediaQueryListEvent);
    });
    expect(result.current).toBe(true);

    act(() => {
      registered?.({ matches: false } as MediaQueryListEvent);
    });
    expect(result.current).toBe(false);
  });
});
