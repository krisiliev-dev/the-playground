/**
 * InteractableTestCube — a placeholder interactable to verify the
 * crosshair → highlight → click → punch + audio flow end-to-end.
 *
 * Sits at a fixed location in the cube's front-half so the avatar
 * can wander up to it. On hover (crosshair in range), the material
 * pulses an emissive cyan glow and the cube scales up slightly. On
 * click, the cube spins by 90° on its Y axis as visible feedback —
 * the audio + avatar punch are handled centrally by
 * InteractionController, so this component only owns the
 * cube's *own* visual response.
 */
import { useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import type { MeshStandardMaterial } from 'three';
import { useInteractable } from './Interactable';

const HOVER_EMISSIVE_INTENSITY = 1.2;
const PRESS_EMISSIVE_INTENSITY = 2.4;
const HOVER_SCALE = 1.08;
const PRESS_SCALE = 0.92;
const SCALE_LERP_RATE = 12;
const SPIN_PER_CLICK = Math.PI / 2;
const SPIN_LERP_RATE = 14;

export function InteractableTestCube(): JSX.Element {
  const [targetSpinY, setTargetSpinY] = useState(0);

  const { ref, isHovered, isPressed } = useInteractable({
    id: 'test-cube',
    onInteract: () => {
      setTargetSpinY((prev) => prev + SPIN_PER_CLICK);
    },
  });

  // Smoothly lerp scale and Y-rotation toward their targets each frame.
  // Using lerp (not snap) so the click feedback reads as motion, not a
  // jarring frame-perfect snap — and so hover-out → hover-in flicker
  // doesn't make the highlight twitchy.
  const renderedScale = useRef(1);
  const renderedSpinY = useRef(0);
  const matRef = useRef<MeshStandardMaterial>(null);

  useFrame((_state, delta) => {
    const mesh = ref.current;
    if (!mesh) {
      return;
    }
    // Pressed > hovered > idle. Press squashes the cube slightly
    // (PRESS_SCALE < 1) so the user gets a "the cursor is touching me"
    // affordance — the cube feels poked. Hover puffs it up.
    const targetScale = isPressed ? PRESS_SCALE : isHovered ? HOVER_SCALE : 1;
    const k = 1 - Math.exp(-SCALE_LERP_RATE * delta);
    renderedScale.current += (targetScale - renderedScale.current) * k;
    mesh.scale.setScalar(renderedScale.current);

    const sk = 1 - Math.exp(-SPIN_LERP_RATE * delta);
    renderedSpinY.current += (targetSpinY - renderedSpinY.current) * sk;
    mesh.rotation.y = renderedSpinY.current;

    const mat = matRef.current;
    if (mat) {
      mat.emissiveIntensity = isPressed
        ? PRESS_EMISSIVE_INTENSITY
        : isHovered
          ? HOVER_EMISSIVE_INTENSITY
          : 0;
    }
  });

  return (
    <mesh ref={ref} position={[12, 0, -50]} castShadow>
      <boxGeometry args={[6, 6, 6]} />
      <meshStandardMaterial
        ref={matRef}
        color="#1a3a3a"
        emissive="#00ffcc"
        emissiveIntensity={0}
        metalness={0.4}
        roughness={0.3}
      />
    </mesh>
  );
}
