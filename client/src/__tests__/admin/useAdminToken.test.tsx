/**
 * Tests for the admin token hook. Verifies:
 *   - reads the persisted token from localStorage on mount
 *   - setToken writes through to localStorage
 *   - clearToken empties both state + localStorage
 *   - storage events from other tabs sync state (cross-tab)
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useAdminToken } from '@/admin/useAdminToken';

const STORAGE_KEY = 'playground.admin_token';

describe('useAdminToken', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('initial token is empty when localStorage is unset', () => {
    const { result } = renderHook(() => useAdminToken());
    expect(result.current.token).toBe('');
  });

  it('reads a previously persisted token on mount', () => {
    window.localStorage.setItem(STORAGE_KEY, 'pre-existing');
    const { result } = renderHook(() => useAdminToken());
    expect(result.current.token).toBe('pre-existing');
  });

  it('setToken updates state + localStorage', () => {
    const { result } = renderHook(() => useAdminToken());
    act(() => {
      result.current.setToken('new-token');
    });
    expect(result.current.token).toBe('new-token');
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('new-token');
  });

  it('clearToken empties both state + localStorage', () => {
    const { result } = renderHook(() => useAdminToken());
    act(() => {
      result.current.setToken('temp');
    });
    act(() => {
      result.current.clearToken();
    });
    expect(result.current.token).toBe('');
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('');
  });

  it('cross-tab storage event syncs the in-memory token', () => {
    const { result } = renderHook(() => useAdminToken());
    expect(result.current.token).toBe('');

    act(() => {
      // Simulate another tab writing the token. StorageEvent is
      // the only mechanism React'll see for cross-tab sync — we
      // construct one directly since localStorage.setItem from
      // the same tab doesn't fire it.
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: STORAGE_KEY,
          newValue: 'from-other-tab',
        }),
      );
    });

    expect(result.current.token).toBe('from-other-tab');
  });

  it('ignores storage events for unrelated keys', () => {
    const { result } = renderHook(() => useAdminToken());
    act(() => {
      result.current.setToken('mine');
    });
    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: 'some.other.key',
          newValue: 'noise',
        }),
      );
    });
    expect(result.current.token).toBe('mine');
  });
});
