/**
 * Walk-through detection + activation for the in-world Portal disc.
 *
 * The avatar's wall-margin clamp keeps `avatarPos` ≥ 8 units from
 * any cube wall, so the trigger band sits just past that clamp at
 * `WALK_THROUGH_THRESHOLD = 9` — the avatar enters it when they
 * walk up to the formation wall and the clamp pins them. The
 * detection then projects the avatar onto the disc plane, checks
 * the projection is inside the disc radius, and computes which
 * quadrant the projection lies in (NE/NW/SW/SE).
 *
 * Activation is *instant* — Portal-game style: walking through a
 * pie warps you to its destination with no camera lerp. (Click is
 * the cinematic alternative; that path goes through the
 * `portalTransit` slice in the store and drives PortalTransition's
 * dolly. Walk-through skips both and writes pendingNavigation
 * directly.)
 *
 * The quadrant index is the same as the Portals.tsx layout:
 *   0 = NE = About    (top-right)
 *   1 = NW = Projects (top-left)
 *   2 = SW = Writing  (bottom-left)
 *   3 = SE = Simple Experience (bottom-right) — toggles documentMode
 */
import { Quaternion, Vector3 } from 'three';
import { useWorldStore, type ClickHit } from '@/store';

/** Disc radius in world units. Must match Portals.tsx PORTAL_RADIUS. */
export const PORTAL_RADIUS_FOR_WALKTHROUGH = 10;

/** Perpendicular distance band along clickHit.normal in which a
 *  walk-through fires. The avatar's wall-margin clamp pins it at
 *  ≥8 units from any wall, so 9 leaves a 1-unit slot right at the
 *  clamp where the trigger fires. */
export const WALK_THROUGH_THRESHOLD = 9;

/** Routes for each quadrant. SE (index 3) is null because that
 *  quadrant flips documentMode rather than navigating. Order MUST
 *  match the SECTION_PIES + SE_PIE thetaStart layout in Portals.tsx
 *  (NE/NW/SW/SE, counter-clockwise from +X). */
const QUADRANT_PATHS: ReadonlyArray<string | null> = ['/about', '/projects', '/writing', null];

const SCRATCH_HIT_POINT = new Vector3();
const SCRATCH_NORMAL = new Vector3();
const SCRATCH_TO_AVATAR = new Vector3();
const SCRATCH_PROJECTED = new Vector3();
const SCRATCH_LOCAL = new Vector3();
const SCRATCH_QUAT = new Quaternion();
const SCRATCH_UP = new Vector3(0, 0, 1);

/**
 * Detects whether the given avatar position falls inside the
 * walk-through trigger zone of the portal disc, and if so returns
 * the quadrant index it's projected into. Returns `null` if the
 * avatar is outside the band, outside the disc radius, or behind
 * the wall.
 */
export function detectPortalWalkthrough(
  avatarPos: Vector3,
  clickHit: ClickHit,
): { quadrant: number } | null {
  SCRATCH_HIT_POINT.set(...clickHit.point);
  SCRATCH_NORMAL.set(...clickHit.normal);

  // Perpendicular distance from the avatar to the wall plane.
  // Positive = on cube interior side, 0 = on the wall, negative =
  // behind the wall (defensive — shouldn't happen with clamping).
  SCRATCH_TO_AVATAR.subVectors(avatarPos, SCRATCH_HIT_POINT);
  const distToPlane = SCRATCH_TO_AVATAR.dot(SCRATCH_NORMAL);
  if (distToPlane < 0 || distToPlane > WALK_THROUGH_THRESHOLD) {
    return null;
  }

  // Project the avatar onto the wall plane. After subtracting the
  // normal-direction component, SCRATCH_PROJECTED holds the
  // displacement from disc centre along the wall plane.
  SCRATCH_PROJECTED.copy(SCRATCH_TO_AVATAR).addScaledVector(SCRATCH_NORMAL, -distToPlane);
  if (SCRATCH_PROJECTED.length() > PORTAL_RADIUS_FOR_WALKTHROUGH) {
    return null;
  }

  // Express the projection in the disc's local 2D frame so we can
  // pull a quadrant from atan2(y, x). The disc's quaternion rotates
  // its local +Z onto clickHit.normal; the inverse rotation maps
  // the world projection back into local +X/+Y.
  SCRATCH_QUAT.setFromUnitVectors(SCRATCH_UP, SCRATCH_NORMAL).invert();
  SCRATCH_LOCAL.copy(SCRATCH_PROJECTED).applyQuaternion(SCRATCH_QUAT);

  const angle = Math.atan2(SCRATCH_LOCAL.y, SCRATCH_LOCAL.x);
  const angleNormalized = (angle + 2 * Math.PI) % (2 * Math.PI);
  const quadrant = Math.floor(angleNormalized / (Math.PI / 2)) % 4;
  return { quadrant };
}

/**
 * Maps a quadrant index to a store action and dispatches it.
 * Section quadrants navigate via `pendingNavigation` (skipping the
 * camera dolly that the click path uses); SE quadrant toggles
 * `documentMode`.
 */
export function activatePortalQuadrant(quadrant: number): void {
  // Out-of-range quadrant is a programmer error from the detector;
  // bail rather than corrupt store state.
  if (quadrant < 0 || quadrant >= QUADRANT_PATHS.length) {
    return;
  }
  const path = QUADRANT_PATHS[quadrant];
  const state = useWorldStore.getState();
  if (path === null || path === undefined) {
    state.setDocumentMode(true);
    return;
  }
  state.setPendingNavigation(path);
}
