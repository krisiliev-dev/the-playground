/**
 * WorldLighting — configures all lights in the 3D scene.
 *
 * Uses a combination of ambient light (base fill), a directional light
 * (primary "sun"), and point lights at zone positions for visual interest.
 * All values read from the environment config for live-editability.
 */

import { useWorldStore } from '@/store';

export function WorldLighting(): JSX.Element {
  const ambientColor = useWorldStore((s) => s.environment.ambientColor);
  const ambientIntensity = useWorldStore((s) => s.environment.ambientIntensity);

  return (
    <>
      {/* Base ambient fill — prevents pure black shadows */}
      <ambientLight color={ambientColor} intensity={ambientIntensity} />

      {/* Primary directional light — soft top-down illumination */}
      <directionalLight
        position={[10, 1, 10]}
        intensity={10}
        color="#e0e0ff"
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
      />

      {/* Secondary fill from below — prevents the floor from being too dark */}
      <directionalLight
        position={[25, 1, 25]}
        intensity={10}
        color="#ff99ae"
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
      />
    </>
  );
}
