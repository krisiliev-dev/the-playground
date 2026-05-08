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
import { attenuateByDistance, triggerImpactShake } from '@/components/scene/cameraShake';
import { cursorWorldPosition } from '@/components/scene/cursorWorldPosition';
import { useWorldStore } from '@/store';
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

  // Camera shake from a remote actor's impact. Attenuate by distance
  // from the local player (cursor position ≈ camera position in 3rd-
  // person follow rig) to the impact point — close impacts shake
  // hard, far impacts shake softly, beyond `radius` doesn't shake.
  // Multiplies by event.intensity so server-clamped intensity values
  // flow through.
  useSceneEvent('camera_shake', (event) => {
    const viewer: [number, number, number] = [
      cursorWorldPosition.x,
      cursorWorldPosition.y,
      cursorWorldPosition.z,
    ];
    const falloff = attenuateByDistance(viewer, event.position, event.radius);
    if (falloff <= 0) {
      return;
    }
    // Pass through both the (attenuated) weight and the event's
    // own duration so admin-triggered events with custom
    // duration_ms actually shake for that long, instead of being
    // silently truncated to the local default.
    triggerImpactShake(
      performance.now() / 1000,
      falloff * event.intensity,
      event.duration_ms / 1000,
    );
  });

  // Admin-triggered kick (per ADR-009). When the kick is for
  // us, set the kicked flag so:
  //   - the WS reconnect loop bails (in useMultiplayerSync)
  //   - the KickedOverlay component renders fullscreen
  //   - leapTarget yanks the avatar through the back wall as
  //     a "kicked out into the abyss" punctuation
  useSceneEvent('kick_notification', (event) => {
    const localId = useWorldStore.getState().localPlayerId;
    if (!localId || event.target_actor_id !== localId) {
      return;
    }
    const reason = event.reason ?? null;
    useWorldStore.getState().setLocalPlayerKicked(true, reason);
    // Yank the avatar through the back wall: target a Z far
    // outside the cube. The existing leap pipeline handles
    // the smooth interpolation. ~1500 over a couple seconds
    // reads as "thrown into the void."
    useWorldStore.getState().setLeapTarget([0, 0, -1500]);
  });

  // Admin-triggered freeze (per ADR-009). Match target_actor_id
  // against our local player id; non-targeted receivers ignore.
  // The store flag drives input gating in CursorAvatar.
  useSceneEvent('frozen_status', (event) => {
    const localId = useWorldStore.getState().localPlayerId;
    if (!localId || event.target_actor_id !== localId) {
      return;
    }
    useWorldStore.getState().setLocalPlayerFrozen(event.frozen);
  });

  // Admin-triggered teleport (per ADR-009). The server fans
  // a `force_teleport` event to everyone with `target_actor_id`
  // set to the player being moved; non-targeted receivers
  // ignore it. We hand the position to the existing
  // `leapTarget` slice that CursorAvatar already consumes —
  // same path used for portal walk-through teleports, so no
  // new pipeline.
  useSceneEvent('force_teleport', (event) => {
    const localId = useWorldStore.getState().localPlayerId;
    if (!localId || event.target_actor_id !== localId) {
      return;
    }
    useWorldStore.getState().setLeapTarget(event.position);
  });

  return null;
}

/** Type-narrow the wire-format string into a known SfxId. */
export function isKnownSoundId(id: string): id is SfxId {
  return Object.prototype.hasOwnProperty.call(SFX, id);
}
