/**
 * CursorAvatar — renders a player as a 3D cursor in the world.
 *
 * Currently renders the local player only. When multiplayer is added,
 * this same component will be instanced for each remote player — the
 * only change will be where the position/rotation props come from
 * (local state vs. WebSocket updates).
 *
 * The cursor design is intentionally simple: a cone (like a mouse pointer)
 * with a subtle glow. This can be upgraded to a custom glTF model later.
 */

import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type { Mesh } from 'three';

interface CursorAvatarProps {
  /** World-space position [x, y, z]. */
  readonly position: [number, number, number];
  /** Euler rotation [x, y, z] in radians. */
  readonly rotation: [number, number, number];
  /** Cursor color (hex string). */
  readonly color: string;
  /** Whether this is the local player (adds subtle animation). */
  readonly isLocal?: boolean;
}

/**
 * A 3D cursor that represents a visitor in the world.
 * The local player's cursor has a gentle floating animation.
 */
export function CursorAvatar({
  position,
  rotation,
  color,
  isLocal = false,
}: CursorAvatarProps): JSX.Element {
  const meshRef = useRef<Mesh>(null);

  useFrame((_, delta) => {
    if (!meshRef.current || !isLocal) {
      return;
    }
    // Gentle bobbing animation for the local cursor
    meshRef.current.position.y += Math.sin(Date.now() * 0.003) * delta * 0.1;
  });

  return (
    <group position={position} rotation={rotation}>
      {/* Main cursor body — a cone pointing forward */}
      <mesh ref={meshRef} rotation={[Math.PI / 2, 0, 0]}>
        <coneGeometry args={[0.15, 0.4, 4]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={isLocal ? 0.5 : 0.2}
          roughness={0.3}
          metalness={0.7}
        />
      </mesh>

      {/* Point light so the cursor illuminates nearby surfaces */}
      {isLocal && (
        <pointLight color={color} intensity={0.5} distance={3} decay={2} />
      )}
    </group>
  );
}
