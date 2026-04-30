import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';

vi.mock('@react-three/fiber', async () => {
  const three = await import('three');
  const camera = new three.PerspectiveCamera(60, 1, 0.1, 500);
  return {
    useFrame: vi.fn(),
    useThree: () => ({ camera }),
  };
});

// The orchestrator raycasts the click against the cube interior. Stub the
// helper so the click handler always lands a hit and advances the state.
vi.mock('@/utils/cubeRaycast', () => ({
  intersectInsideCube: vi.fn(() => {
    // Return a fixed hit on the back wall; structure matches the real type.
    const point = { x: 0, y: 0, z: -40 } as unknown as { x: number; y: number; z: number };
    const normal = { x: 0, y: 0, z: 1 } as unknown as { x: number; y: number; z: number };
    return { point, normal };
  }),
  CUBE_HALF_EXTENTS: { x: 40, y: 40, z: 40 },
}));

vi.mock('@/components/scene/reveal/Portal', () => ({
  Portal: () => <div data-testid="portal" />,
  PORTAL_CONSTANTS: { Z: 39.6, RADIUS: 4.5, INNER_RADIUS: 3.6, COLOR: '#00ffcc' },
}));
vi.mock('@/components/scene/reveal/Sword', () => ({
  Sword: () => <div data-testid="sword" />,
  SWORD_CONSTANTS: {},
}));
vi.mock('@/components/scene/reveal/useRevealAudio', () => ({
  useRevealAudio: vi.fn(),
  REVEAL_AUDIO_SOURCES: {},
}));

import { RevealOrchestrator } from '@/components/scene/reveal/RevealOrchestrator';
import { useWorldStore } from '@/store';

describe('RevealOrchestrator', () => {
  beforeEach(() => {
    useWorldStore.getState().resetReveal();
  });

  it('renders the reveal pieces', () => {
    const { getByTestId, getAllByTestId } = render(<RevealOrchestrator />);
    expect(getByTestId('portal')).toBeTruthy();
    // 12 sword instances spell out VIBE in the mid-pose formation
    // (V:2 + I:1 + B:5 + E:4). B is built from a spine plus two
    // angled "loops" that meet at points on the right side.
    expect(getAllByTestId('sword').length).toBe(12);
  });

  it('captures the click hit and advances state from idle → armed', () => {
    render(<RevealOrchestrator />);
    expect(useWorldStore.getState().revealState).toBe('idle');
    expect(useWorldStore.getState().clickHit).toBeNull();

    act(() => {
      window.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 100, clientY: 100 }));
    });

    expect(useWorldStore.getState().revealState).toBe('armed');
    expect(useWorldStore.getState().clickHit).not.toBeNull();
  });
});
