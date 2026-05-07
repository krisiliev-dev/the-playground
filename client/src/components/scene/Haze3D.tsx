/**
 * Haze3D — translucent plane parented (each frame) to the camera so it
 * always sits just past the near plane, covering the FOV. Renders in
 * the ATMOSPHERIC band (after world geometry, before cursor) so the
 * cube/sword/sky/grid all read through the haze while the cursor
 * stays crisp on top. See `renderOrder.ts` for the band layout.
 *
 * Fade behaviour: full opacity while idle. The moment the user clicks
 * (revealState leaves 'idle'), opacity linearly fades to 0 over
 * HAZE_FADE_DURATION seconds — synced to land at zero exactly when the
 * sword hits the wall (impact state).
 */
import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import type { Mesh, MeshBasicMaterial } from 'three';
import { useWorldStore } from '@/store';
import { HAZE_FADE_DURATION_S } from './reveal/constants';
import { RENDER_ORDER_HAZE } from './renderOrder';

const HAZE_DEPTH = 0.5;
/** Light blue-grey — the cube is already near-black, so a tint that
 *  matched it (#0a0a12) was effectively invisible. This brightens
 *  enough to read as a milky veil. */
const HAZE_COLOR = '#aabbdd';
const HAZE_OPACITY = 0.45;

export function Haze3D(): JSX.Element {
  const meshRef = useRef<Mesh>(null);
  const { camera } = useThree();

  const revealState = useWorldStore((s) => s.revealState);
  const fadeStart = useRef<number | null>(null);

  useFrame((state) => {
    if (!meshRef.current) {
      return;
    }

    // Track when the fade should begin (transition out of idle).
    if (revealState === 'idle') {
      fadeStart.current = null;
    } else if (fadeStart.current === null) {
      fadeStart.current = state.clock.elapsedTime;
    }

    // Linear fade from HAZE_OPACITY → 0 over HAZE_FADE_DURATION seconds.
    let opacity = HAZE_OPACITY;
    if (fadeStart.current !== null) {
      const elapsed = state.clock.elapsedTime - fadeStart.current;
      opacity = HAZE_OPACITY * Math.max(0, 1 - elapsed / HAZE_FADE_DURATION_S);
    }

    const material = meshRef.current.material as MeshBasicMaterial;
    material.opacity = opacity;

    meshRef.current.position.copy(camera.position);
    meshRef.current.quaternion.copy(camera.quaternion);
    meshRef.current.translateZ(-HAZE_DEPTH);
  });

  return (
    <mesh ref={meshRef} renderOrder={RENDER_ORDER_HAZE}>
      {/* Sized comfortably larger than the FOV at HAZE_DEPTH for any
          reasonable aspect ratio. The camera frustum crops the rest. */}
      <planeGeometry args={[4, 4]} />
      <meshBasicMaterial
        color={HAZE_COLOR}
        transparent
        opacity={HAZE_OPACITY}
        depthTest={false}
        depthWrite={false}
      />
    </mesh>
  );
}
