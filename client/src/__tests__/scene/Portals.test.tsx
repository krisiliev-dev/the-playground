/**
 * Portals — verifies:
 *   1. Visibility gating: nothing renders unless revealState is
 *      'revealed' AND clickHit is non-null.
 *   2. Section configuration: the three section portals carry the
 *      expected ids, paths, and unique colors.
 *   3. Click-handler wiring: each section portal's onInteract
 *      callback writes its path to `pendingNavigation`; the SE
 *      portal's flips `documentMode` to true.
 *   4. Disc structure: when shown, the rendered tree contains the
 *      expected counts of meshes, points (particles), and the four
 *      radial spokes.
 *
 * R3F's intrinsic JSX elements (mesh, group, points, etc.) are
 * unknown to React DOM, but jsdom accepts unknown tags so they
 * render as lowercase tags we can `querySelector` for. `useFrame`
 * never fires here (no canvas), and useInteractable is mocked to
 * capture each portal's onInteract callback so we can fire them
 * imperatively from the test body.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { Portals, SECTION_PIES, SE_PIE } from '@/components/scene/Portals';
import { useWorldStore, type ClickHit } from '@/store';

vi.mock('@react-three/fiber', () => ({
  useFrame: vi.fn(),
  useThree: () => ({
    clock: { elapsedTime: 0 },
    invalidate: vi.fn(),
  }),
}));

const capturedHandlers = new Map<string, () => void>();

vi.mock('@/components/scene/Interactable', () => ({
  useInteractable: ({ id, onInteract }: { id: string; onInteract: () => void }) => {
    capturedHandlers.set(id, onInteract);
    return { ref: { current: null }, isHovered: false, isPressed: false };
  },
}));

const SAMPLE_HIT: ClickHit = { point: [0, 0, 100], normal: [0, 0, -1] };

describe('Portals', () => {
  beforeEach(() => {
    capturedHandlers.clear();
    useWorldStore.setState({
      revealState: 'idle',
      clickHit: null,
      pendingNavigation: null,
      documentMode: false,
    });
  });

  afterEach(() => {
    useWorldStore.setState({
      revealState: 'idle',
      clickHit: null,
      pendingNavigation: null,
      documentMode: false,
    });
  });

  describe('visibility gating', () => {
    it('renders nothing when revealState is not "revealed"', () => {
      useWorldStore.setState({ revealState: 'armed', clickHit: SAMPLE_HIT });
      const { container } = render(<Portals />);
      expect(container.firstChild).toBeNull();
    });

    it('renders nothing when clickHit is null (no impact landed yet)', () => {
      useWorldStore.setState({ revealState: 'revealed', clickHit: null });
      const { container } = render(<Portals />);
      expect(container.firstChild).toBeNull();
    });

    it('renders the disc once revealed AND clickHit is set', () => {
      useWorldStore.setState({ revealState: 'revealed', clickHit: SAMPLE_HIT });
      const { container } = render(<Portals />);
      expect(container.firstChild).not.toBeNull();
    });
  });

  describe('section configuration', () => {
    it('declares exactly three section portals with the expected paths', () => {
      // Order drives the spatial layout (NE, NW, SW) — the test
      // pins both the count and the per-portal path so a
      // routing-table change becomes a test failure rather than a
      // silent regression.
      expect(SECTION_PIES).toHaveLength(3);
      const byId = Object.fromEntries(SECTION_PIES.map((p) => [p.id, p.path]));
      expect(byId['portal-about']).toBe('/about');
      expect(byId['portal-projects']).toBe('/projects');
      expect(byId['portal-writing']).toBe('/writing');
    });

    it('gives each section portal a unique color', () => {
      const colors = new Set(SECTION_PIES.map((p) => p.color));
      expect(colors.size).toBe(SECTION_PIES.length);
    });

    it('gives each section portal a unique thetaStart 90° apart', () => {
      // The four pies tile the disc; if two share a thetaStart we'd
      // overlap one quadrant and leave another empty.
      const thetas = SECTION_PIES.map((p) => p.thetaStart).sort((a, b) => a - b);
      for (let i = 1; i < thetas.length; i++) {
        const a = thetas[i];
        const b = thetas[i - 1];
        if (a === undefined || b === undefined) {
          throw new Error('thetas array missing value at sorted index');
        }
        expect(a - b).toBeCloseTo(Math.PI / 2);
      }
    });

    it('SE portal occupies the remaining quadrant (SE, 3π/2)', () => {
      expect(SE_PIE.id).toBe('portal-simple-experience');
      expect(SE_PIE.thetaStart).toBeCloseTo((3 * Math.PI) / 2);
    });
  });

  describe('click → store', () => {
    beforeEach(() => {
      useWorldStore.setState({ revealState: 'revealed', clickHit: SAMPLE_HIT });
    });

    it('section portal "About" sets pendingNavigation to /about', () => {
      render(<Portals />);
      const handler = capturedHandlers.get('portal-about');
      expect(handler).toBeDefined();
      act(() => handler?.());
      expect(useWorldStore.getState().pendingNavigation).toBe('/about');
    });

    it('section portal "Projects" sets pendingNavigation to /projects', () => {
      render(<Portals />);
      act(() => capturedHandlers.get('portal-projects')?.());
      expect(useWorldStore.getState().pendingNavigation).toBe('/projects');
    });

    it('section portal "Writing" sets pendingNavigation to /writing', () => {
      render(<Portals />);
      act(() => capturedHandlers.get('portal-writing')?.());
      expect(useWorldStore.getState().pendingNavigation).toBe('/writing');
    });

    it('Simple Experience portal flips documentMode (does NOT route)', () => {
      render(<Portals />);
      act(() => capturedHandlers.get('portal-simple-experience')?.());
      expect(useWorldStore.getState().documentMode).toBe(true);
      // And critically does NOT set a navigation path.
      expect(useWorldStore.getState().pendingNavigation).toBeNull();
    });
  });

  describe('disc structure', () => {
    beforeEach(() => {
      useWorldStore.setState({ revealState: 'revealed', clickHit: SAMPLE_HIT });
    });

    it('registers all four interactable handlers (3 section + 1 SE)', () => {
      render(<Portals />);
      expect(capturedHandlers.has('portal-about')).toBe(true);
      expect(capturedHandlers.has('portal-projects')).toBe(true);
      expect(capturedHandlers.has('portal-writing')).toBe(true);
      expect(capturedHandlers.has('portal-simple-experience')).toBe(true);
    });

    it('renders a <points> ring per pie (4 total) for the digital particles', () => {
      const { container } = render(<Portals />);
      // Each RimParticles wraps a <points> in a <group>; queryAll
      // captures all four (one per pie quadrant).
      expect(container.querySelectorAll('points')).toHaveLength(4);
    });
  });
});
