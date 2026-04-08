/**
 * BoxEnvironment — an inverted cube the user sits inside.
 *
 * Uses THREE.BackSide so the faces render inward, creating a room.
 * The GridMaterial applies a cyberpunk wireframe shader to the walls.
 */
import { BackSide } from 'three';
import type { Vector3Tuple } from 'three';
import { GridMaterial } from './GridMaterial';

interface BoxEnvironmentProps {
  dimensions: Vector3Tuple;
}

export function BoxEnvironment({ dimensions }: BoxEnvironmentProps): JSX.Element {
  return (
    <mesh>
      <boxGeometry args={dimensions} />
      <GridMaterial side={BackSide} />
    </mesh>
  );
}
