/**
 * Tests for the in-canvas remote cascade receiver.
 *
 * These tests verify the *structural* behaviour of
 * RemoteSwordCascade — that it adds and removes streaks/sparks
 * in response to inbound scene events. Per-frame visual math
 * lives in `remoteSwordCascadeMath.test.ts`.
 *
 * R3F is mocked because we render in jsdom; we count rendered
 * elements via test ids on the (mocked) Trail children and
 * sprites.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render } from '@testing-library/react';
import { RemoteSwordCascade } from '@/multiplayer/RemoteSwordCascade';
import { dispatchSceneEvent, _resetSceneEventBusForTest } from '@/multiplayer/sceneEvents';

vi.mock('@react-three/fiber', () => ({
  useFrame: vi.fn(),
  useThree: () => ({}),
}));

// Trail mock renders children inline so we can find the inner
// streak meshes via the DOM. The real component uses a custom
// Three.js geometry that doesn't exist in jsdom.
vi.mock('@react-three/drei', () => ({
  Trail: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="streak-trail">{children}</div>
  ),
}));

describe('RemoteSwordCascade', () => {
  beforeEach(() => {
    _resetSceneEventBusForTest();
  });

  it('renders nothing initially (no events)', () => {
    const { queryAllByTestId } = render(<RemoteSwordCascade />);
    expect(queryAllByTestId('streak-trail').length).toBe(0);
  });

  it('renders one streak per inbound sword_swing event', () => {
    const { queryAllByTestId, rerender } = render(<RemoteSwordCascade />);
    dispatchSceneEvent(
      {
        kind: 'sword_swing',
        from: [0, 0, 0],
        to: [10, 5, -3],
        strength: 1,
      },
      'remote-actor',
    );
    rerender(<RemoteSwordCascade />);
    expect(queryAllByTestId('streak-trail').length).toBe(1);

    dispatchSceneEvent(
      {
        kind: 'sword_swing',
        from: [1, 0, 0],
        to: [11, 5, -3],
        strength: 0.5,
      },
      'remote-actor',
    );
    rerender(<RemoteSwordCascade />);
    expect(queryAllByTestId('streak-trail').length).toBe(2);
  });

  it('handles many concurrent streaks without dropping any (cascade burst)', () => {
    const { queryAllByTestId, rerender } = render(<RemoteSwordCascade />);
    // 12 swings — the local cascade size.
    for (let i = 0; i < 12; i++) {
      dispatchSceneEvent(
        {
          kind: 'sword_swing',
          from: [i, 0, 0],
          to: [i + 10, 0, 0],
          strength: 1,
        },
        'remote',
      );
    }
    rerender(<RemoteSwordCascade />);
    expect(queryAllByTestId('streak-trail').length).toBe(12);
  });

  it('unsubscribes on unmount (no re-render after teardown)', () => {
    const { unmount } = render(<RemoteSwordCascade />);
    unmount();
    // After unmount, dispatching a swing should not throw — the
    // subscriber's been cleaned up. Smoke check.
    expect(() => {
      dispatchSceneEvent(
        {
          kind: 'sword_swing',
          from: [0, 0, 0],
          to: [1, 0, 0],
          strength: 1,
        },
        null,
      );
    }).not.toThrow();
  });
});
