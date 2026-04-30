import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { Group, PerspectiveCamera } from 'three';

vi.mock('@react-three/fiber', () => {
  const camera = new PerspectiveCamera(60, 1, 0.1, 500);
  return {
    useFrame: vi.fn(),
    useThree: (selector: (s: { camera: PerspectiveCamera }) => unknown) => selector({ camera }),
  };
});

// Stub useGLTF — return an empty group so traversal doesn't blow up.
vi.mock('@react-three/drei', () => {
  const fakeScene = new Group();
  const useGLTF = vi.fn(() => ({ scene: fakeScene }));
  (useGLTF as unknown as { preload: () => void }).preload = vi.fn();
  return { useGLTF };
});

import { Sword } from '@/components/scene/reveal/Sword';
import { VIBE_SLOTS } from '@/components/scene/reveal/vibeFormation';

describe('Sword', () => {
  it('renders without crashing', () => {
    const { container } = render(<Sword slot={VIBE_SLOTS[0]!} />);
    expect(container).toBeTruthy();
  });

  it('mounts a primitive wrapper around the GLTF scene', () => {
    const { container } = render(<Sword slot={VIBE_SLOTS[0]!} />);
    expect(container.querySelector('group')).toBeTruthy();
  });
});
