/**
 * SfxManager API tests — exercise the public surface in jsdom (where
 * `window.AudioContext` is undefined). The contract here is that
 * every method must be safe to call without an AudioContext: in
 * production this matches the brief window before the first user
 * gesture; in tests it's the permanent state. Nothing should throw,
 * reject, or leak — methods either succeed silently or no-op.
 *
 * What we *don't* test: actual audio output. jsdom has no Web Audio
 * implementation, so verifying buffer playback requires a real
 * browser (e.g. via Playwright). That's out of scope here.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { sfx } from '@/components/audio/SfxManager';

describe('SfxManager (jsdom: no AudioContext)', () => {
  beforeEach(() => {
    // `sfx` is a module-scoped singleton, so previous tests' state
    // can leak. We can't fully reset it without exporting an internal
    // hook, but the methods we test are idempotent + side-effect-free
    // when there's no AudioContext.
  });

  describe('unlock()', () => {
    it('does not throw when window.AudioContext is unavailable', () => {
      expect(() => sfx.unlock()).not.toThrow();
    });

    it('is idempotent — repeated calls are safe', () => {
      expect(() => {
        sfx.unlock();
        sfx.unlock();
        sfx.unlock();
      }).not.toThrow();
    });
  });

  describe('preload()', () => {
    it('resolves without rejection in jsdom (no ctx, no decode)', async () => {
      await expect(sfx.preload()).resolves.toBeUndefined();
    });
  });

  describe('play()', () => {
    it('resolves without rejection on a valid cue id', async () => {
      await expect(sfx.play('uiClick')).resolves.toBeUndefined();
    });

    it('catches errors internally and never rejects', async () => {
      // Pass a position to exercise the spatial path; with no ctx
      // the build short-circuits but the promise still resolves.
      await expect(
        sfx.play('swordSlam', {
          volumeMultiplier: 0.5,
          pitchJitter: 0.3,
          position: { x: 1, y: 2, z: 3 },
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe('playPositionalLoop()', () => {
    it('returns a handle with the documented shape', () => {
      const handle = sfx.playPositionalLoop(
        'swordFlying',
        { x: 0, y: 0, z: 0 },
        { volumeMultiplier: 1 },
      );
      expect(handle).toBeDefined();
      expect(typeof handle.setPosition).toBe('function');
      expect(typeof handle.setVolume).toBe('function');
      expect(typeof handle.setPlaybackRate).toBe('function');
      expect(typeof handle.stop).toBe('function');
    });

    it("handle methods don't throw when there's no AudioContext", () => {
      const handle = sfx.playPositionalLoop('swordFlying', { x: 0, y: 0, z: 0 });
      expect(() => handle.setPosition(10, 20, 30)).not.toThrow();
      expect(() => handle.setVolume(0.5)).not.toThrow();
      expect(() => handle.setPlaybackRate(1.2)).not.toThrow();
      expect(() => handle.stop(80)).not.toThrow();
      expect(() => handle.stop()).not.toThrow();
    });
  });

  describe('stop()', () => {
    it('is a no-op for cues that never started', () => {
      expect(() => sfx.stop('wallAmbient')).not.toThrow();
      expect(() => sfx.stop('cursorMove', 100)).not.toThrow();
    });
  });

  describe('isLoopActive()', () => {
    it('returns false for cues that have not started a singleton loop', () => {
      expect(sfx.isLoopActive('wallAmbient')).toBe(false);
      expect(sfx.isLoopActive('cursorMove')).toBe(false);
      expect(sfx.isLoopActive('swordFlying')).toBe(false);
    });
  });

  describe('setLoopVolume()', () => {
    it('does not throw for a non-running loop', () => {
      expect(() => sfx.setLoopVolume('wallAmbient', 0.5)).not.toThrow();
      expect(() => sfx.setLoopVolume('cursorMove', 0)).not.toThrow();
    });
  });

  describe('setRoomSize()', () => {
    it('accepts world-unit sizes without throwing', () => {
      expect(() => sfx.setRoomSize(80)).not.toThrow();
      expect(() => sfx.setRoomSize(800)).not.toThrow();
      expect(() => sfx.setRoomSize(15)).not.toThrow();
    });
  });

  describe('setListenerPose()', () => {
    it('does not throw without an AudioContext', () => {
      expect(() =>
        sfx.setListenerPose(0, 0, 0, 0, 0, -1, 0, 1, 0),
      ).not.toThrow();
    });

    it('accepts non-trivial camera pose values', () => {
      expect(() =>
        sfx.setListenerPose(1.5, 2.5, -3.5, 0.7, 0.1, -0.7, 0.0, 1.0, 0.0),
      ).not.toThrow();
    });
  });

  describe('setMasterVolume()', () => {
    it('clamps without throwing for any input', () => {
      expect(() => sfx.setMasterVolume(0)).not.toThrow();
      expect(() => sfx.setMasterVolume(1)).not.toThrow();
      expect(() => sfx.setMasterVolume(-1)).not.toThrow();
      expect(() => sfx.setMasterVolume(2)).not.toThrow();
    });
  });

  describe('getContext()', () => {
    it('returns null when no AudioContext has been created', () => {
      expect(sfx.getContext()).toBeNull();
    });
  });
});
