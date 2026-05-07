/**
 * Module-scoped Vector3 + Quaternion holding the cursor avatar's
 * current world pose. Written once per frame by `CursorAvatar`
 * (the source of truth for the avatar's pose), read once per
 * frame by:
 *   - `InteractionController` — uses `cursorWorldPosition` as
 *     the raycast ORIGIN instead of the camera, so things between
 *     camera and cursor (i.e. behind the cursor in view direction)
 *     don't intercept the crosshair ray.
 *   - `useMultiplayerSync` — reads both position + quaternion to
 *     send PlayerInput updates to the authoritative server.
 *
 * Why module state instead of Zustand: this is per-frame data
 * shared between two render-loop consumers. Routing it through
 * the world store would force a Zustand subscription update each
 * frame and re-trigger any other subscriber that filters on
 * unrelated fields. A plain mutable Vector3/Quaternion is the
 * standard R3F pattern for this — zero re-render cost, zero hook
 * overhead.
 *
 * Defaults to the identity pose (origin + no rotation). On the
 * first frame before CursorAvatar has written its pose, the
 * InteractionController would raycast from world origin and the
 * multiplayer sync would send identity — both are non-issues
 * because pre-reveal those subsystems are gated.
 */
import { Quaternion, Vector3 } from 'three';

export const cursorWorldPosition = new Vector3();
export const cursorWorldQuaternion = new Quaternion();
