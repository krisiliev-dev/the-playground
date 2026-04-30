/**
 * Haze3D — translucent plane parented (each frame) to the camera so it
 * always sits just past the near plane, covering the FOV. Renders after
 * the rest of the scene (renderOrder 100) but before the cursor (which
 * uses renderOrder 999), so the cube/sword/sky/grid all read through
 * the haze while the cursor stays crisp on top.
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

const HAZE_DEPTH = 0.5;
/** Light blue-grey — the cube is already near-black, so a tint that
 *  matched it (#0a0a12) was effectively invisible. This brightens
 *  enough to read as a milky veil. */
const HAZE_COLOR = '#aabbdd';
const HAZE_OPACITY = 0.45;
const HAZE_RENDER_ORDER = 100;
/** Seconds to fully fade from click → impact.
 *  ARMED_TO_SWINGING (0.5) + SWINGING_TO_IMPACT (1.8) = 2.3s. */
const HAZE_FADE_DURATION = 2.3;

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
      opacity = HAZE_OPACITY * Math.max(0, 1 - elapsed / HAZE_FADE_DURATION);
    }

    const material = meshRef.current.material as MeshBasicMaterial;
    material.opacity = opacity;

    meshRef.current.position.copy(camera.position);
    meshRef.current.quaternion.copy(camera.quaternion);
    meshRef.current.translateZ(-HAZE_DEPTH);
  });

  return (
    <mesh ref={meshRef} renderOrder={HAZE_RENDER_ORDER}>
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
