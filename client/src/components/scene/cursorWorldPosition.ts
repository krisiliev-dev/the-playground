/**
 * Module-scoped Vector3 holding the cursor avatar's current world
 * position. Written once per frame by `CursorAvatar` (the source of
 * truth for the avatar's pose), read once per frame by
 * `InteractionController` (which uses it as the raycast ORIGIN
 * instead of the camera, so things between camera and cursor —
 * i.e. behind the cursor in view direction — don't intercept the
 * crosshair ray).
 *
 * Why module state instead of Zustand: this is per-frame data
 * shared between two render-loop consumers. Routing it through
 * the world store would force a Zustand subscription update each
 * frame and re-trigger any other subscriber that filters on
 * unrelated fields. A plain mutable Vector3 is the standard R3F
 * pattern for this — zero re-render cost, zero hook overhead.
 *
 * Defaults to (0, 0, 0). On the first frame before CursorAvatar
 * has written its position, the InteractionController would
 * raycast from world origin, which is a non-issue because
 * pre-reveal the controller is gated on `controlsDismissed` and
 * skips raycast entirely.
 */
import { Vector3 } from 'three';

export const cursorWorldPosition = new Vector3();
