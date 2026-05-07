/**
 * Route registry — bounding-box-driven URL routing.
 *
 * The avatar's world position is the single source of truth. Each
 * route declares a world-space AABB, and the avatar's URL is
 * derived from "which is the deepest registered route whose bbox
 * contains the avatar?" each frame. URL changes (deep-link, browser
 * back/forward) are reverse-applied by seeding the avatar at the
 * route's `entryPoint`.
 *
 * Content authoring: each route may carry an array of `ContentNode`s,
 * each placed at a 3D position in world space. Both the 3D scene and
 * the document/Simple Experience consume the same nodes — the 3D
 * renderer turns each into a textured plane / Text mesh / image
 * sprite at its `position`, while the document renderer sorts by
 * `order` and emits semantic HTML. The 3D world is the source of
 * truth; the 2D representation is a derived view.
 *
 * SEO-safe: this module exports plain typed data. A build-time
 * prerender step (separate, not yet wired) will import this module
 * in a Node context, render the document view of every route to
 * static HTML, and write `dist/<route>/index.html`. Crawlers and
 * link-preview bots that don't run JS get fully populated pages.
 */
import type { Vector3Tuple } from 'three';

/** Axis-aligned bounding box in world space. */
export interface AABB {
  /** Inclusive lower corner (x_min, y_min, z_min). */
  min: Vector3Tuple;
  /** Inclusive upper corner (x_max, y_max, z_max). */
  max: Vector3Tuple;
}

/** Vertical sine bob applied to a RoomBox's render transform. The
 *  box's bounds (in cube-local frame) stay constant; bob only
 *  affects how the geometry is drawn. The avatar lives outside the
 *  bobbing group, so its world position drifts relative to the
 *  cube — routing math compensates by transforming into the box's
 *  local frame before the bbox test. */
export interface BobConfig {
  /** Period in seconds for one full bob cycle (up + down). */
  period: number;
  /** Vertical amplitude in world units. */
  amplitude: number;
}

/** Avatar clamp configuration for a RoomBox. */
export interface ClampConfig {
  /** When false, the box does not clamp the avatar — they can pass
   *  through walls. Useful for routing-only regions that aren't
   *  meant to physically contain anything. Default true. */
  enabled: boolean;
  /** Inset on each face in world units. Default
   *  `AVATAR_WALL_MARGIN` from cursorAvatarMath. */
  margin?: number;
  /** Sub-regions of the box's bounds where the clamp doesn't apply
   *  — passages between adjacent boxes the avatar can walk through. */
  holes?: AABB[];
}

/** A texture/material override for a RoomBox's walls. When present,
 *  the RoomBox renders with this material instead of the default
 *  GridMaterial wireframe. Implementation deferred — the type lives
 *  here so the API is forward-compatible; today's RoomBox renders
 *  GridMaterial when this field is omitted. */
export interface TextureConfig {
  /** Asset path (resolved by the build) or absolute URL. */
  src: string;
  /** Repeats per side. Useful for tiling small textures across a
   *  large wall without stretching. Default [1, 1, 1] (no repeat). */
  repeat?: Vector3Tuple;
}

/** Full visual + behavioral characteristics of a RoomBox.
 *
 *  Position + size are *derived* from `bounds`:
 *    position = ((min[i] + max[i]) / 2 for each axis)
 *    size     = (max[i] - min[i] for each axis)
 *
 *  Both quantities are exposed as helpers (`boxCenter`, `boxSize`
 *  below) so callers can read them without recomputing. There's
 *  intentionally no separate `position` / `size` field — keeping
 *  bounds the single source of geometric truth means a route's
 *  bbox (used for URL routing + clamping) and the rendered cube's
 *  geometry can never drift apart. */
export interface RoomBoxConfig {
  /** Required: defines position, size, AND clamp region. */
  bounds: AABB;
  /** Grid line color (hex). Default cyan. */
  color?: string;
  /** Wall background color (hex). Default dark grey. */
  bgColor?: string;
  /** Wall alpha (0..1). Default 1. Pairs with `transparent` below
   *  — Three.js requires `transparent: true` for alpha blending,
   *  while `alpha` is the actual blend value the shader writes. */
  alpha?: number;
  /** Material's `transparent` flag. When true, the wall doesn't
   *  occlude what's behind it (useful for see-through preview
   *  regions). Default false. */
  transparent?: boolean;
  /** Texture / material override. When present, supplants the
   *  default GridMaterial. Type defined now for forward
   *  compatibility; primitive currently honors `color` only. */
  texture?: TextureConfig;
  /** Optional bob. When undefined, the box renders at a fixed
   *  position. */
  bob?: BobConfig;
  /** Optional clamp. When undefined, the box doesn't constrain the
   *  avatar — for routing-only regions inside another, larger box. */
  clamp?: ClampConfig;
}

/** Position helper — geometric center of a bbox. */
export function boxCenter(bounds: AABB): Vector3Tuple {
  return [
    (bounds.min[0] + bounds.max[0]) / 2,
    (bounds.min[1] + bounds.max[1]) / 2,
    (bounds.min[2] + bounds.max[2]) / 2,
  ];
}

/** Size helper — extent of a bbox along each axis (always
 *  non-negative for well-formed bboxes). */
export function boxSize(bounds: AABB): Vector3Tuple {
  return [
    bounds.max[0] - bounds.min[0],
    bounds.max[1] - bounds.min[1],
    bounds.max[2] - bounds.min[2],
  ];
}

/** A single piece of content placed in 3D world space. The 3D scene
 *  renders it as some mesh; the document view emits semantic HTML. */
export type ContentNode =
  | {
      kind: 'heading';
      /** 3D world position where this heading is rendered. */
      position: Vector3Tuple;
      /** Reading order within the route's document view (low → high). */
      order: number;
      body: string;
    }
  | {
      kind: 'paragraph';
      position: Vector3Tuple;
      order: number;
      body: string;
    }
  | {
      kind: 'image';
      position: Vector3Tuple;
      order: number;
      /** Image src (asset path or URL). */
      src: string;
      /** Alt text for the document view + accessibility. */
      alt: string;
    };

/**
 * One route in the registry — a path + bbox + optional content +
 * optional nested children.
 *
 * Nested routes' bboxes should be **strictly contained** inside the
 * parent's bbox. Sibling routes' bboxes should not overlap; if they
 * do, "deepest wins" still resolves to one of them but which sibling
 * wins is unspecified.
 */
export interface Route {
  /** Canonical URL path (leading slash, no trailing slash unless `/`). */
  path: string;
  /** World-space bbox the avatar must be inside for this route to
   *  resolve as the current URL. */
  bounds: AABB;
  /** Where the avatar lands when navigating to this route via URL
   *  (deep link, browser back). Defaults to the bbox center. */
  entryPoint?: Vector3Tuple;
  /** Visual + clamp characteristics. When present, this route's
   *  bbox is rendered as a `<RoomBox>` — same primitive the main
   *  cube uses, with whichever color/bob/clamp/etc. you declare.
   *  When omitted, the route is a routing-only region (no visible
   *  box; clamping comes from a parent route's box).
   *
   *  `bounds` is intentionally NOT redeclared here — the route's
   *  `bounds` IS the box's bounds, ensuring URL routing and visible
   *  geometry can never disagree. */
  box?: Omit<RoomBoxConfig, 'bounds'>;
  /** Content nodes rendered inside this route's bbox in 3D and
   *  flattened into the route's document view in 2D. */
  content?: ContentNode[];
  /** Nested routes whose bboxes are contained inside this one. */
  children?: Route[];
}

/** A route paired with its tree depth. Used by `routeForPosition`
 *  to break ties when multiple bboxes contain the avatar. */
export interface FlatRoute {
  route: Route;
  /** Depth in the route tree. Top-level routes are depth 0. */
  depth: number;
}

/** Walk the route tree, emitting one `FlatRoute` per route with its
 *  depth. Children always come after their parent in the output, but
 *  the order is otherwise insignificant (lookups compare depths, not
 *  positions). Pure — safe to call at module load. */
export function flattenRoutes(roots: ReadonlyArray<Route>, depth = 0): FlatRoute[] {
  const out: FlatRoute[] = [];
  for (const route of roots) {
    out.push({ route, depth });
    if (route.children && route.children.length > 0) {
      out.push(...flattenRoutes(route.children, depth + 1));
    }
  }
  return out;
}

/**
 * Route configuration. The root `/` route IS the main cube — its
 * `box` declaration carries the cube's color, bob, and clamp. Sub-
 * routes are nested bboxes inside the cube; they don't declare a
 * `box` because they're routing-only regions, not separate visible
 * cubes (the main cube's clamp is what the avatar physically obeys).
 *
 *   /                ← anywhere inside the main cube
 *   /about           ← +X half (x > 0)
 *   /about/education ← +X corner (x > 200, |y|<100, |z|<100)
 *
 * Walking from cube center to the +X wall trips both transitions in
 * order: / → /about → /about/education (and back on return).
 *
 * Adding a section is one declaration here — bbox + entry point +
 * (optionally) box visual + content. URL routing, document view,
 * and (when `box` is set) the visible cube all derive from this.
 */

/** Half-extent of the main cube along each axis. Mirrors
 *  `DEFAULT_ENVIRONMENT.dimensions` in `utils/defaults.ts`. */
const CUBE_HALF = 400;

/** Bob configuration the main cube uses — the slow vertical breathing
 *  motion. Pulled here so route-driven rendering and routing math
 *  read the same source of truth. */
export const MAIN_CUBE_BOB: BobConfig = { period: 6, amplitude: 0.6 };

/** Section room dimensions — each section ('about', 'projects',
 *  'writing') gets a 400×400×400 cube. Matches the legacy
 *  `ROOM_SIZE` from before the portal cleanup. */
const ROOM_SIZE = 400;
const ROOM_HALF = ROOM_SIZE / 2;
/** Distance from the main cube's -Z wall (z = -400) to the row of
 *  rooms behind it.
 *
 *  Sized to keep the projects-portal vCam OUT of the main cube. The
 *  R₁₈₀_Y portal math puts `vCam.z = dest.z + (avatar's +Z offset
 *  from source)`. With the avatar's max +Z extent at the back of
 *  the main cube (`z = +400` minus margin) and the source portal at
 *  `z ≈ -400`, that offset can reach ~800 units. If `dest.z + 800`
 *  is still inside the main cube (z > -400), the through-view ends
 *  up rendering the main cube's interior — which reads as "the vCam
 *  exited the room." `WALL_GAP = 1000` puts dest at `z ≈ -1600`,
 *  so worst-case vCam.z lands at `~-800` — outside the main cube
 *  AND outside every room (which sit at `z ∈ [-1800, -1400]`),
 *  rendering as empty space rather than confusing "main cube
 *  again" content. About / Writing don't trip this because their
 *  rooms are X-offset, but pushing them in lockstep keeps the
 *  layout symmetric. */
const WALL_GAP = 1000;
/** Center-to-center spacing between adjacent rooms in the row.
 *  Greater than `ROOM_SIZE` so adjacent rooms have a visible gap
 *  between them rather than touching. */
const ROOM_SPACING = 600;
/** Z position of every room's center — one common slab behind the
 *  main cube's -Z face. */
const ROOM_Z_CENTER = -CUBE_HALF - WALL_GAP - ROOM_HALF; // -1600

export const ROUTES: ReadonlyArray<Route> = [
  {
    path: '/',
    bounds: {
      min: [-CUBE_HALF, -CUBE_HALF, -CUBE_HALF],
      max: [CUBE_HALF, CUBE_HALF, CUBE_HALF],
    },
    entryPoint: [0, 0, 0],
    box: {
      color: '#00ffcc',
      bob: MAIN_CUBE_BOB,
      clamp: { enabled: true },
    },
    content: [
      {
        kind: 'heading',
        position: [0, 50, 0],
        order: 1,
        body: 'Kristiyan Iliev',
      },
      {
        kind: 'paragraph',
        position: [0, 0, 0],
        order: 2,
        body: 'Software engineer building interactive 3D experiences. Use the menu to walk through the rooms behind this cube — About, Projects, Writing.',
      },
    ],
    children: [
      // Row layout: three rooms behind the main cube's -Z wall, in a
      // line along the X axis with `ROOM_SPACING - ROOM_SIZE = 200`
      // unit gaps between adjacent rooms. Slot order matches the
      // legacy layout: writing on the left (-X), projects in the
      // middle, about on the right (+X). Each room is its own clamp
      // region — once the avatar teleports in, they're confined to
      // that room until they teleport elsewhere via the menu.
      {
        path: '/about',
        bounds: {
          min: [+ROOM_SPACING - ROOM_HALF, -ROOM_HALF, ROOM_Z_CENTER - ROOM_HALF],
          max: [+ROOM_SPACING + ROOM_HALF, +ROOM_HALF, ROOM_Z_CENTER + ROOM_HALF],
        },
        entryPoint: [+ROOM_SPACING, 0, ROOM_Z_CENTER],
        box: {
          color: '#4169e1', // royal blue
          clamp: { enabled: true },
        },
        content: [
          {
            kind: 'heading',
            position: [+ROOM_SPACING, +ROOM_HALF / 3, ROOM_Z_CENTER],
            order: 1,
            body: 'About Me',
          },
          {
            kind: 'paragraph',
            position: [+ROOM_SPACING, 0, ROOM_Z_CENTER],
            order: 2,
            body: 'A small intro paragraph that lives at /about.',
          },
        ],
        children: [
          {
            // Nested sub-route — a corner of /about. No clamp, so
            // the avatar can walk in and out freely between
            // /about and /about/education without teleport.
            path: '/about/education',
            bounds: {
              min: [+ROOM_SPACING + ROOM_HALF / 2, -ROOM_HALF / 2, ROOM_Z_CENTER - ROOM_HALF],
              max: [+ROOM_SPACING + ROOM_HALF, +ROOM_HALF / 2, ROOM_Z_CENTER - ROOM_HALF / 2],
            },
            entryPoint: [
              +ROOM_SPACING + (3 * ROOM_HALF) / 4,
              0,
              ROOM_Z_CENTER - (3 * ROOM_HALF) / 4,
            ],
            content: [
              {
                kind: 'heading',
                position: [
                  +ROOM_SPACING + (3 * ROOM_HALF) / 4,
                  +ROOM_HALF / 4,
                  ROOM_Z_CENTER - (3 * ROOM_HALF) / 4,
                ],
                order: 1,
                body: 'Education',
              },
              {
                kind: 'paragraph',
                position: [
                  +ROOM_SPACING + (3 * ROOM_HALF) / 4,
                  0,
                  ROOM_Z_CENTER - (3 * ROOM_HALF) / 4,
                ],
                order: 2,
                body: 'A nested route inside /about — corner sub-region.',
              },
            ],
          },
        ],
      },
      {
        path: '/projects',
        bounds: {
          min: [-ROOM_HALF, -ROOM_HALF, ROOM_Z_CENTER - ROOM_HALF],
          max: [+ROOM_HALF, +ROOM_HALF, ROOM_Z_CENTER + ROOM_HALF],
        },
        entryPoint: [0, 0, ROOM_Z_CENTER],
        box: {
          color: '#ff6ec7', // pink
          clamp: { enabled: true },
        },
        content: [
          {
            kind: 'heading',
            position: [0, +ROOM_HALF / 3, ROOM_Z_CENTER],
            order: 1,
            body: 'Projects',
          },
          {
            kind: 'paragraph',
            position: [0, 0, ROOM_Z_CENTER],
            order: 2,
            body: 'Things I have built.',
          },
        ],
      },
      {
        path: '/writing',
        bounds: {
          min: [-ROOM_SPACING - ROOM_HALF, -ROOM_HALF, ROOM_Z_CENTER - ROOM_HALF],
          max: [-ROOM_SPACING + ROOM_HALF, +ROOM_HALF, ROOM_Z_CENTER + ROOM_HALF],
        },
        entryPoint: [-ROOM_SPACING, 0, ROOM_Z_CENTER],
        box: {
          color: '#ffcc66', // amber
          clamp: { enabled: true },
        },
        content: [
          {
            kind: 'heading',
            position: [-ROOM_SPACING, +ROOM_HALF / 3, ROOM_Z_CENTER],
            order: 1,
            body: 'Writing',
          },
          {
            kind: 'paragraph',
            position: [-ROOM_SPACING, 0, ROOM_Z_CENTER],
            order: 2,
            body: 'Essays + notes.',
          },
        ],
      },
    ],
  },
];

/** Pre-flattened route table. Computed once at module load so
 *  per-frame lookups don't re-walk the tree. */
export const FLAT_ROUTES: ReadonlyArray<FlatRoute> = flattenRoutes(ROUTES);
