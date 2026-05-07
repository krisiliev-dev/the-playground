/**
 * Tests for the client-side scene event bus.
 *
 * The pub/sub primitives are pure module state, easy to verify
 * in isolation. The React `useSceneEvent` hook is verified via
 * `renderHook` from @testing-library/react.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import {
  drainOutboundQueue,
  dispatchSceneEvent,
  emitSceneEvent,
  useSceneEvent,
  _resetSceneEventBusForTest,
} from '@/multiplayer/sceneEvents';
import type { SceneEventKind } from '@/multiplayer/types';

const audio = (
  overrides: Partial<Extract<SceneEventKind, { kind: 'audio' }>> = {},
): SceneEventKind => ({
  kind: 'audio',
  sound_id: 'click',
  position: null,
  volume: 0.5,
  ...overrides,
});

const swordImpact = (position: [number, number, number] = [0, 0, 0]): SceneEventKind => ({
  kind: 'sword_impact',
  position,
});

describe('emitSceneEvent', () => {
  beforeEach(() => {
    _resetSceneEventBusForTest();
  });

  it('queues the event for outbound delivery', () => {
    emitSceneEvent(audio());
    const drained = drainOutboundQueue();
    expect(drained).toHaveLength(1);
    expect(drained[0]).toMatchObject({ kind: 'audio', sound_id: 'click' });
  });

  it('does NOT run local subscribers — wrappers handle local trigger directly', () => {
    // Critical: emitSceneEvent must not double-fire the originator's
    // own subscribers, otherwise wrappers like sfx.playWorld would
    // play the local effect twice (once from the direct call, once
    // from the receiver subscribing to its own emit).
    const fired: SceneEventKind[] = [];
    const { unmount } = renderHook(() =>
      useSceneEvent('audio', (event) => {
        fired.push(event);
      }),
    );

    emitSceneEvent(audio({ sound_id: 'tick' }));
    expect(fired).toHaveLength(0);
    unmount();
  });

  it('drainOutboundQueue clears the queue', () => {
    emitSceneEvent(audio());
    emitSceneEvent(audio());
    expect(drainOutboundQueue()).toHaveLength(2);
    expect(drainOutboundQueue()).toHaveLength(0);
  });

  it('drainOutboundQueue returns empty array when nothing queued', () => {
    expect(drainOutboundQueue()).toEqual([]);
  });
});

describe('dispatchSceneEvent', () => {
  beforeEach(() => {
    _resetSceneEventBusForTest();
  });

  it('fans out to all subscribers of matching kind', () => {
    const calls: number[] = [];
    const { unmount: u1 } = renderHook(() =>
      useSceneEvent('sword_impact', () => {
        calls.push(1);
      }),
    );
    const { unmount: u2 } = renderHook(() =>
      useSceneEvent('sword_impact', () => {
        calls.push(2);
      }),
    );

    dispatchSceneEvent(swordImpact(), 'actor-a');
    expect(calls.sort()).toEqual([1, 2]);

    u1();
    u2();
  });

  it('does not fire handlers for a different kind', () => {
    let audioFired = 0;
    let impactFired = 0;
    const { unmount: u1 } = renderHook(() =>
      useSceneEvent('audio', () => {
        audioFired++;
      }),
    );
    const { unmount: u2 } = renderHook(() =>
      useSceneEvent('sword_impact', () => {
        impactFired++;
      }),
    );

    dispatchSceneEvent(swordImpact(), null);
    expect(impactFired).toBe(1);
    expect(audioFired).toBe(0);

    dispatchSceneEvent(audio(), null);
    expect(impactFired).toBe(1);
    expect(audioFired).toBe(1);

    u1();
    u2();
  });

  it('passes the actorId through to the handler', () => {
    let receivedActor: string | null | undefined;
    const { unmount } = renderHook(() =>
      useSceneEvent('sword_impact', (_event, actorId) => {
        receivedActor = actorId;
      }),
    );
    dispatchSceneEvent(swordImpact(), 'actor-xyz');
    expect(receivedActor).toBe('actor-xyz');
    unmount();
  });

  it('does nothing when no subscriber registered for that kind', () => {
    // Should not throw / not error — just silently do nothing.
    expect(() => dispatchSceneEvent(audio(), null)).not.toThrow();
  });

  it('isolates handler exceptions — one throwing handler does not block others', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let goodFired = 0;
    const { unmount: u1 } = renderHook(() =>
      useSceneEvent('audio', () => {
        throw new Error('bad handler');
      }),
    );
    const { unmount: u2 } = renderHook(() =>
      useSceneEvent('audio', () => {
        goodFired++;
      }),
    );

    dispatchSceneEvent(audio(), null);
    expect(goodFired).toBe(1);
    expect(errSpy).toHaveBeenCalled();

    u1();
    u2();
    errSpy.mockRestore();
  });
});

describe('useSceneEvent lifecycle', () => {
  beforeEach(() => {
    _resetSceneEventBusForTest();
  });

  it('cleans up subscription on unmount', () => {
    let fired = 0;
    const { unmount } = renderHook(() =>
      useSceneEvent('audio', () => {
        fired++;
      }),
    );

    dispatchSceneEvent(audio(), null);
    expect(fired).toBe(1);

    unmount();

    dispatchSceneEvent(audio(), null);
    // Handler should NOT have fired post-unmount.
    expect(fired).toBe(1);
  });

  it('updates handler closure across renders without re-subscribing', () => {
    let value = 0;
    let lastSeen = -1;

    const { rerender } = renderHook(
      (props: { x: number }) => {
        useSceneEvent('audio', () => {
          lastSeen = props.x;
        });
        value = props.x;
      },
      { initialProps: { x: 1 } },
    );

    dispatchSceneEvent(audio(), null);
    expect(lastSeen).toBe(1);

    rerender({ x: 42 });
    dispatchSceneEvent(audio(), null);
    expect(lastSeen).toBe(42);
    expect(value).toBe(42);
  });
});
