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
});
