/**
 * Manifest validation — these tests pin the *shape* of every cue
 * entry so a typo in a file path or an out-of-range volume gets
 * caught at CI time rather than at audition time. They don't test
 * playback (that's SfxManager's job and needs a real AudioContext);
 * they test the data contract between the manifest and the manager.
 */
import { describe, it, expect } from 'vitest';
import { SFX, type SfxEntry, type SfxId } from '@/components/audio/sfxManifest';

const REQUIRED_CUES: SfxId[] = [
  'wallAmbient',
  'uiClick',
  'mouseDown',
  'mouseUp',
  'spawnFlash',
  'swordFlying',
  'impactRumble',
  'swordSlam',
  'cursorMove',
];

describe('sfxManifest', () => {
  it('exports every cue the rest of the app depends on', () => {
    REQUIRED_CUES.forEach((id) => {
      expect(SFX).toHaveProperty(id);
    });
  });

  describe.each(Object.entries(SFX) as Array<[SfxId, SfxEntry]>)(
    'cue: %s',
    (_id, entry) => {
      it('has a non-empty variants array', () => {
        expect(Array.isArray(entry.variants)).toBe(true);
        expect(entry.variants.length).toBeGreaterThan(0);
      });

      it('every variant URL is rooted at /audio/', () => {
        entry.variants.forEach((url) => {
          expect(url.startsWith('/audio/')).toBe(true);
        });
      });

      it('volume is positive when defined', () => {
        if (entry.volume !== undefined) {
          expect(entry.volume).toBeGreaterThan(0);
        }
      });

      it('maxDurationMs is positive when defined', () => {
        if (entry.maxDurationMs !== undefined) {
          expect(entry.maxDurationMs).toBeGreaterThan(0);
        }
      });

      it('spatial config has positive distances when defined', () => {
        if (entry.spatial) {
          if (entry.spatial.refDistance !== undefined) {
            expect(entry.spatial.refDistance).toBeGreaterThan(0);
          }
          if (entry.spatial.maxDistance !== undefined) {
            expect(entry.spatial.maxDistance).toBeGreaterThan(0);
          }
          if (entry.spatial.rolloffFactor !== undefined) {
            expect(entry.spatial.rolloffFactor).toBeGreaterThanOrEqual(0);
          }
        }
      });

      it('reverb.wet is in [0, 1] when defined', () => {
        if (entry.reverb?.wet !== undefined) {
          expect(entry.reverb.wet).toBeGreaterThanOrEqual(0);
          expect(entry.reverb.wet).toBeLessThanOrEqual(1);
        }
      });

      it('saturate is in [0, 1] when defined', () => {
        if (entry.effects?.saturate !== undefined) {
          expect(entry.effects.saturate).toBeGreaterThanOrEqual(0);
          expect(entry.effects.saturate).toBeLessThanOrEqual(1);
        }
      });

      it('compressor config is structurally valid when defined', () => {
        const c = entry.effects?.compress;
        if (c && typeof c === 'object') {
          if (c.ratio !== undefined) {
            expect(c.ratio).toBeGreaterThanOrEqual(1);
          }
          if (c.attack !== undefined) {
            expect(c.attack).toBeGreaterThanOrEqual(0);
          }
          if (c.release !== undefined) {
            expect(c.release).toBeGreaterThanOrEqual(0);
          }
        }
      });
    },
    // `_id` is unused at the call-site but referenced by `describe.each`
    // via the `'cue: %s'` template — keeps failure messages identifying
    // which cue broke.
  );

  it('loops are flagged correctly for cues that need stop()-control', () => {
    // Widen via SfxEntry — `as const satisfies` on the manifest
    // narrows each entry to its exact literal shape (which omits
    // absent optional keys), so reading `entry.loop` requires the
    // wider interface.
    const loopCues: SfxId[] = ['wallAmbient', 'swordFlying', 'cursorMove'];
    loopCues.forEach((id) => {
      const entry: SfxEntry = SFX[id];
      expect(entry.loop).toBe(true);
    });
  });

  it('one-shot cues do not have loop=true', () => {
    const oneShotCues: SfxId[] = [
      'uiClick',
      'mouseDown',
      'mouseUp',
      'spawnFlash',
      'swordSlam',
      'impactRumble',
    ];
    oneShotCues.forEach((id) => {
      const entry: SfxEntry = SFX[id];
      expect(entry.loop).toBeFalsy();
    });
  });
});
