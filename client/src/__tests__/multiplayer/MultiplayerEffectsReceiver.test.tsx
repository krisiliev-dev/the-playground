/**
 * Tests for MultiplayerEffectsReceiver — the inbound side of the
 * scene event channel.
 *
 * The receiver is mounted by App when multiplayer is enabled and
 * subscribes to inbound `audio` events, calling sfx.play with the
 * received position + volume. We verify the contract:
 *   - known sound ids are played (sfx.play called with right shape)
 *   - unknown sound ids are dropped silently (no sfx.play call)
 *   - the type guard `isKnownSoundId` correctly narrows
 *
 * Mocking: `sfx` is a singleton, so we spy on `sfx.play` and assert
 * its calls.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render } from '@testing-library/react';
import {
  MultiplayerEffectsReceiver,
  isKnownSoundId,
} from '@/multiplayer/MultiplayerEffectsReceiver';
import { dispatchSceneEvent, _resetSceneEventBusForTest } from '@/multiplayer/sceneEvents';
import { sfx } from '@/components/audio/SfxManager';
import { clearShake, computeShakeOffset } from '@/components/scene/cameraShake';
import { cursorWorldPosition } from '@/components/scene/cursorWorldPosition';

describe('isKnownSoundId', () => {
  it('returns true for ids that exist in the SFX manifest', () => {
    expect(isKnownSoundId('swordSlam')).toBe(true);
    expect(isKnownSoundId('uiClick')).toBe(true);
  });

  it('returns false for ids that do not exist', () => {
    expect(isKnownSoundId('nonexistent_id')).toBe(false);
    expect(isKnownSoundId('')).toBe(false);
    expect(isKnownSoundId('__proto__')).toBe(false);
    expect(isKnownSoundId('constructor')).toBe(false);
  });
});

describe('MultiplayerEffectsReceiver', () => {
  beforeEach(() => {
    _resetSceneEventBusForTest();
    vi.restoreAllMocks();
  });

  it('plays incoming audio events with the received position + volume', () => {
    const playSpy = vi.spyOn(sfx, 'play').mockResolvedValue();
    render(<MultiplayerEffectsReceiver />);

    dispatchSceneEvent(
      {
        kind: 'audio',
        sound_id: 'swordSlam',
        position: [10, 5, -3],
        volume: 0.8,
      },
      'remote-actor-id',
    );

    expect(playSpy).toHaveBeenCalledTimes(1);
    expect(playSpy).toHaveBeenCalledWith('swordSlam', {
      position: { x: 10, y: 5, z: -3 },
      volumeMultiplier: 0.8,
    });
  });

  it('plays without position when the event has none (2D ambient cue)', () => {
    const playSpy = vi.spyOn(sfx, 'play').mockResolvedValue();
    render(<MultiplayerEffectsReceiver />);

    dispatchSceneEvent(
      {
        kind: 'audio',
        sound_id: 'uiClick',
        position: null,
        volume: 1,
      },
      null,
    );

    expect(playSpy).toHaveBeenCalledWith('uiClick', {
      position: undefined,
      volumeMultiplier: 1,
    });
  });

  it('drops events with unknown sound ids (no crash, no play call)', () => {
    const playSpy = vi.spyOn(sfx, 'play').mockResolvedValue();
    render(<MultiplayerEffectsReceiver />);

    dispatchSceneEvent(
      {
        kind: 'audio',
        sound_id: 'this_id_does_not_exist',
        position: [0, 0, 0],
        volume: 0.5,
      },
      'actor',
    );

    expect(playSpy).not.toHaveBeenCalled();
  });

  it('unsubscribes on unmount (no leaked plays after unmount)', () => {
    const playSpy = vi.spyOn(sfx, 'play').mockResolvedValue();
    const { unmount } = render(<MultiplayerEffectsReceiver />);

    dispatchSceneEvent(
      {
        kind: 'audio',
        sound_id: 'swordSlam',
        position: [0, 0, 0],
        volume: 1,
      },
      null,
    );
    expect(playSpy).toHaveBeenCalledTimes(1);

    unmount();

    dispatchSceneEvent(
      {
        kind: 'audio',
        sound_id: 'swordSlam',
        position: [0, 0, 0],
        volume: 1,
      },
      null,
    );
    expect(playSpy).toHaveBeenCalledTimes(1); // no second call
  });

  it('renders nothing (returns null)', () => {
    const { container } = render(<MultiplayerEffectsReceiver />);
    expect(container.firstChild).toBeNull();
  });

  describe('camera_shake events', () => {
    beforeEach(() => {
      _resetSceneEventBusForTest();
      clearShake();
      cursorWorldPosition.set(0, 0, 0);
    });

    it('shakes when impact is within radius', () => {
      render(<MultiplayerEffectsReceiver />);
      // Local cursor at origin; impact 10 units away within radius 60.
      cursorWorldPosition.set(0, 0, 0);
      const triggeredAt = performance.now() / 1000;
      dispatchSceneEvent(
        {
          kind: 'camera_shake',
          position: [10, 0, 0],
          radius: 60,
          intensity: 1.0,
          duration_ms: 180,
        },
        'remote',
      );
      // Sample slightly after the trigger time (still within shake
      // duration). Random jitter; sum-of-abs > 0 with overwhelming
      // probability when an impulse is active.
      const [x, y] = computeShakeOffset(triggeredAt + 0.01);
      expect(Math.abs(x) + Math.abs(y)).toBeGreaterThan(0);
    });

    it('does not shake when impact is outside radius', () => {
      render(<MultiplayerEffectsReceiver />);
      cursorWorldPosition.set(0, 0, 0);
      // Impact 100 units away, radius 60 — outside.
      dispatchSceneEvent(
        {
          kind: 'camera_shake',
          position: [100, 0, 0],
          radius: 60,
          intensity: 1.0,
          duration_ms: 180,
        },
        'remote',
      );
      // No impulse recorded → offset is exactly [0, 0, 0].
      expect(computeShakeOffset(performance.now() / 1000)).toEqual([0, 0, 0]);
    });

    it('skips shake events with zero radius', () => {
      render(<MultiplayerEffectsReceiver />);
      cursorWorldPosition.set(0, 0, 0);
      dispatchSceneEvent(
        {
          kind: 'camera_shake',
          position: [0, 0, 0],
          radius: 0,
          intensity: 1.0,
          duration_ms: 180,
        },
        'remote',
      );
      expect(computeShakeOffset(performance.now() / 1000)).toEqual([0, 0, 0]);
    });

    it('skips shake events with zero intensity', () => {
      render(<MultiplayerEffectsReceiver />);
      cursorWorldPosition.set(0, 0, 0);
      // Even at zero distance, intensity 0 means no shake.
      dispatchSceneEvent(
        {
          kind: 'camera_shake',
          position: [0, 0, 0],
          radius: 60,
          intensity: 0,
          duration_ms: 180,
        },
        'remote',
      );
      expect(computeShakeOffset(performance.now() / 1000)).toEqual([0, 0, 0]);
    });

    it('unsubscribes camera_shake on unmount', () => {
      const { unmount } = render(<MultiplayerEffectsReceiver />);
      unmount();
      cursorWorldPosition.set(0, 0, 0);
      dispatchSceneEvent(
        {
          kind: 'camera_shake',
          position: [0, 0, 0],
          radius: 60,
          intensity: 1.0,
          duration_ms: 180,
        },
        'remote',
      );
      // No subscriber should have triggered an impulse.
      expect(computeShakeOffset(performance.now() / 1000)).toEqual([0, 0, 0]);
    });
  });
});
