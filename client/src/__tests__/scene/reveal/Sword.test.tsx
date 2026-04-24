import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { Group } from 'three';

vi.mock('@react-three/fiber', () => ({
  useFrame: vi.fn(),
}));

// Stub useGLTF — return an empty group so traversal doesn't blow up.
vi.mock('@react-three/drei', () => {
  const fakeScene = new Group();
  const useGLTF = vi.fn(() => ({ scene: fakeScene }));
  // useGLTF.preload is called at module scope; provide a noop.
  (useGLTF as unknown as { preload: () => void }).preload = vi.fn();
  return { useGLTF };
});

import { Sword } from '@/components/scene/reveal/Sword';

describe('Sword', () => {
  it('renders without crashing', () => {
    const { container } = render(<Sword />);
    expect(container).toBeTruthy();
  });

  it('mounts a primitive wrapper around the GLTF scene', () => {
    const { container } = render(<Sword />);
    // primitive renders as a custom R3F element; in jsdom this surfaces
    // as a lowercase tag — we just check the root group exists.
    expect(container.querySelector('group')).toBeTruthy();
  });
});
