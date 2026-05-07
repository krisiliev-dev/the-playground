/**
 * SceneHost — swaps which `THREE.Scene` instance R3F renders to
 * canvas, based on `currentRoom` in the world store.
 *
 * R3F maintains the rendered scene at `state.scene`. The renderer's
 * default `gl.render(state.scene, state.camera)` call (and any
 * post-fx `EffectComposer` chain) uses that reference, so swapping
 * `state.scene` is the single source of truth for "which scene is
 * the player currently inside."
 *
 * This component doesn't own scene *contents* — those live in
 * `<CubeScene>` / `<AboutRoom>` etc. via R3F `createPortal`. It
 * only switches which one is the rendered "active" scene each time
 * `currentRoom` changes (null = cube, otherwise the matching room).
 */
import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { useWorldStore } from '@/store';
import { CURSOR_LAYER } from '@/components/scene/sceneLayers';
import { getScene, type SceneId } from './sceneRegistry';

/** Rooms that have a populated per-scene `THREE.Scene` (mounted via
 *  `createPortal` somewhere in the React tree). For rooms not in
 *  this set, SceneHost stays on the cube scene — the legacy
 *  world-space room rendering still applies, so the avatar sees
 *  the old room contents instead of a black canvas.
 *  Phase 3 has only About migrated; Projects + Writing land in a
 *  later phase. */
const MIGRATED_ROOMS = new Set<string>(['room-about']);

function sceneIdFor(currentRoom: string | null): SceneId {
  if (currentRoom && MIGRATED_ROOMS.has(currentRoom)) {
    return currentRoom as SceneId;
  }
  return 'cube';
}

export function SceneHost(): null {
  const set = useThree((s) => s.set);
  const camera = useThree((s) => s.camera);
  const invalidate = useThree((s) => s.invalidate);
  const currentRoom = useWorldStore((s) => s.currentRoom);

  // The cursor avatar mesh lives on CURSOR_LAYER. Enable it on
  // the main camera so the avatar renders alongside layer-0
  // scene content in any active scene.
  useEffect(() => {
    if (camera.layers && typeof camera.layers.enable === 'function') {
      camera.layers.enable(CURSOR_LAYER);
    }
  }, [camera]);

  useEffect(() => {
    const target = getScene(sceneIdFor(currentRoom));
    set({ scene: target });
    // `frameloop="demand"` only renders when invalidate is called.
    // The set above doesn't auto-invalidate, so kick the loop here
    // to make sure the new scene gets rendered immediately.
    invalidate();
  }, [currentRoom, set, invalidate]);

  return null;
}
