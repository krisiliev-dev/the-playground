/**
 * routeForPosition — verifies the bbox-driven URL resolution rule
 * end-to-end:
 *
 *   - Containment: a position inside one bbox resolves to its path.
 *   - Deepest wins: a position inside both /about and /about/education
 *     resolves to the deeper one.
 *   - Outside everything resolves to `/`.
 *   - The bob compensation: an avatar standing still at the same
 *     world Y resolves to the same route at every phase of the bob,
 *     because we transform into the cube's local frame first.
 */
import { describe, it, expect } from 'vitest';
import {
  aabbContains,
  avatarWorldEntryFor,
  routeForAvatar,
  routeForLocalPosition,
} from '@/content/routeForPosition';
import { flattenRoutes, MAIN_CUBE_BOB, type Route } from '@/content/routes';
import { floatOffset } from '@/components/scene/floatBob';

const FLOAT_PERIOD = MAIN_CUBE_BOB.period;
const FLOAT_AMPLITUDE = MAIN_CUBE_BOB.amplitude;

const TEST_ROUTES: ReadonlyArray<Route> = [
  {
    path: '/about',
    bounds: { min: [0, -100, -100], max: [400, 100, 100] },
    // Explicit entry point — without one, the bbox center (200, 0, 0)
    // falls inside /about/education's bbox, which would round-trip
    // /about's entry into /about/education. A general-purpose lesson:
    // when a child bbox covers the parent's geometric center, the
    // parent must declare an explicit entryPoint outside the child.
    entryPoint: [100, 0, 0],
    children: [
      {
        path: '/about/education',
        bounds: { min: [200, -50, -50], max: [400, 50, 50] },
      },
    ],
  },
  {
    path: '/projects',
    bounds: { min: [-400, -100, -100], max: [0, 100, 100] },
  },
];

const FLAT = flattenRoutes(TEST_ROUTES);

describe('aabbContains', () => {
  const box = { min: [0, 0, 0] as [number, number, number], max: [10, 10, 10] as [number, number, number] };

  it('returns true for a point inside the bbox', () => {
    expect(aabbContains(box, [5, 5, 5])).toBe(true);
  });

  it('treats bbox edges as inside (inclusive bounds)', () => {
    expect(aabbContains(box, [0, 0, 0])).toBe(true);
    expect(aabbContains(box, [10, 10, 10])).toBe(true);
  });

  it('returns false for a point outside any axis', () => {
    expect(aabbContains(box, [-1, 5, 5])).toBe(false);
    expect(aabbContains(box, [5, 11, 5])).toBe(false);
    expect(aabbContains(box, [5, 5, -0.001])).toBe(false);
  });
});

describe('routeForLocalPosition', () => {
  it('returns "/" when the position is outside every registered bbox', () => {
    expect(routeForLocalPosition([0, 0, 200], FLAT)).toBe('/');
    expect(routeForLocalPosition([500, 0, 0], FLAT)).toBe('/');
  });

  it('resolves to /about when the position is in /about but not its child', () => {
    expect(routeForLocalPosition([100, 0, 0], FLAT)).toBe('/about');
  });

  it('resolves to /about/education when the position is inside both', () => {
    // (250, 0, 0) is inside /about (depth 0) AND /about/education (depth 1).
    // Deepest wins ⇒ /about/education.
    expect(routeForLocalPosition([250, 0, 0], FLAT)).toBe('/about/education');
  });

  it('resolves to /projects in the -X half', () => {
    expect(routeForLocalPosition([-100, 0, 0], FLAT)).toBe('/projects');
  });

  it('does not leak across sibling bboxes', () => {
    // (200, 0, 0) is on /about's interior boundary but not in /projects.
    expect(routeForLocalPosition([200, 0, 0], FLAT)).toBe('/about/education');
    // (-200, 0, 0) is in /projects, never in /about.
    expect(routeForLocalPosition([-200, 0, 0], FLAT)).toBe('/projects');
  });
});

describe('routeForAvatar (with bob compensation)', () => {
  it('resolves to the same route at every phase of the bob if the avatar stands still', () => {
    // Avatar at world (100, 0, 0). In the cube's local frame this is
    // (100, -floatOffset(t), 0). Both 0 and -floatOffset(t) lie
    // comfortably inside /about's Y range [-100, 100], so the route
    // is constant across the cycle.
    const samples = [0, FLOAT_PERIOD / 4, FLOAT_PERIOD / 2, (3 * FLOAT_PERIOD) / 4, FLOAT_PERIOD];
    for (const t of samples) {
      expect(routeForAvatar([100, 0, 0], t, FLAT, MAIN_CUBE_BOB)).toBe('/about');
    }
  });

  it('keeps a near-boundary avatar on the same route across the bob (the whole point)', () => {
    // Avatar's world Y is exactly at /about's local-frame Y = 99.5.
    // World Y to put them at local Y = 99.5 at time 0:
    //   localY = worldY - floatOffset(0) = worldY - 0 = worldY ⇒ worldY = 99.5
    // At time 1.5s (quarter cycle), floatOffset = +FLOAT_AMPLITUDE.
    //   localY = 99.5 - FLOAT_AMPLITUDE = 98.9 — still inside [-100, 100].
    // Without bob compensation, a naive world-frame test against a
    // static bbox would give the same result here only by coincidence.
    // The interesting case is when the avatar's local Y is *above* 100
    // at one bob phase and below at another:
    const worldY = 100 + FLOAT_AMPLITUDE / 2; // local Y oscillates [99.7, 100.7] over the cycle
    // At quarter phase, offset = +0.6, local Y = worldY - 0.6 = 99.9 → inside
    expect(routeForAvatar([100, worldY, 0], FLOAT_PERIOD / 4, FLAT, MAIN_CUBE_BOB)).toBe(
      '/about',
    );
    // At three-quarter phase, offset = -0.6, local Y = worldY + 0.6 = 101.1 → OUTSIDE
    // The avatar IS in fact outside /about's bbox at that time — the
    // bob shifted the cube down, so the floor of /about (relative to
    // world) rose. Routing reflects truth.
    expect(routeForAvatar([100, worldY, 0], (3 * FLOAT_PERIOD) / 4, FLAT, MAIN_CUBE_BOB)).toBe(
      '/',
    );
  });

  it('floatOffset is zero at t=0 and at t=FLOAT_PERIOD', () => {
    expect(floatOffset(0, MAIN_CUBE_BOB)).toBeCloseTo(0, 6);
    expect(floatOffset(FLOAT_PERIOD, MAIN_CUBE_BOB)).toBeCloseTo(0, 6);
  });

  it('floatOffset returns 0 when bob config is undefined (no-bob case)', () => {
    expect(floatOffset(0, undefined)).toBe(0);
    expect(floatOffset(1.5, undefined)).toBe(0);
    expect(floatOffset(99, undefined)).toBe(0);
  });
});

describe('avatarWorldEntryFor', () => {
  const bbox = { min: [0, 0, 0] as [number, number, number], max: [100, 100, 100] as [number, number, number] };

  it('uses the explicit entryPoint when provided, lifted by the bob', () => {
    const entry = avatarWorldEntryFor(bbox, [50, 25, 50], 0, MAIN_CUBE_BOB);
    expect(entry).toEqual([50, 25 + floatOffset(0, MAIN_CUBE_BOB), 50]);
  });

  it('defaults to the bbox center when no entryPoint is given', () => {
    const entry = avatarWorldEntryFor(bbox, undefined, 0, MAIN_CUBE_BOB);
    expect(entry).toEqual([50, 50, 50]); // center; floatOffset(0) = 0
  });

  it('round-trips with routeForAvatar — placing the avatar at the entry maps back to the route', () => {
    const route = TEST_ROUTES[0]!; // /about
    const entry = avatarWorldEntryFor(
      route.bounds,
      route.entryPoint,
      FLOAT_PERIOD / 4,
      MAIN_CUBE_BOB,
    );
    expect(routeForAvatar(entry, FLOAT_PERIOD / 4, FLAT, MAIN_CUBE_BOB)).toBe('/about');
  });
});

describe('flattenRoutes', () => {
  it('emits parents before children with monotonically non-decreasing depth on each subtree', () => {
    const flat = flattenRoutes(TEST_ROUTES);
    // Two parents + one child = three entries.
    expect(flat).toHaveLength(3);
    const aboutIdx = flat.findIndex((f) => f.route.path === '/about');
    const eduIdx = flat.findIndex((f) => f.route.path === '/about/education');
    expect(aboutIdx).toBeLessThan(eduIdx);
    expect(flat[aboutIdx]!.depth).toBe(0);
    expect(flat[eduIdx]!.depth).toBe(1);
  });
});
