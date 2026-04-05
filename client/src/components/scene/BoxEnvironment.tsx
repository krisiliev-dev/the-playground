/**
 * BoxEnvironment — the physical walls, floor, and ceiling of the world.
 *
 * Renders as an inverted box (normals facing inward) so the visitor
 * feels like they're inside a room. Uses simple geometry for performance.
 * The box dimensions come from the environment config in the store,
 * so they update live when the config changes.
 */

import { useWorldStore } from '@/store';

/**
 * Renders the interior walls of the world box.
 * Uses a standard BoxGeometry with material set to render on the back side,
 * which effectively inverts the normals so they face inward.
 */
export function BoxEnvironment(): JSX.Element {
  const dimensions = useWorldStore((s) => s.environment.dimensions);
  const ambientColor = useWorldStore((s) => s.environment.ambientColor);

  return (
    <mesh>
      <boxGeometry args={dimensions} />
      <meshStandardMaterial
        color={ambientColor}
        side={1} // THREE.BackSide — renders inside faces
        roughness={0.8}
        metalness={0.1}
      />
    </mesh>
  );
}
