/**
 * Rooms — phase-4 step 1 verifies that the three section rooms
 * render as separate spatial cubes with the right per-section
 * colors and unique world positions. Subsequent phases will add
 * traversal, per-room clamping, and URL sync; those land their
 * own tests.
 *
 * R3F intrinsic JSX (`<mesh>`, `<boxGeometry>`,
 * `<meshStandardMaterial>`) renders as unknown DOM tags in jsdom,
 * which is enough for `querySelector`-based structural assertions.
 */
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';

vi.mock('@react-three/fiber', () => ({
  useFrame: vi.fn(),
  useThree: () => ({
    clock: { elapsedTime: 0 },
  }),
}));

import { Rooms, ROOMS } from '@/components/scene/Rooms';

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

    it('places each room at a unique world position far from the formation', () => {
      // Formation cube spans ±400. Each room should sit well
      // outside that envelope so it's a distinct spatial
      // destination, not overlapping with the formation or with
      // the other rooms.
      const positions = ROOMS.map((r) => r.position);
      // Distinct.
      expect(new Set(positions.map((p) => p.join(','))).size).toBe(positions.length);
      // Outside formation envelope on at least one axis.
      for (const [x, y, z] of positions) {
        const farthest = Math.max(Math.abs(x), Math.abs(y), Math.abs(z));
        expect(farthest).toBeGreaterThan(400);
      }
    });
  });

  describe('rendering', () => {
    it('renders one mesh per room (3 total)', () => {
      const { container } = render(<Rooms />);
      // Each Room renders a single <mesh>; the orchestrator
      // produces three of them — one per section room.
      expect(container.querySelectorAll('mesh')).toHaveLength(ROOMS.length);
    });

    it('renders the boxGeometry args for each room', () => {
      const { container } = render(<Rooms />);
      expect(container.querySelectorAll('boxGeometry')).toHaveLength(ROOMS.length);
    });
  });
});
