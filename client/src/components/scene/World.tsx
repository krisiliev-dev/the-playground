/**
 * World — root scene component.
 *
 * Wraps everything that should "float" in a single group whose Y position
 * is driven by a slow sine. Sky and the cube get a gentle ease-in/ease-out
 * vertical bob — sine is naturally fast at the centre and slow at the
 * extremes, giving a "breathing" feel without easing math.
 */
import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type { Group } from 'three';
import { useWorldStore } from '@/store';
import { useIsTouchPrimary } from '@/utils';
import { BoxEnvironment } from './BoxEnvironment';
import { SkyBackground } from './SkyBackground';
import { RevealOrchestrator } from './reveal';
import { Haze3D } from './Haze3D';
import { OrbitControls } from '@react-three/drei';
import { SpatialAudioListener } from '../audio/SpatialAudioListener';
import { InteractionController } from './Interactable';
import { Portals } from './Portals';

/** Period in seconds for one full bob cycle (up + down). */
const FLOAT_PERIOD = 6;
/** Vertical amplitude in world units. */
const FLOAT_AMPLITUDE = 0.6;

export function World(): JSX.Element {
  const environment = useWorldStore((s) => s.environment);
  const revealState = useWorldStore((s) => s.revealState);
  const floatRef = useRef<Group>(null);
  const isTouch = useIsTouchPrimary();

  useFrame((state) => {
    if (!floatRef.current) {
      return;
    }
    const t = state.clock.elapsedTime;
    floatRef.current.position.y = Math.sin((t / FLOAT_PERIOD) * Math.PI * 2) * FLOAT_AMPLITUDE;
  });

  return (
    <>
      <SpatialAudioListener />
      <ambientLight color={environment.ambientColor} intensity={environment.ambientIntensity} />
      {/* Float group — only the cube walls bob. Sword/cursor/sky stay anchored
          to world space so they don't drift with the breathing motion. */}
      <group ref={floatRef}>
        <BoxEnvironment dimensions={environment.dimensions} />
      </group>
      <RevealOrchestrator />
      <InteractionController />
      <Portals />
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
