/**
 * Route resolution: given a position, return the canonical path of
 * the deepest registered route whose bbox contains that position.
 *
 * Two entry points:
 *
 *   - `routeForLocalPosition` — pure, takes a position **in the
 *     cube's local frame**. The function bboxes are authored in this
 *     frame so this is the natural spatial test.
 *
 *   - `routeForAvatar` — takes the avatar's **world** position and
 *     the current `time` (seconds), subtracts the cube's bob offset,
 *     then delegates to `routeForLocalPosition`. This is the entry
 *     point the per-frame routing loop calls.
 *
 * Resolution rule: "deepest containing bbox wins." If multiple
 * registered routes contain the position, the one with the highest
 * tree depth (most specific nesting) is returned. If none contain
 * it, the function returns `'/'` — the implicit root.
 */
import type { Vector3Tuple } from 'three';
import type { AABB, BobConfig, FlatRoute } from './routes';
import { floatOffset } from '@/components/scene/floatBob';

/** Inclusive AABB containment test. */
export function aabbContains(bbox: AABB, p: Vector3Tuple): boolean {
  return (
    p[0] >= bbox.min[0] &&
    p[0] <= bbox.max[0] &&
    p[1] >= bbox.min[1] &&
    p[1] <= bbox.max[1] &&
    p[2] >= bbox.min[2] &&
    p[2] <= bbox.max[2]
  );
}

/**
 * Pure spatial lookup — find the deepest route whose bbox contains
 * `localPos` (in the cube's local frame). Returns `'/'` if no route
 * matches. Linear scan; the registered route count is small (~10s)
 * so this is cheap to call every frame.
 */
export function routeForLocalPosition(
  localPos: Vector3Tuple,
  flatRoutes: ReadonlyArray<FlatRoute>,
): string {
  let bestPath = '/';
  let bestDepth = -1;
  for (const fr of flatRoutes) {
    if (!aabbContains(fr.route.bounds, localPos)) {
      continue;
    }
    if (fr.depth > bestDepth) {
      bestDepth = fr.depth;
      bestPath = fr.route.path;
    }
  }
  return bestPath;
}

/**
 * Pure spatial lookup for the **clamp** route: the deepest route
 * whose bbox contains `localPos` AND that has `box.clamp.enabled`.
 * Routes without an enabled clamp are skipped, so a nested
 * non-clamping route (e.g. `/about/education` declared as a
 * walkable sub-region of `/about`) inherits its ancestor's clamp.
 * Returns null if no clamping route contains the position — caller
 * leaves the avatar unclamped.
 */
export function clampRouteForLocalPosition(
  localPos: Vector3Tuple,
  flatRoutes: ReadonlyArray<FlatRoute>,
): FlatRoute | null {
  let best: FlatRoute | null = null;
  for (const fr of flatRoutes) {
    if (!fr.route.box?.clamp?.enabled) {
      continue;
    }
    if (!aabbContains(fr.route.bounds, localPos)) {
      continue;
    }
    if (!best || fr.depth > best.depth) {
      best = fr;
    }
  }
  return best;
}

/**
 * Convert the avatar's world position into the cube's local frame
 * by subtracting the float bob, then resolve the route. Single
 * function the per-frame routing loop calls.
 *
 * `bob` is the bob config of the box the avatar lives inside (in
 * practice, the main cube — the only currently-bobbing box). Pass
 * `undefined` for a non-bobbing world. Explicit parameter (rather
 * than a hidden global) so the routing pipeline is honest about
 * which frame it's converting to.
 */
export function routeForAvatar(
  avatarWorldPos: Vector3Tuple,
  time: number,
  flatRoutes: ReadonlyArray<FlatRoute>,
  bob: BobConfig | undefined,
): string {
  const offset = floatOffset(time, bob);
  const localPos: Vector3Tuple = [avatarWorldPos[0], avatarWorldPos[1] - offset, avatarWorldPos[2]];
  return routeForLocalPosition(localPos, flatRoutes);
}

/**
 * Reverse of the world-→-local transform: given a route's
 * cube-local entry point and the current `time`, return the
 * world-space position the avatar should be placed at. Used when a
 * URL change (deep link, browser back/forward) seeds the avatar
 * inside the matching bbox.
 *
 * Defaults to the bbox center if `entryPoint` is undefined.
 */
export function avatarWorldEntryFor(
  bbox: AABB,
  entryPoint: Vector3Tuple | undefined,
  time: number,
  bob: BobConfig | undefined,
): Vector3Tuple {
  const local: Vector3Tuple = entryPoint ?? [
    (bbox.min[0] + bbox.max[0]) / 2,
    (bbox.min[1] + bbox.max[1]) / 2,
    (bbox.min[2] + bbox.max[2]) / 2,
  ];
  const offset = floatOffset(time, bob);
  return [local[0], local[1] + offset, local[2]];
}
