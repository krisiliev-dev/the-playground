/**
 * CubeScene — the playground cube as its own `THREE.Scene`.
 *
 * Mounts every child via R3F's `createPortal` into
 * `getScene('cube')`. That scene is what `SceneHost` swaps
 * `state.scene` to whenever `currentRoom === null`. From inside
 * any other room, the cube is still in memory but invisible to the
 * canvas — `<PortalDisc destinationSceneId="cube">` in a room scene
 * renders it through its own RTT to give the room→cube window
 * effect.
 *
 * The wrapper accepts arbitrary children so the existing scene
 * composition (BoxEnvironment, Portals, Rooms, Sky, Haze, reveal,
 * cursor avatar, etc.) can stay where it is — we only change
 * *which scene* it lives in.
 */
import type { ReactNode } from 'react';
import { createPortal } from '@react-three/fiber';
import { getScene } from './sceneRegistry';

interface CubeSceneProps {
  children: ReactNode;
}

export function CubeScene({ children }: CubeSceneProps): JSX.Element {
  return createPortal(<>{children}</>, getScene('cube'));
}
