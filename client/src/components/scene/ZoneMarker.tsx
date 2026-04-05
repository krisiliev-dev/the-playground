/**
 * ZoneMarker — a clickable 3D element that marks a navigable zone.
 *
 * When clicked, it tells the store to navigate to that zone, which
 * triggers the camera to smoothly fly there. Uses drei's Html component
 * to render a DOM label anchored to a 3D position, giving us crisp
 * text regardless of camera distance.
 */

import { useState } from 'react';
import { Html } from '@react-three/drei';
import { useWorldStore } from '@/store';
import type { WorldZone } from '@/types';

interface ZoneMarkerProps {
  readonly zone: WorldZone;
}

/**
 * Renders a floating label at the zone's position.
 * Clicking it navigates the player to that zone.
 */
export function ZoneMarker({ zone }: ZoneMarkerProps): JSX.Element {
  const setActiveZone = useWorldStore((s) => s.setActiveZone);
  const [hovered, setHovered] = useState(false);

  const handleClick = (): void => {
    setActiveZone(zone.id);
  };

  return (
    <group position={zone.position}>
      {/* Invisible click target — larger than the visual marker */}
      <mesh
        onClick={handleClick}
        onPointerOver={() => setHovered(true)}
        onPointerOut={() => setHovered(false)}
      >
        <sphereGeometry args={[1.5, 8, 8]} />
        <meshBasicMaterial transparent opacity={0} />
      </mesh>

      {/* Visible marker — a glowing sphere */}
      <mesh>
        <sphereGeometry args={[0.3, 16, 16]} />
        <meshStandardMaterial
          color={hovered ? '#ffffff' : '#00ff88'}
          emissive={hovered ? '#ffffff' : '#00ff88'}
          emissiveIntensity={hovered ? 1 : 0.4}
        />
      </mesh>

      {/* HTML label — always faces the camera, crisp at any distance */}
      <Html
        center
        distanceFactor={10}
        style={{
          color: 'white',
          fontSize: '14px',
          fontFamily: 'monospace',
          fontWeight: 'bold',
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          whiteSpace: 'nowrap',
          userSelect: 'none',
          pointerEvents: 'none',
          textShadow: '0 0 10px rgba(0, 255, 136, 0.5)',
          transform: 'translateY(-24px)',
        }}
      >
        {zone.label}
      </Html>
    </group>
  );
}
