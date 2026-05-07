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

  // Where OrbitControls aims its target. In multiplayer the
  // target is the local player's assigned section center, so
  // the camera looks at *their* patch of wall on connect /
  // reload. In single-player there's no slot, fall back to the
  // legacy "back wall center" target.
  const orbitTarget = useMemo<[number, number, number]>(() => {
    if (localPlayerId !== null && revealSlotIndex !== null) {
      const slot = getSpawnSlot(revealSlotIndex);
      return [slot.clickHit.point[0], slot.clickHit.point[1], slot.clickHit.point[2]];
    }
    return [0, 0, -360.01];
  }, [localPlayerId, revealSlotIndex]);

  // Pull the camera onto the section's normal axis so the
  // section sits centred in view, not off in a corner. Without
  // this, OrbitControls keeps the camera at its initial pose
  // and just retargets — which works for back-wall slots (the
  // default) but reads as a strange diagonal view for slots
  // on side / front walls.
  useEffect(() => {
    if (localPlayerId === null || revealSlotIndex === null) {
      return;
    }
    if (revealState !== 'idle') {
      return; // don't yank the camera mid-reveal
    }
    const slot = getSpawnSlot(revealSlotIndex);
    // Camera distance from the wall — roughly matches the
    // legacy 365-unit target offset so the framing reads the
    // same as before. Position is slot center pulled inward
    // along the wall normal.
    const BACK_OFF = 365;
    camera.position.set(
      slot.clickHit.point[0] + slot.clickHit.normal[0] * BACK_OFF,
      slot.clickHit.point[1] + slot.clickHit.normal[1] * BACK_OFF,
      slot.clickHit.point[2] + slot.clickHit.normal[2] * BACK_OFF,
    );
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
