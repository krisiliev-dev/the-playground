/**
 * World — root scene component.
 *
 * Each visible cube in the world is a `<RoomBox>` declared via
 * `routes.ts`. `RouteBoxes` walks the route registry and emits one
 * RoomBox per route that has a `box` config. Each box manages its
 * own bob — there's no World-level float group anymore; the
 * breathing motion is a per-box characteristic.
 */
import { useEffect, useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import { useWorldStore } from '@/store';
import { useIsTouchPrimary } from '@/utils';
import { SkyBackground } from './SkyBackground';
import { RevealOrchestrator } from './reveal';
import { Haze3D } from './Haze3D';
import { OrbitControls } from '@react-three/drei';
import { getSpawnSlot } from '@/content/spawnSlots';
import { SpatialAudioListener } from '../audio/SpatialAudioListener';
import { InteractionController } from './Interactable';
import { RouteBoxes } from './RouteBoxes';
import { RouteContent3D } from './RouteContent3D';
import { Portals } from './portal/Portals';
import { RemotePlayers } from './RemotePlayers';
import { RemotePlayerReveals } from '@/multiplayer/RemotePlayerReveals';

export function World(): JSX.Element {
  const environment = useWorldStore((s) => s.environment);
  const revealState = useWorldStore((s) => s.revealState);
  const localPlayerId = useWorldStore((s) => s.localPlayerId);
  const revealSlotIndex = useWorldStore((s) => s.revealSlotIndex);
  const isTouch = useIsTouchPrimary();
  const { camera } = useThree();

  // Camera framing: match the legacy single-player setup but
  // anchored to the player's slot. Original layout was:
  //   camera position [0, 0, -360]
  //   OrbitControls target [0, 0, -360.01]
  // i.e. camera 40 units inward from the back wall (cube is 800
  // wide, half=400; back wall at z=-400), with target 0.01
  // units past the camera in the look direction. The 0.01-unit
  // orbit radius makes OrbitControls a "look-around in place"
  // rig rather than a true orbital camera — preserving that
  // micro-radius is what keeps the user from drifting through
  // the wall while rotating their view.
  //
  // Generalised:
  //   camera = slot.point + 40 * slot.normal
  //   target = slot.point + 39.99 * slot.normal
  //          = camera - 0.01 * slot.normal
  // For back-wall slot 0 (slot.point on -Z wall, normal +Z) the
  // numbers reduce exactly to the original (0, 0, -360) /
  // (0, 0, -360.01) framing.
  const CAMERA_BACK_OFF = 40;
  const TARGET_INSET = 0.01;

  const orbitTarget = useMemo<[number, number, number]>(() => {
    if (localPlayerId !== null && revealSlotIndex !== null) {
      const slot = getSpawnSlot(revealSlotIndex);
      const t = CAMERA_BACK_OFF - TARGET_INSET;
      return [
        slot.clickHit.point[0] + slot.clickHit.normal[0] * t,
        slot.clickHit.point[1] + slot.clickHit.normal[1] * t,
        slot.clickHit.point[2] + slot.clickHit.normal[2] * t,
      ];
    }
    return [0, 0, -360.01];
  }, [localPlayerId, revealSlotIndex]);

  // Reposition the camera onto the section's normal axis so
  // OrbitControls doesn't end up with a weird off-axis radius
  // when the slot is on a non-back wall. Doing this in a
  // useEffect (rather than a Canvas prop) is necessary because
  // the slot is computed *after* mount.
  useEffect(() => {
    if (localPlayerId === null || revealSlotIndex === null) {
      return;
    }
    if (revealState !== 'idle') {
      return; // don't yank the camera mid-reveal
    }
    const slot = getSpawnSlot(revealSlotIndex);
    camera.position.set(
      slot.clickHit.point[0] + slot.clickHit.normal[0] * CAMERA_BACK_OFF,
      slot.clickHit.point[1] + slot.clickHit.normal[1] * CAMERA_BACK_OFF,
      slot.clickHit.point[2] + slot.clickHit.normal[2] * CAMERA_BACK_OFF,
    );
    // Look toward the wall — i.e. anti-normal direction. Using
    // a point inside the wall (slot.point) as the lookAt target
    // keeps the camera direction stable.
    camera.lookAt(
      slot.clickHit.point[0],
      slot.clickHit.point[1],
      slot.clickHit.point[2],
    );
    camera.updateMatrixWorld();
  }, [localPlayerId, revealSlotIndex, revealState, camera]);

  return (
    <>
      <SpatialAudioListener />
      <ambientLight color={environment.ambientColor} intensity={environment.ambientIntensity} />
      <RouteBoxes />
      <RouteContent3D />
      <Portals />
      <RemotePlayers />
      <RemotePlayerReveals />
      <RevealOrchestrator />
      <InteractionController />
      <SkyBackground dimensions={environment.dimensions} />
      {/* Haze sits between scene and cursor: scene < haze < cursor in
          renderOrder. */}
      <Haze3D />
      {/* CursorAvatar moved out of World/ShakeGroup so the cursor doesn't
          inherit the camera-shake offset on each sword's wall impact. */}
      {/* OrbitControls owns the camera in idle mode — once the user
          clicks, CursorAvatar takes over with the 3rd-person follow rig.
          On touch we disable rotation only (`enableRotate={false}`)
          rather than the whole controls, so OrbitControls still applies
          its `target` lookAt each frame and the camera correctly faces
          the back wall. Setting `enabled={false}` on mobile turned out
          to skip the lookAt and leave the camera in its default
          orientation (looking at the world origin from z=-360, which
          points the user *away* from the back wall). */}
      {revealState === 'idle' && (
        <OrbitControls
          enableZoom={false}
          enablePan={false}
          enableRotate={!isTouch}
          target={orbitTarget}
        />
      )}
    </>
  );
}
