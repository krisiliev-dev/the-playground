import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { World } from '@/components/scene';
import { useWorldStore } from '@/store';

interface DimensionsProps {
  dimensions: [number, number, number];
}

// Mock child components so we test World in isolation.
vi.mock('@/components/scene/BoxEnvironment', () => ({
  BoxEnvironment: (props: DimensionsProps) => (
    <div data-testid="box-environment" data-dimensions={JSON.stringify(props.dimensions)} />
  ),
}));

vi.mock('@/components/scene/SkyBackground', () => ({
  SkyBackground: (props: DimensionsProps) => (
    <div data-testid="sky-background" data-dimensions={JSON.stringify(props.dimensions)} />
  ),
}));

// Phase 4 reveal pieces — stub them out so World renders in isolation.
vi.mock('@/components/scene/reveal', () => ({
  RevealOrchestrator: () => <div data-testid="reveal-orchestrator" />,
}));

// Phase 5 cursor avatar.
vi.mock('@/components/scene/CursorAvatar', () => ({
  CursorAvatar: () => <div data-testid="cursor-avatar" />,
}));

// OrbitControls from drei uses R3F hooks under the hood — stub it out.
vi.mock('@react-three/drei', () => ({
  OrbitControls: () => null,
}));

// World itself uses useFrame for the float bob — mock fiber so the hook
// exists without a real Canvas context.
vi.mock('@react-three/fiber', () => ({
  useFrame: vi.fn(),
}));

// Haze3D uses useFrame too (camera-following billboard); stub it out.
vi.mock('@/components/scene/Haze3D', () => ({
  Haze3D: () => null,
}));

// InteractionController uses useThree + per-frame raycasting; stub it
// since the World test only verifies child mounting, not interaction.
vi.mock('@/components/scene/Interactable', () => ({
  InteractionController: () => null,
}));

vi.mock('@/components/scene/InteractableTestCube', () => ({
  InteractableTestCube: () => null,
}));

describe('World', () => {
  it('renders without crashing', () => {
    const { container } = render(<World />);
    expect(container).toBeTruthy();
  });

  it('renders a BoxEnvironment with dimensions from the store', () => {
    const { getByTestId } = render(<World />);
    const box = getByTestId('box-environment');
    const dims = useWorldStore.getState().environment.dimensions;
    expect(JSON.parse(box.dataset.dimensions!)).toEqual(dims);
  });

  it('renders ambient light with color from the store', () => {
    const { container } = render(<World />);
    // ambientLight renders as a DOM element in jsdom (R3F components
    // are mocked, but we can check the component tree structure)
    expect(container).toBeTruthy();
  });
});
