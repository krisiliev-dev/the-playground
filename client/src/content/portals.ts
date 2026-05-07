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
import { Matrix4, Quaternion, Vector3, type Vector3Tuple } from 'three';
import type { ClickHit } from '@/store';
import { FLAT_ROUTES } from '@/content/routes';

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

/** What happens when an avatar walks into / clicks on this endpoint:
 *
 *  - `'teleport'` (default when omitted): standard portal — the
 *    avatar emerges at the endpoint named in `pairedWith` via the
 *    R₁₈₀_Y mirror flip.
 *  - `'simple-experience'`: the endpoint is a "trigger" — looks
 *    like a portal but flips the avatar to the document/Simple
 *    Experience view instead of teleporting. `pairedWith` is unused
 *    on these endpoints.
 *
 *  Adding new triggers is intentionally cheap: extend this union and
 *  branch in `findCrossedPortal` / the click handler. */
export type PortalTrigger = 'simple-experience';

export interface PortalEndpoint {
  /** Globally unique id. */
  readonly id: PortalId;
  /** Id of the endpoint a player emerges from when walking through
   *  THIS one. Required for `trigger`-less (teleport) endpoints. May
   *  or may not be reciprocal — `A.pairedWith === B` does not require
   *  `B.pairedWith === A`. Asymmetric pairing enables N-cycle chains
   *  (A→B→C→A) which produce true multi-level recursion in the
   *  cascade renderer.
   *
   *  For `trigger` endpoints (Simple Experience portals, etc.) this
   *  is unused; an empty string or any unresolved id is fine. */
  readonly pairedWith: PortalId;
  /** When set, walking into / clicking the endpoint fires this
   *  trigger instead of running the teleport pipeline. Cascade
   *  rendering still happens (the rim + stencil show as visible
   *  portals); only the walk-through / click behavior diverges. */
  readonly trigger?: PortalTrigger;
  /** World-space center of the rectangle. */
  readonly position: Vector3Tuple;
  /** Orientation quaternion (x, y, z, w). Local +Z = active-side
   *  normal; local +X = width axis; local +Y = height axis. */
  readonly quaternion: readonly [number, number, number, number];
  /** Rectangle dimensions. */
  readonly size: { readonly width: number; readonly height: number };
  /** Crossing-from-inactive-side behavior. See module doc. */
  readonly sidedness: 'single' | 'double';
  /** Visual rim characteristics. The math doesn't read these. */
  readonly rim: {
    readonly color: string;
  };
  /** Which route this portal belongs to — `'/' ` for the formation
   *  cluster on the main cube, `'/about'`/`'/projects'`/`'/writing'`
   *  for room-exit portals. The portal cascade filters by the
   *  avatar's current route, so portals tagged for *other* routes
   *  don't render their cutouts when the avatar isn't there. Without
   *  this filter, the surface planes' `depthTest: false` makes their
   *  stencil marks bleed through walls — you'd see ghost cutouts of
   *  the formation portals while standing inside a section room. */
  readonly route: string;
}

// ─── Runtime endpoint factory ─────────────────────────────────────────

/** Default per-portal width / height in world units. The 4 formation
 *  portals tile a 28×28 sword-formation square (`SQUARE_HALF * 2`
 *  in `vibeFormation.ts`); a 10×10 portal centered at ±6 along each
 *  wall axis leaves a 2-unit visual gap between adjacent portals
 *  and a 3-unit gap to the sword ring at ±14. Tunable via the
 *  `scale` parameter so the portal cluster shrinks alongside the
 *  formation on narrow viewports. */
export const DEFAULT_PORTAL_SIZE = 10;

/** Distance from the formation center to each portal's center,
 *  along the wall basis (right/up). With `DEFAULT_PORTAL_SIZE = 10`
 *  this puts portal edges at ±1 (2-unit gap between adjacent
 *  portals) and outer corners at ±11 (3-unit gap to the sword ring
 *  at ±14). The tradeoff: smaller offset = more visual cohesion
 *  with the sword cluster; larger = more breathing room around the
 *  cluster's interior. 6 reads as "tight but not touching." */
export const FORMATION_QUADRANT_OFFSET = 6;

/** Distance to inset a portal off its host wall, in world units. Just
 *  enough to avoid z-fighting between the surface plane and the
 *  cube/room wall it sits flush against. */
const WALL_INSET = 0.5;

/** Threshold for treating a wall-normal vector as "essentially
 *  vertical" — clicked floor / ceiling. When `abs(normal · worldUp)`
 *  exceeds this, the standard `worldUp × normal` cross product
 *  collapses (cross of near-parallel vectors is near-zero), so
 *  `wallBasis` falls back to world +X for the wall's "right" axis.
 *  0.99 ≈ 8° tilt — generous enough to reliably trigger on horizontal
 *  surfaces without flickering on side-wall clicks. */
export const NEARLY_VERTICAL_DOT = 0.99;

/** Build orthonormal `right` and `up` axes for a wall identified by
 *  `normal`, mutating the caller's output vectors in place (zero
 *  allocation). The shared formula:
 *    - normal-axis is the input (passed by the caller as a tuple).
 *    - right = (worldUp × normal) normalized, with a fallback to
 *      world +X when the wall is nearly horizontal (normal ≈ ±worldUp,
 *      where the cross collapses).
 *    - up = (normal × right) normalized.
 *
 *  Used by the formation portal factory, the room-exit factory, and
 *  the avatar's clamp-hole helper — three places that previously
 *  duplicated the same math. Centralising the threshold + fallback
 *  here means a future change to one (e.g. tightening the vertical
 *  threshold) flows to all consumers. */
const WALL_BASIS_TMP_NORMAL = new Vector3();
const WALL_BASIS_WORLD_UP = new Vector3(0, 1, 0);
export function wallBasis(
  normal: readonly [number, number, number],
  rightOut: Vector3,
  upOut: Vector3,
): void {
  const n = WALL_BASIS_TMP_NORMAL.set(normal[0], normal[1], normal[2]).normalize();
  if (Math.abs(n.dot(WALL_BASIS_WORLD_UP)) > NEARLY_VERTICAL_DOT) {
    rightOut.set(1, 0, 0);
  } else {
    rightOut.crossVectors(WALL_BASIS_WORLD_UP, n).normalize();
  }
  upOut.crossVectors(n, rightOut).normalize();
}

/** Section-portal palette. Mirrors the rim colors used on the
 *  matching `<RoomBox>` so each portal reads as "the door to that
 *  colored room." */
const PORTAL_COLORS = {
  writing: '#ffcc66', // amber
  about: '#4169e1', // royal blue
  projects: '#ff6ec7', // pink
  simpleExperience: '#00ffcc', // cyan
} as const;

/**
 * Build a quaternion that orients a portal so its local +Z aligns
 * with `normal` (the active-side direction). Right + up axes come
 * from `wallBasis`, normal stays as supplied; the resulting
 * (right, up, normal) basis is converted to a rotation matrix and
 * then to a quaternion.
 */
function quatFromWallNormal(
  normal: [number, number, number],
): readonly [number, number, number, number] {
  const right = new Vector3();
  const up = new Vector3();
  wallBasis(normal, right, up);
  const n = new Vector3(...normal).normalize();
  const m = new Matrix4().makeBasis(right, up, n);
  const q = new Quaternion().setFromRotationMatrix(m);
  return [q.x, q.y, q.z, q.w];
}

/** Pre-rotated -Z normal (for room-exit portals on the +Z wall of
 *  each room — active side faces -Z, into the room interior). 180°
 *  around Y in quaternion form: (0, 1, 0, 0). */
const QUAT_FACING_NEG_Z = [0, 1, 0, 0] as const;

interface FormationQuadrant {
  readonly id: PortalId;
  readonly pairedWith: PortalId;
  readonly trigger?: PortalTrigger;
  readonly color: string;
  /** Wall-local offset in (right, up) axes, expressed as multiples
   *  of half-portal-size. (-1, +1) = top-left, (+1, +1) = top-right,
   *  etc. */
  readonly dxSign: -1 | 1;
  readonly dySign: -1 | 1;
}

const FORMATION_LAYOUT: ReadonlyArray<FormationQuadrant> = [
  {
    id: 'formation-writing',
    pairedWith: 'room-writing-exit',
    color: PORTAL_COLORS.writing,
    dxSign: -1,
    dySign: +1,
  },
  {
    id: 'formation-about',
    pairedWith: 'room-about-exit',
    color: PORTAL_COLORS.about,
    dxSign: +1,
    dySign: +1,
  },
  {
    id: 'formation-projects',
    pairedWith: 'room-projects-exit',
    color: PORTAL_COLORS.projects,
    dxSign: -1,
    dySign: -1,
  },
  {
    id: 'formation-simple-experience',
    // Trigger endpoints don't teleport — `pairedWith` is unused but
    // typed as required, so we keep an empty string here as a marker.
    pairedWith: '',
    trigger: 'simple-experience',
    color: PORTAL_COLORS.simpleExperience,
    dxSign: +1,
    dySign: -1,
  },
];

/** Map from route path → (room exit portal id, paired formation
 *  portal id, rim color). The exit portals live on each room's +Z
 *  wall, paired back to the matching formation portal so the
 *  connection is bidirectional. */
const ROOM_EXIT_LAYOUT: ReadonlyArray<{
  readonly path: string;
  readonly id: PortalId;
  readonly pairedWith: PortalId;
  readonly color: string;
}> = [
  {
    path: '/writing',
    id: 'room-writing-exit',
    pairedWith: 'formation-writing',
    color: PORTAL_COLORS.writing,
  },
  {
    path: '/about',
    id: 'room-about-exit',
    pairedWith: 'formation-about',
    color: PORTAL_COLORS.about,
  },
  {
    path: '/projects',
    id: 'room-projects-exit',
    pairedWith: 'formation-projects',
    color: PORTAL_COLORS.projects,
  },
];

/**
 * Build the runtime portal endpoint set: 4 formation portals
 * positioned in `clickHit`'s wall plane (one per quadrant of the
 * sword formation square), plus 3 room-exit portals on the +Z wall
 * of each section room. The bottom-right formation portal is the
 * Simple Experience trigger (no pairing; walking into / clicking it
 * fires `setDocumentMode(true)` instead of teleporting).
 *
 * Pure: takes the click hit + an optional scale, returns a fresh
 * array. The reveal orchestrator calls this once `revealState`
 * advances to `'revealed'` and stores the result via
 * `setPortalEndpoints`.
 *
 * `scale` defaults to 1; pass `FORMATION_SCALE` from the reveal
 * layer to keep the portal size in lockstep with the visible sword
 * formation on narrow viewports.
 */
export function buildPortalEndpoints(clickHit: ClickHit, scale = 1): ReadonlyArray<PortalEndpoint> {
  const portalSize = DEFAULT_PORTAL_SIZE * scale;
  const quadrantOffset = FORMATION_QUADRANT_OFFSET * scale;

  // Wall basis at the click point: right + up axes anchored to the
  // wall plane, used to lay out the 2×2 quadrant portal offsets.
  // `wallBasis` mutates the passed-in vectors in place.
  const right = new Vector3();
  const up = new Vector3();
  wallBasis(clickHit.normal, right, up);
  const normal = new Vector3(...clickHit.normal).normalize();

  const formationCenter = new Vector3(...clickHit.point).addScaledVector(normal, WALL_INSET);
  const formationQuat = quatFromWallNormal(clickHit.normal);

  const formationPortals: PortalEndpoint[] = FORMATION_LAYOUT.map((q) => {
    const offset = right
      .clone()
      .multiplyScalar(q.dxSign * quadrantOffset)
      .addScaledVector(up, q.dySign * quadrantOffset);
    const pos = formationCenter.clone().add(offset);
    return {
      id: q.id,
      pairedWith: q.pairedWith,
      ...(q.trigger ? { trigger: q.trigger } : {}),
      position: [pos.x, pos.y, pos.z],
      quaternion: formationQuat,
      size: { width: portalSize, height: portalSize },
      sidedness: 'single',
      rim: { color: q.color },
      route: '/',
    };
  });

  // Room-exit portals — one on each section room's +Z wall, paired
  // back to its matching formation portal. Position derived from
  // FLAT_ROUTES so a future change to room geometry flows through
  // automatically.
  const roomPortals: PortalEndpoint[] = [];
  for (const layout of ROOM_EXIT_LAYOUT) {
    const route = FLAT_ROUTES.find((fr) => fr.route.path === layout.path);
    if (!route) {
      continue;
    }
    const b = route.route.bounds;
    const cx = (b.min[0] + b.max[0]) / 2;
    const cy = (b.min[1] + b.max[1]) / 2;
    // +Z wall at b.max[2]; inset by WALL_INSET in -Z direction so
    // the portal sits flush-but-not-z-fighting with the wall.
    const wallZ = b.max[2] - WALL_INSET;
    roomPortals.push({
      id: layout.id,
      pairedWith: layout.pairedWith,
      position: [cx, cy, wallZ],
      quaternion: QUAT_FACING_NEG_Z,
      size: { width: portalSize, height: portalSize },
      sidedness: 'single',
      rim: { color: layout.color },
      route: layout.path,
    });
  }

  return [...formationPortals, ...roomPortals];
}

/**
 * Look up an endpoint by id in the supplied list. Returns null if
 * not found — pure; never throws. Callers decide whether a missing
 * id is fatal or should silently no-op (e.g. a portal mesh failing
 * to render is preferable to a hard crash).
 *
 * Endpoints are runtime state (live in the world store, populated
 * once the reveal sequence has placed the formation) so callers
 * always have to pass the current array — there's no module-level
 * default.
 */
export function getEndpoint(
  id: PortalId,
  endpoints: ReadonlyArray<PortalEndpoint>,
): PortalEndpoint | null {
  return endpoints.find((e) => e.id === id) ?? null;
}

/**
 * Look up the endpoint a player emerges from when walking through
 * `id`. Returns null if either the source isn't found, has a
 * `trigger` (no teleport partner), or its paired id doesn't resolve
 * to a known endpoint.
 *
 * Note: does NOT require reciprocal pairing. `A.pairedWith === B`
 * is sufficient even if `B.pairedWith !== A` — this lets cycles
 * (A→B→C→A) work. Reciprocity was previously required to "avoid
 * dead-ends," but every paired endpoint that resolves is a valid
 * exit, regardless of where ITS exit points.
 */
export function getPaired(
  id: PortalId,
  endpoints: ReadonlyArray<PortalEndpoint>,
): PortalEndpoint | null {
  const source = getEndpoint(id, endpoints);
  if (!source || source.trigger) {
    return null;
  }
  return getEndpoint(source.pairedWith, endpoints);
}
