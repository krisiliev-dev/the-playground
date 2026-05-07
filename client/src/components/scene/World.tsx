/**
 * World — root scene component.
 *
 * Each visible cube in the world is a `<RoomBox>` declared via
 * `routes.ts`. `RouteBoxes` walks the route registry and emits one
 * RoomBox per route that has a `box` config. Each box manages its
 * own bob — there's no World-level float group anymore; the
 * breathing motion is a per-box characteristic.
 */
import { useWorldStore } from '@/store';
import { useIsTouchPrimary } from '@/utils';
import { SkyBackground } from './SkyBackground';
import { RevealOrchestrator } from './reveal';
import { Haze3D } from './Haze3D';
import { OrbitControls } from '@react-three/drei';
import { SpatialAudioListener } from '../audio/SpatialAudioListener';
import { InteractionController } from './Interactable';
import { RouteBoxes } from './RouteBoxes';
import { RouteContent3D } from './RouteContent3D';
import { Portals } from './portal/Portals';

export function World(): JSX.Element {
  const environment = useWorldStore((s) => s.environment);
  const revealState = useWorldStore((s) => s.revealState);
  const isTouch = useIsTouchPrimary();

  return (
    <>
      <SpatialAudioListener />
      <ambientLight color={environment.ambientColor} intensity={environment.ambientIntensity} />
      <RouteBoxes />
      <RouteContent3D />
      <Portals />
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
          target={[0, 0, -360.01]}
        />
      )}
    </>
  );
}
