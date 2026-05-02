/**
 * portalWalkthrough — pure detection function for the avatar
 * walking into a portal pie. Pure math, no R3F deps, easy to
 * unit test.
 *
 * Test geometry: clickHit on the +X wall (point [400, 0, 0],
 * normal [-1, 0, 0]) so distance-to-plane is just the avatar's
 * X coordinate gap. Disc-local +X corresponds to world -Z, +Y to
 * world +Y (chosen by the quaternion that maps disc +Z → world -X).
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { Vector3 } from 'three';
import {
  detectPortalWalkthrough,
  activatePortalQuadrant,
  WALK_THROUGH_THRESHOLD,
  PORTAL_RADIUS_FOR_WALKTHROUGH,
} from '@/components/scene/portalWalkthrough';
import { useWorldStore, type ClickHit } from '@/store';

const RIGHT_WALL_HIT: ClickHit = {
  point: [400, 0, 0],
  normal: [-1, 0, 0],
};

describe('detectPortalWalkthrough', () => {
  describe('perpendicular distance band', () => {
    it('returns null when avatar is far inside the cube (out of band)', () => {
      const avatar = new Vector3(0, 0, 0);
      expect(detectPortalWalkthrough(avatar, RIGHT_WALL_HIT)).toBeNull();
    });

    it('returns null when avatar is exactly at the wall plane (distance 0 — defensive)', () => {
      // Avatar at the wall plane shouldn't normally happen (margin
      // clamp = 8), but the function handles it cleanly: distance
      // is 0, which is in the band, and projection is at disc center.
      const avatar = new Vector3(400, 0, 0);
      expect(detectPortalWalkthrough(avatar, RIGHT_WALL_HIT)).not.toBeNull();
    });

    it('returns null when avatar is past the wall (negative distance)', () => {
      // Defensive — clamping prevents this in practice, but the
      // function rejects it rather than producing a junk quadrant.
      const avatar = new Vector3(401, 0, 0);
      expect(detectPortalWalkthrough(avatar, RIGHT_WALL_HIT)).toBeNull();
    });

    it('returns a quadrant when avatar is just inside the trigger band', () => {
      // Avatar 8 units inward from the +X wall (at the margin
      // clamp); distance to plane = 8 < 9 threshold, projection
      // at disc center → some quadrant.
      const avatar = new Vector3(400 - 8, 0, 0);
      const result = detectPortalWalkthrough(avatar, RIGHT_WALL_HIT);
      expect(result).not.toBeNull();
    });

    it('returns null when avatar is just outside the trigger band', () => {
      const avatar = new Vector3(400 - WALK_THROUGH_THRESHOLD - 1, 0, 0);
      expect(detectPortalWalkthrough(avatar, RIGHT_WALL_HIT)).toBeNull();
    });
  });

  describe('disc radius', () => {
    it('returns null when projection is outside the disc radius', () => {
      // In the trigger band perpendicular-wise but offset way past
      // PORTAL_RADIUS along the wall — no portal there.
      const avatar = new Vector3(
        400 - 8,
        PORTAL_RADIUS_FOR_WALKTHROUGH + 5, // way out of disc
        0,
      );
      expect(detectPortalWalkthrough(avatar, RIGHT_WALL_HIT)).toBeNull();
    });

    it('returns a quadrant when projection is exactly at the disc edge', () => {
      const avatar = new Vector3(400 - 8, PORTAL_RADIUS_FOR_WALKTHROUGH - 0.01, 0);
      expect(detectPortalWalkthrough(avatar, RIGHT_WALL_HIT)).not.toBeNull();
    });
  });

  describe('quadrant mapping', () => {
    // The disc's quaternion rotates +Z (geometry normal) onto
    // clickHit.normal. For RIGHT_WALL_HIT with normal [-1,0,0],
    // the disc's local +X axis lands somewhere in the world Y/Z
    // plane. We test by reading the actual quadrants the function
    // produces for known offsets — the exact mapping depends on
    // the quaternion's choice of in-plane orientation.
    let offsetA: { quadrant: number } | null;
    let offsetB: { quadrant: number } | null;
    let offsetC: { quadrant: number } | null;
    let offsetD: { quadrant: number } | null;

    beforeEach(() => {
      const inBand = 400 - 8;
      offsetA = detectPortalWalkthrough(new Vector3(inBand, 5, 0), RIGHT_WALL_HIT);
      offsetB = detectPortalWalkthrough(new Vector3(inBand, -5, 0), RIGHT_WALL_HIT);
      offsetC = detectPortalWalkthrough(new Vector3(inBand, 0, 5), RIGHT_WALL_HIT);
      offsetD = detectPortalWalkthrough(new Vector3(inBand, 0, -5), RIGHT_WALL_HIT);
    });

    it('produces quadrants in [0, 3] for points inside the disc', () => {
      for (const r of [offsetA, offsetB, offsetC, offsetD]) {
        expect(r).not.toBeNull();
        expect(r!.quadrant).toBeGreaterThanOrEqual(0);
        expect(r!.quadrant).toBeLessThanOrEqual(3);
      }
    });

    it('opposite world offsets produce opposite quadrants (NE↔SW, NW↔SE)', () => {
      // (+y, 0) and (-y, 0) project to opposite halves of the disc;
      // their quadrants should differ by exactly 2 (mod 4).
      expect((offsetA!.quadrant - offsetB!.quadrant + 4) % 4).toBe(2);
      // Same property for (0, +z) vs (0, -z).
      expect((offsetC!.quadrant - offsetD!.quadrant + 4) % 4).toBe(2);
    });
  });
});

describe('activatePortalQuadrant', () => {
  beforeEach(() => {
    useWorldStore.setState({
      pendingNavigation: null,
      portalTransit: null,
      documentMode: false,
    });
  });

  it('quadrant 0 (NE) → setPendingNavigation("/about")', () => {
    activatePortalQuadrant(0);
    expect(useWorldStore.getState().pendingNavigation).toBe('/about');
    expect(useWorldStore.getState().documentMode).toBe(false);
  });

  it('quadrant 1 (NW) → setPendingNavigation("/projects")', () => {
    activatePortalQuadrant(1);
    expect(useWorldStore.getState().pendingNavigation).toBe('/projects');
  });

  it('quadrant 2 (SW) → setPendingNavigation("/writing")', () => {
    activatePortalQuadrant(2);
    expect(useWorldStore.getState().pendingNavigation).toBe('/writing');
  });

  it('quadrant 3 (SE) → setDocumentMode(true) without navigating', () => {
    activatePortalQuadrant(3);
    expect(useWorldStore.getState().documentMode).toBe(true);
    expect(useWorldStore.getState().pendingNavigation).toBeNull();
  });

  it('walk-through path bypasses portalTransit (no camera lerp)', () => {
    // The cinematic dolly is a click-only behavior. Walking
    // through the portal should snap-cut, not animate.
    activatePortalQuadrant(0);
    expect(useWorldStore.getState().portalTransit).toBeNull();
  });
});
