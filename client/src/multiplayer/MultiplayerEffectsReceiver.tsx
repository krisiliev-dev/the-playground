/**
 * Listens for inbound `SceneEvent`s from other players and plays
 * them locally. The mirror image of the `xxxWorld` wrapper APIs:
 * those broadcast effects out, this component receives effects in.
 *
 * Mounted once near the App root whenever multiplayer is enabled.
 * Renders nothing; pure subscription host.
 *
 * Validation note: the wire `sound_id` is a free string, but the
 * SfxManager only knows about ids in `SFX`. We `in`-guard before
 * playback so a buggy or hostile sender can't crash playback by
 * pointing at an unknown cue. Unknown ids are dropped silently —
 * receiver-side fast-fail beats logging spam from a misbehaving
 * client.
 */
import { sfx } from '@/components/audio/SfxManager';
import { SFX, type SfxId } from '@/components/audio/sfxManifest';
import { useSceneEvent } from './sceneEvents';

export function MultiplayerEffectsReceiver(): null {
  useSceneEvent('audio', (event) => {
    if (!isKnownSoundId(event.sound_id)) {
      return;
    }
    void sfx.play(event.sound_id, {
      position: event.position
        ? { x: event.position[0], y: event.position[1], z: event.position[2] }
        : undefined,
      volumeMultiplier: event.volume,
    });
  });

  return null;
}

/** Type-narrow the wire-format string into a known SfxId. */
export function isKnownSoundId(id: string): id is SfxId {
  return Object.prototype.hasOwnProperty.call(SFX, id);
}
