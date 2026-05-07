/**
 * Scene registry — owns one `THREE.Scene` instance per logical
 * location (cube interior, each portfolio room). Each scene has its
 * own coordinate space and contents; portal discs render the paired
 * scene into an FBO with a virtual camera positioned naturally in
 * that scene's *local* space, so there's no world-space surgery,
 * no Lengyel oblique clipping, and no cross-scene layer juggling.
 *
 * Module-level (not React) so multiple components can share the
 * same Scene instance — `<AboutRoom>` mounts its content into
 * `getScene('room-about')` via R3F's `createPortal`, and a
 * `<PortalDisc destinationSceneId="room-about">` looks up the same
 * Scene to render its FBO preview.
 *
 * The registry intentionally does NOT manage cameras or render
 * targets. Each `<PortalDisc>` owns its own FBO and virtual camera,
 * because those depend on the disc's geometry and the player's
 * relative position — not on the scene itself.
 */
import { Scene } from 'three';

export type SceneId = 'cube' | 'room-about' | 'room-projects' | 'room-writing';

const scenes = new Map<SceneId, Scene>();

export function getScene(id: SceneId): Scene {
  let s = scenes.get(id);
  if (!s) {
    s = new Scene();
    s.name = id;
    scenes.set(id, s);
  }
  return s;
}
