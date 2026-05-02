/**
 * Rooms — phase-4 step 1 verifies that the three section rooms
 * render as separate spatial cubes with section-matched colors
 * and lateral slots that line up correctly with the user's
 * left-to-right view through the disc. The position computation
 * is a pure function (`computeRoomPosition`), tested directly
 * without mounting R3F.
 *
 * Subsequent phases will add traversal, per-room clamping, and
 * URL sync; those land their own tests.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';

vi.mock('@react-three/fiber', () => ({
  useFrame: vi.fn(),
  useThree: () => ({
    clock: { elapsedTime: 0 },
  }),
}));

import { Rooms, ROOMS, computeRoomPosition } from '@/components/scene/Rooms';
import { useWorldStore, type ClickHit } from '@/store';

const RIGHT_WALL_HIT: ClickHit = {
  point: [400, 0, 0],
  normal: [-1, 0, 0],
};

const BACK_WALL_HIT: ClickHit = {
  point: [0, 0, 400],
  normal: [0, 0, -1],
};

describe('Rooms', () => {
  describe('configuration', () => {
    it('declares exactly three section rooms (SE is documentMode, not a room)', () => {
      expect(ROOMS).toHaveLength(3);
    });

    it('maps each room to its expected route', () => {
      const byId = Object.fromEntries(ROOMS.map((r) => [r.id, r.path]));
      expect(byId['room-about']).toBe('/about');
      expect(byId['room-projects']).toBe('/projects');
      expect(byId['room-writing']).toBe('/writing');
    });

    it('gives each room a unique color matching its portal pie', () => {
      const colors = new Set(ROOMS.map((r) => r.color));
      expect(colors.size).toBe(ROOMS.length);
    });

    it('places rooms in the user-described left-to-right ordering', () => {
      // Through the disc: yellow (Writing) on left, pink (Projects)
      // in middle, blue (About) on right.
      const bySlot = new Map(ROOMS.map((r) => [r.slot, r]));
      expect(bySlot.get(-1)?.path).toBe('/writing');
      expect(bySlot.get(0)?.path).toBe('/projects');
      expect(bySlot.get(1)?.path).toBe('/about');
    });

    it('uses unique slot values so the rooms don’t overlap', () => {
      const slots = new Set(ROOMS.map((r) => r.slot));
      expect(slots.size).toBe(ROOMS.length);
    });
  });

  describe('computeRoomPosition (pure)', () => {
    it('places the room behind the wall by ROOM_BEHIND_DISTANCE', () => {
      const [x, y, z] = computeRoomPosition(RIGHT_WALL_HIT, 0);
      // RIGHT_WALL_HIT: point [400,0,0], inward normal [-1,0,0].
      // "back" = +1 along x → room at x = 400 + 1500 = 1900.
      expect(x).toBeCloseTo(1900);
      expect(y).toBeCloseTo(0);
      expect(z).toBeCloseTo(0);
    });

    it('staggers rooms left/right via the slot value', () => {
      const left = computeRoomPosition(RIGHT_WALL_HIT, -1);
      const center = computeRoomPosition(RIGHT_WALL_HIT, 0);
      const right = computeRoomPosition(RIGHT_WALL_HIT, 1);
      // For the +X wall, the user looks from -X toward +X. Their
      // "right" is world -Z (normal × world_up = (-1,0,0) × (0,1,0)
      // = (0,0,1) — but clickHit normal is the *inward* normal,
      // and our right axis is normal × world_up). Let's test the
      // *spread* rather than pin specific axes:
      // the three rooms differ along one perpendicular axis.
      const dxLR = right[0] - left[0];
      const dzLR = right[2] - left[2];
      // 2 × ROOM_SPACING worth of separation between the outermost
      // slots, on whichever axis is "right" for this wall.
      expect(Math.hypot(dxLR, dzLR)).toBeCloseTo(2 * 600);
      // Centre is the midpoint between left and right.
      expect(center[0]).toBeCloseTo((left[0] + right[0]) / 2);
      expect(center[2]).toBeCloseTo((left[2] + right[2]) / 2);
    });

    it('orientation works on different walls (room ⊥ wall normal)', () => {
      const [bx, , bz] = computeRoomPosition(BACK_WALL_HIT, 0);
      // BACK_WALL_HIT: point [0,0,400], inward normal [0,0,-1].
      // back = (0,0,1) → room at z = 400 + 1500 = 1900.
      expect(bx).toBeCloseTo(0);
      expect(bz).toBeCloseTo(1900);
    });
  });

  describe('rendering', () => {
    beforeEach(() => {
      useWorldStore.setState({ clickHit: null });
    });

    afterEach(() => {
      useWorldStore.setState({ clickHit: null });
    });

    it('renders nothing before clickHit is set (no impact yet)', () => {
      const { container } = render(<Rooms />);
      expect(container.firstChild).toBeNull();
    });

    it('renders one mesh per room when clickHit is set', () => {
      useWorldStore.setState({ clickHit: RIGHT_WALL_HIT });
      const { container } = render(<Rooms />);
      expect(container.querySelectorAll('mesh')).toHaveLength(ROOMS.length);
    });

    it('renders one boxGeometry per room', () => {
      useWorldStore.setState({ clickHit: RIGHT_WALL_HIT });
      const { container } = render(<Rooms />);
      expect(container.querySelectorAll('boxGeometry')).toHaveLength(ROOMS.length);
    });
  });
});
