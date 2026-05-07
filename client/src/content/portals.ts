/**
 * Portal endpoint registry — declarative config for in-world
 * portals (the "real-life portal" kind: a window you can both see
 * through to another place in the world *and* walk through to be
 * teleported there).
 *
 * Each `PortalEndpoint` is one *side* of a connection. `pairedWith`
 * names the endpoint a player emerges from when they walk through
 * THIS endpoint. The pairing graph can be any directed structure:
 *
 *   - **Symmetric pair** (A↔B): A.pairedWith=B, B.pairedWith=A.
 *     Walking A returns from B, walking B returns from A. The
 *     classic "face-to-face" two-portal setup.
 *
 *   - **Cycle** (A→B→C→A): A.pairedWith=B, B.pairedWith=C,
 *     C.pairedWith=A. Walking through any portal cycles you to
 *     the next. Visible recursion does NOT collapse to a 2-cycle
 *     here, so you get true infinite-tunnel rendering.
 *
 *   - **Mixed**: any directed graph where each node has exactly
 *     one outgoing edge. The cascade renderer follows pairedWith
 *     iteratively to compute virtual cameras for each recursion
 *     depth.
 *
 * Convention for the rectangle pose:
 *
 *   - `position` is the rectangle's CENTER in cube-local coords.
 *   - `quaternion` orients the rectangle: local +Z is the **active
 *     side normal** (the side a player walks INTO to be teleported);
 *     local +X is the rectangle's "right" (width); local +Y is "up"
 *     (height).
 *   - `size.width` is the extent along local +X; `size.height` along
 *     local +Y.
 *
 * Sidedness:
 *
 *   - `'single'`: only crossings *from the active side* (signed
 *     distance going positive → negative through the rectangle)
 *     teleport. Crossings from the inactive side pass through with
 *     no effect — visually the player clips through the back of
 *     the portal as if it weren't there.
 *   - `'double'`: both sides teleport. The active side just defines
 *     which face is the "primary" for visual purposes.
 *
 * The mathematical "twin" relationship between paired endpoints is
 * a 180° rotation around the portals' shared up axis (Y). That's
 * why walking into source's right-of-center emerges at dest's
 * left-of-center — adjacent portals are identified front-to-front,
 * mirror-style.
 */
import type { Vector3Tuple } from 'three';

/** Unique-per-endpoint identifier. */
export type PortalId = string;

/** Recursion depth limit for nested portal rendering (a portal seen
 *  through another portal). Each level adds 4 GPU draw calls (stencil
 *  mark + depth clear + through-view + stencil decrement) per portal,
 *  so cost scales linearly.
 *
 *  20 is empirically a sweet spot: well past the level at which
 *  perspective shrinkage makes nested portals sub-pixel (~8–12 in
 *  our config), so the visible tunnel reads as "infinite" at typical
 *  viewing distances, but cheap enough that the GPU draw budget per
 *  frame stays in single-digit milliseconds. Hard ceiling is 255
 *  (8-bit stencil buffer). */
export const MAX_PORTAL_RECURSION = 20;

export interface PortalEndpoint {
  /** Globally unique id. */
  readonly id: PortalId;
  /** Id of the endpoint a player emerges from when walking through
   *  THIS one. May or may not be reciprocal — `A.pairedWith === B`
   *  does not require `B.pairedWith === A`. Asymmetric pairing
   *  enables N-cycle chains (A→B→C→A) which produce true multi-level
   *  recursion in the cascade renderer (the 2-cycle inverse-identity
   *  collapse doesn't apply). */
  readonly pairedWith: PortalId;
  /** Cube-local center of the rectangle. */
  readonly position: Vector3Tuple;
  /** Orientation quaternion (x, y, z, w). Local +Z = active-side
   *  normal; local +X = width axis; local +Y = height axis. */
  readonly quaternion: readonly [number, number, number, number];
  /** Rectangle dimensions. */
  readonly size: { readonly width: number; readonly height: number };
  /** Crossing-from-inactive-side behavior. See module doc. */
  readonly sidedness: 'single' | 'double';
  /** Visual rim characteristics. The math doesn't read these. */
  readonly rim: { readonly color: string; readonly particleCount: number };
}

/**
 * v1 test config — two single-sided portals facing each other along
 * the X axis. Symmetric pairing (A↔B): walking A emerges at B and
 * vice versa.
 *
 * Quaternion math: a Y-axis rotation by θ has q = (0, sin(θ/2), 0,
 * cos(θ/2)). For θ = ±π/2 that's (0, ±√2/2, 0, √2/2).
 */
const SQRT_HALF = Math.SQRT1_2; // √(1/2) = √2/2 ≈ 0.7071

export const PORTAL_ENDPOINTS: ReadonlyArray<PortalEndpoint> = [
  {
    id: 'test-a',
    pairedWith: 'test-b',
    position: [-150, 0, 0],
    // +90° around Y: local +Z → world +X (faces toward B)
    quaternion: [0, SQRT_HALF, 0, SQRT_HALF],
    size: { width: 60, height: 80 },
    sidedness: 'single',
    rim: { color: '#00ffcc', particleCount: 64 }, // cyan
  },
  {
    id: 'test-b',
    pairedWith: 'test-a',
    position: [+150, 0, 0],
    // -90° around Y: local +Z → world -X (faces toward A)
    quaternion: [0, -SQRT_HALF, 0, SQRT_HALF],
    size: { width: 60, height: 80 },
    sidedness: 'single',
    rim: { color: '#ff6ec7', particleCount: 64 }, // pink
  },
];

/**
 * Look up an endpoint by id. Returns null if not found — pure;
 * never throws. Callers decide whether a missing id is fatal or
 * should silently no-op (e.g. a portal mesh failing to render is
 * preferable to a hard crash).
 */
export function getEndpoint(
  id: PortalId,
  endpoints: ReadonlyArray<PortalEndpoint> = PORTAL_ENDPOINTS,
): PortalEndpoint | null {
  return endpoints.find((e) => e.id === id) ?? null;
}

/**
 * Look up the endpoint a player emerges from when walking through
 * `id`. Returns null if either the source isn't found or its paired
 * id doesn't resolve to a known endpoint.
 *
 * Note: does NOT require reciprocal pairing. `A.pairedWith === B`
 * is sufficient even if `B.pairedWith !== A` — this lets cycles
 * (A→B→C→A) work. Reciprocity was previously required to "avoid
 * dead-ends," but every paired endpoint that resolves is a valid
 * exit, regardless of where ITS exit points. Dead-ends are now
 * defined narrowly as "pairedWith resolves to nothing."
 */
export function getPaired(
  id: PortalId,
  endpoints: ReadonlyArray<PortalEndpoint> = PORTAL_ENDPOINTS,
): PortalEndpoint | null {
  const source = getEndpoint(id, endpoints);
  if (!source) {
    return null;
  }
  return getEndpoint(source.pairedWith, endpoints);
}
