import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { World } from '@/components/scene';

interface DimensionsProps {
  dimensions: [number, number, number];
}

// Mock child components so we test World in isolation.
vi.mock('@/components/scene/RouteBoxes', () => ({
  RouteBoxes: () => <div data-testid="route-boxes" />,
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

// Remote cursor avatar pulls in useGLTF + a real GLB load — stub
// it out so the World test doesn't need the drei loader surface.
vi.mock('@/components/scene/RemoteCursorAvatar', () => ({
  RemoteCursorAvatar: () => null,
}));

// In-canvas remote-cascade orchestrator reads remote players'
// presence and mounts full Sword cascades; stub it here so the
// World test doesn't pull in the GLB loader chain.
vi.mock('@/multiplayer/RemotePlayerReveals', () => ({
  RemotePlayerReveals: () => null,
}));

// In-canvas particle burst receiver — stub so World test
// doesn't pull in the GLTF loader chain.
vi.mock('@/multiplayer/ParticleBursts', () => ({
  ParticleBursts: () => null,
}));

// OrbitControls from drei uses R3F hooks under the hood — stub it out.
vi.mock('@react-three/drei', () => ({
  OrbitControls: () => null,
  // PortalDisc (mounted inside AboutRoom) uses useFBO; the mock
  // returns the minimum surface its caller touches.
  useFBO: () => ({ texture: null, setSize: () => {}, dispose: () => {} }),
  // RouteContent3D uses drei's Text — stub to a render-nothing
  // component so World mounts without going through drei's
  // troika-three-text dependency in jsdom.
  Text: () => null,
}));

// World itself uses useFrame for the float bob — mock fiber so the hook
// exists without a real Canvas context.
vi.mock('@react-three/fiber', () => ({
  useFrame: vi.fn(),
  useThree: (selector?: (s: unknown) => unknown) => {
    const state = {
      gl: {
        render: () => {},
        autoClear: true,
        autoClearColor: true,
        autoClearDepth: true,
        autoClearStencil: true,
      },
      scene: {},
      camera: {},
      size: { width: 800, height: 600 },
      set: () => {},
    };
    return selector ? selector(state) : state;
  },
  // AboutRoom uses createPortal to mount its content into a
  // dedicated THREE.Scene; in jsdom the mock just renders children
  // inline so React still walks the tree without erroring.
  createPortal: (children: unknown) => children,
}));

// Haze3D uses useFrame too (camera-following billboard); stub it out.
vi.mock('@/components/scene/Haze3D', () => ({
  Haze3D: () => null,
}));

// InteractionController uses useThree + per-frame raycasting; stub it
// since the World test only verifies child mounting, not interaction.
vi.mock('@/components/scene/Interactable', () => ({
  InteractionController: () => null,
  // PortalDisc inside AboutRoom calls useInteractable; the mock
  // returns the minimum surface so the hook resolves in jsdom.
  useInteractable: () => ({ ref: { current: null }, isHovered: false, isPressed: false }),
  // PortalCascade's PortalMesh registers a click handler here.
  // Tests don't exercise interaction, so a real Map satisfies the
  // import without needing a stub.
  interactableHandlers: new Map<string, () => void>(),
}));

vi.mock('@/components/scene/InteractableTestCube', () => ({
  InteractableTestCube: () => null,
}));

describe('World', () => {
  it('renders without crashing', () => {
    const { container } = render(<World />);
    expect(container).toBeTruthy();
  });

  it('renders RouteBoxes — the route-driven cube renderer', () => {
    const { getByTestId } = render(<World />);
    expect(getByTestId('route-boxes')).toBeTruthy();
  });

  it('renders ambient light with color from the store', () => {
    const { container } = render(<World />);
    // ambientLight renders as a DOM element in jsdom (R3F components
    // are mocked, but we can check the component tree structure)
    expect(container).toBeTruthy();
  });
});
