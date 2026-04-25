import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';

vi.mock('@react-three/fiber', () => ({
  useFrame: vi.fn(),
}));

// Stub each child so the orchestrator renders cleanly without R3F.
vi.mock('@/components/scene/reveal/Portal', () => ({
  Portal: () => <div data-testid="portal" />,
  PORTAL_CONSTANTS: { Z: -39.6, RADIUS: 4.5, INNER_RADIUS: 3.6, COLOR: '#00ffcc' },
}));
vi.mock('@/components/scene/reveal/Sword', () => ({
  Sword: () => <div data-testid="sword" />,
  SWORD_CONSTANTS: {},
}));
vi.mock('@/components/scene/reveal/Fracture', () => ({
  Fracture: () => <div data-testid="fracture" />,
  FRACTURE_CONSTANTS: {},
}));
vi.mock('@/components/scene/reveal/VibeText', () => ({
  VibeText: () => <div data-testid="vibe" />,
  VIBE_CONSTANTS: {},
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

  it('renders all four reveal pieces', () => {
    const { getByTestId } = render(<RevealOrchestrator />);
    expect(getByTestId('portal')).toBeTruthy();
    expect(getByTestId('sword')).toBeTruthy();
    expect(getByTestId('fracture')).toBeTruthy();
    expect(getByTestId('vibe')).toBeTruthy();
  });

  it('advances state from idle → armed on the first window click', () => {
    render(<RevealOrchestrator />);
    expect(useWorldStore.getState().revealState).toBe('idle');

    act(() => {
      window.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(useWorldStore.getState().revealState).toBe('armed');
  });
});
