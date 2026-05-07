/**
 * AboutRoom — self-contained scene for the About room.
 *
 * Currently a standalone room shell with no portal connecting it
 * back to the main cube — the previous portal architecture has
 * been ripped out and the next iteration will define how rooms
 * connect to the cube. The room geometry is preserved so we have
 * a destination to wire up once the new portal concept is in place.
 */
import { createPortal } from '@react-three/fiber';
import { BackSide } from 'three';
import { GridMaterial } from '@/components/scene/GridMaterial';
import { getScene } from '@/scenes/sceneRegistry';

const ROOM_SIZE: [number, number, number] = [400, 400, 400];
const HALF_DEPTH = ROOM_SIZE[2] / 2;
const ABOUT_COLOR = '#4169e1';

export function AboutRoom(): JSX.Element {
  const scene = getScene('room-about');

  return createPortal(
    <>
      <ambientLight color="#ffffff" intensity={0.6} />
      <mesh position={[0, 0, -HALF_DEPTH]}>
        <boxGeometry args={ROOM_SIZE} />
        <GridMaterial side={BackSide} gridColor={ABOUT_COLOR} />
      </mesh>
    </>,
    scene,
  );
}
