/**
 * World — the root 3D scene component.
 *
 * Composes the environment, lighting, player cursor, zone markers,
 * and navigation into a single scene graph. This is what gets rendered
 * inside the R3F Canvas.
 *
 * Multiplayer note: when we add remote players, they'll be rendered
 * here as additional CursorAvatar instances mapped from a "remotePlayers"
 * slice of the store. No structural changes needed.
 */

import { Fog } from 'three';
import { useThree } from '@react-three/fiber';
import { useEffect } from 'react';
import { useWorldStore } from '@/store';
import { BoxEnvironment } from './BoxEnvironment';
import { CursorAvatar } from './CursorAvatar';
import { ZoneMarker } from './ZoneMarker';
import { WorldLighting } from './WorldLighting';
import { NavigationController } from './NavigationController';

/**
 * Sets up fog on the scene. Separated into its own component
 * because scene-level properties need useThree() to access.
 */
function SceneFog(): null {
  const { scene } = useThree();
  const fog = useWorldStore((s) => s.environment.fog);

  useEffect(() => {
    scene.fog = new Fog(fog.color, fog.near, fog.far);
    return () => {
      scene.fog = null;
    };
  }, [scene, fog.color, fog.near, fog.far]);

  return null;
}

/**
 * The complete 3D world.
 * Drop this inside an R3F Canvas and everything works.
 */
export function World(): JSX.Element {
  const player = useWorldStore((s) => s.player);
  const zones = useWorldStore((s) => s.environment.zones);

  return (
    <>
      {/* Scene configuration */}
      <SceneFog />
      <WorldLighting />

      {/* Navigation system (invisible — just hooks into the frame loop) */}
      <NavigationController />

      {/* The box room */}
      <BoxEnvironment />

      {/* Zone markers — clickable navigation targets */}
      {zones.map((zone) => (
        <ZoneMarker key={zone.id} zone={zone} />
      ))}

      {/* Local player cursor */}
      <CursorAvatar
        position={player.position}
        rotation={player.rotation}
        color={player.cursorColor}
        isLocal
      />
    </>
  );
}
