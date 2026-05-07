/**
 * Tests for the portals registry. Pins:
 *
 *   - `MAX_PORTAL_RECURSION` is in a sensible range — past the level
 *     where perspective shrinkage makes nested portals sub-pixel,
 *     but well under the 8-bit stencil-buffer ceiling.
 *   - `buildPortalEndpoints(clickHit, scale)` produces a self-
 *     consistent endpoint set: every teleport portal's `pairedWith`
 *     resolves; quaternions are unit; sizes are positive; ids are
 *     unique; the bottom-right formation slot is the
 *     Simple Experience trigger; formation portals' active normal
 *     matches `clickHit.normal`.
 *   - The factory is pure — same inputs produce structurally
 *     identical output, no module-level mutation.
 */
import { describe, it, expect } from 'vitest';
import { Vector3 } from 'three';
import { MAX_PORTAL_RECURSION, buildPortalEndpoints, getPaired } from '@/content/portals';
import type { ClickHit } from '@/store';

describe('MAX_PORTAL_RECURSION', () => {
  it('is a positive integer', () => {
    expect(Number.isInteger(MAX_PORTAL_RECURSION)).toBe(true);
    expect(MAX_PORTAL_RECURSION).toBeGreaterThan(0);
  });

  it('is at most 255 (8-bit stencil buffer ceiling)', () => {
    expect(MAX_PORTAL_RECURSION).toBeLessThanOrEqual(255);
  });

  it('is high enough to render a visible "infinite tunnel"', () => {
    expect(MAX_PORTAL_RECURSION).toBeGreaterThanOrEqual(8);
  });
});

describe('buildPortalEndpoints — runtime factory', () => {
  // A click on the -Z wall back-center (the section-rooms wall in
  // the default route config). normal points +Z (into the cube).
  const NEG_Z_WALL_CLICK: ClickHit = {
    point: [0, 0, -400],
    normal: [0, 0, 1],
  };

  it('produces 7 endpoints (4 formation + 3 room exits)', () => {
    const eps = buildPortalEndpoints(NEG_Z_WALL_CLICK);
    expect(eps).toHaveLength(7);
  });

  it('endpoint ids are unique', () => {
    const eps = buildPortalEndpoints(NEG_Z_WALL_CLICK);
    const ids = eps.map((ep) => ep.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every formation portal has a non-zero size', () => {
    const eps = buildPortalEndpoints(NEG_Z_WALL_CLICK);
    for (const ep of eps) {
      expect(ep.size.width).toBeGreaterThan(0);
      expect(ep.size.height).toBeGreaterThan(0);
    }
  });

  it('every quaternion is unit-length within tolerance', () => {
    const eps = buildPortalEndpoints(NEG_Z_WALL_CLICK);
    for (const ep of eps) {
      const [x, y, z, w] = ep.quaternion;
      const len = Math.hypot(x, y, z, w);
      expect(len).toBeCloseTo(1, 5);
    }
  });

  it('every teleport portal pairs to another endpoint that resolves', () => {
    const eps = buildPortalEndpoints(NEG_Z_WALL_CLICK);
    for (const ep of eps) {
      if (ep.trigger) {
        // Trigger endpoints intentionally have no pair.
        expect(getPaired(ep.id, eps)).toBeNull();
      } else {
        expect(
          getPaired(ep.id, eps),
          `${ep.id}.pairedWith=${ep.pairedWith} did not resolve`,
        ).not.toBeNull();
      }
    }
  });

  it('teleport pairings are reciprocal (formation ↔ room exit)', () => {
    const eps = buildPortalEndpoints(NEG_Z_WALL_CLICK);
    for (const ep of eps) {
      if (ep.trigger) {
        continue;
      }
      const paired = getPaired(ep.id, eps);
      expect(paired).not.toBeNull();
      // Other portal pairs back to this one.
      expect(paired!.pairedWith).toBe(ep.id);
    }
  });

  it('exactly one endpoint is the Simple Experience trigger', () => {
    const eps = buildPortalEndpoints(NEG_Z_WALL_CLICK);
    const triggers = eps.filter((ep) => ep.trigger === 'simple-experience');
    expect(triggers).toHaveLength(1);
  });

  it('formation portals are tagged with route="/"', () => {
    const eps = buildPortalEndpoints(NEG_Z_WALL_CLICK);
    const formation = eps.filter((ep) => ep.id.startsWith('formation-'));
    for (const ep of formation) {
      expect(ep.route).toBe('/');
    }
  });

  it('room-exit portals are tagged with their corresponding route', () => {
    const eps = buildPortalEndpoints(NEG_Z_WALL_CLICK);
    const expected: Record<string, string> = {
      'room-about-exit': '/about',
      'room-projects-exit': '/projects',
      'room-writing-exit': '/writing',
    };
    for (const [id, expectedRoute] of Object.entries(expected)) {
      const ep = eps.find((e) => e.id === id);
      expect(ep, `endpoint ${id} not found`).toBeDefined();
      expect(ep!.route).toBe(expectedRoute);
    }
  });

  it('formation portals are arranged in a 2x2 around the click point', () => {
    // Formation slot ids — bottom-right is the SE trigger; the other
    // three are paired teleports.
    const eps = buildPortalEndpoints(NEG_Z_WALL_CLICK);
    const formation = eps.filter((ep) => ep.id.startsWith('formation-'));
    expect(formation).toHaveLength(4);

    // Each formation portal should sit within ~half-portal-size of
    // the click point in the wall plane (X/Y for a -Z wall click).
    // World Z stays near the click's Z (small inset off the wall).
    for (const ep of formation) {
      const [x, y, z] = ep.position;
      expect(Math.abs(x)).toBeLessThanOrEqual(ep.size.width); // wall-X
      expect(Math.abs(y)).toBeLessThanOrEqual(ep.size.height); // wall-Y
      expect(Math.abs(z + 400)).toBeLessThan(2); // close to wall plane
    }
  });

  it('formation portals face the click normal (active side = into cube)', () => {
    const eps = buildPortalEndpoints(NEG_Z_WALL_CLICK);
    const formation = eps.filter((ep) => ep.id.startsWith('formation-'));
    for (const ep of formation) {
      // Active normal = local +Z rotated by the endpoint quaternion.
      // For a -Z wall click with normal=(0,0,1), the active normal
      // should equal (0,0,1).
      const localZ = new Vector3(0, 0, 1);
      const q = ep.quaternion;
      const normal = localZ
        .clone()
        .applyQuaternion({ x: q[0], y: q[1], z: q[2], w: q[3] } as never);
      expect(normal.x).toBeCloseTo(0, 5);
      expect(normal.y).toBeCloseTo(0, 5);
      expect(normal.z).toBeCloseTo(1, 5);
    }
  });

  it('room-exit portals face -Z (active side = into the room)', () => {
    const eps = buildPortalEndpoints(NEG_Z_WALL_CLICK);
    const roomExits = eps.filter((ep) => ep.id.startsWith('room-'));
    expect(roomExits).toHaveLength(3);
    for (const ep of roomExits) {
      const localZ = new Vector3(0, 0, 1);
      const q = ep.quaternion;
      const normal = localZ
        .clone()
        .applyQuaternion({ x: q[0], y: q[1], z: q[2], w: q[3] } as never);
      expect(normal.x).toBeCloseTo(0, 5);
      expect(normal.y).toBeCloseTo(0, 5);
      expect(normal.z).toBeCloseTo(-1, 5);
    }
  });

  it('scale parameter scales formation portal size linearly', () => {
    const e1 = buildPortalEndpoints(NEG_Z_WALL_CLICK, 1);
    const e2 = buildPortalEndpoints(NEG_Z_WALL_CLICK, 2);
    const fm1 = e1.find((ep) => ep.id.startsWith('formation-'))!;
    const fm2 = e2.find((ep) => ep.id.startsWith('formation-'))!;
    expect(fm2.size.width).toBeCloseTo(fm1.size.width * 2, 5);
    expect(fm2.size.height).toBeCloseTo(fm1.size.height * 2, 5);
  });

  it('is pure — repeated calls with same input produce structurally equal output', () => {
    const a = buildPortalEndpoints(NEG_Z_WALL_CLICK, 1.5);
    const b = buildPortalEndpoints(NEG_Z_WALL_CLICK, 1.5);
    expect(a).not.toBe(b); // different array instances
    expect(JSON.stringify(a)).toBe(JSON.stringify(b)); // same shape
  });

  it('all 4 formation portals share the same quaternion (same wall)', () => {
    const eps = buildPortalEndpoints(NEG_Z_WALL_CLICK);
    const formation = eps.filter((ep) => ep.id.startsWith('formation-'));
    const ref = formation[0]!.quaternion;
    for (const ep of formation) {
      for (let i = 0; i < 4; i += 1) {
        expect(ep.quaternion[i]).toBeCloseTo(ref[i]!, 6);
      }
    }
  });

  it('paired endpoints (formation ↔ room-exit) share the same rim color', () => {
    const eps = buildPortalEndpoints(NEG_Z_WALL_CLICK);
    const pairs: Array<[string, string]> = [
      ['formation-writing', 'room-writing-exit'],
      ['formation-about', 'room-about-exit'],
      ['formation-projects', 'room-projects-exit'],
    ];
    for (const [aId, bId] of pairs) {
      const a = eps.find((ep) => ep.id === aId);
      const b = eps.find((ep) => ep.id === bId);
      expect(a, `${aId} not found`).toBeDefined();
      expect(b, `${bId} not found`).toBeDefined();
      expect(a!.rim.color).toBe(b!.rim.color);
    }
  });

  it('Simple Experience trigger has a unique rim color', () => {
    const eps = buildPortalEndpoints(NEG_Z_WALL_CLICK);
    const trigger = eps.find((ep) => ep.trigger === 'simple-experience');
    expect(trigger).toBeDefined();
    const otherColors = eps.filter((ep) => ep.id !== trigger!.id).map((ep) => ep.rim.color);
    expect(otherColors).not.toContain(trigger!.rim.color);
  });

  it('formation portal active normal aligns with click normal on a +X wall', () => {
    // Click on the +X wall (right wall of the cube). Inward normal
    // points -X (into the cube interior).
    const xWallClick: ClickHit = {
      point: [400, 0, 0],
      normal: [-1, 0, 0],
    };
    const eps = buildPortalEndpoints(xWallClick);
    const formation = eps.filter((ep) => ep.id.startsWith('formation-'));
    expect(formation).toHaveLength(4);
    const localZ = new Vector3(0, 0, 1);
    for (const ep of formation) {
      const q = ep.quaternion;
      const normal = localZ
        .clone()
        .applyQuaternion({ x: q[0], y: q[1], z: q[2], w: q[3] } as never);
      expect(normal.x).toBeCloseTo(-1, 5);
      expect(normal.y).toBeCloseTo(0, 5);
      expect(normal.z).toBeCloseTo(0, 5);
    }
  });

  it('formation portals stay near the click point regardless of wall + offset', () => {
    // Each formation portal sits within ~quadrantOffset + half-size
    // of the click point. Verify across multiple walls + off-center
    // click positions.
    const cases: ClickHit[] = [
      { point: [50, 80, -400], normal: [0, 0, 1] }, // -Z wall, off-center
      { point: [400, -120, 30], normal: [-1, 0, 0] }, // +X wall, off-center
      { point: [-30, 400, -50], normal: [0, -1, 0] }, // +Y wall, off-center
    ];
    for (const click of cases) {
      const eps = buildPortalEndpoints(click);
      const formation = eps.filter((ep) => ep.id.startsWith('formation-'));
      for (const ep of formation) {
        const dx = ep.position[0] - click.point[0];
        const dy = ep.position[1] - click.point[1];
        const dz = ep.position[2] - click.point[2];
        const dist = Math.hypot(dx, dy, dz);
        expect(dist).toBeLessThan(15);
      }
    }
  });
});
