import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';

// Mock R3F hooks — they require a Canvas context that jsdom can't provide.
vi.mock('@react-three/fiber', () => ({
  useFrame: vi.fn(),
  useThree: () => ({
    pointer: { x: 0, y: 0 },
    camera: {
      position: { x: 0, y: 0, z: 0 },
      matrixWorld: { elements: [] },
      projectionMatrixInverse: { elements: [] },
    },
  }),
}));

// Mock useGLTF so the component can be rendered without an actual GLB
// loader pipeline (which depends on draco/gltf parsing not present in jsdom).
// The factory is hoisted, so we keep its body self-contained — `await import`
// the real `three` module and build a stub scene there.
vi.mock('@react-three/drei', async () => {
  const three = await import('three');
  const stubScene = new three.Group();
  const useGLTF = Object.assign(
    vi.fn(() => ({ scene: stubScene })),
    { preload: vi.fn() },
  );
  return { useGLTF };
});

import { CursorAvatar } from '@/components/scene/CursorAvatar';
import { useWorldStore } from '@/store';

describe('CursorAvatar', () => {
  beforeEach(() => {
    useWorldStore.getState().setCursorAvatarActive(false);
    document.body.style.cursor = '';
  });

  afterEach(() => {
    useWorldStore.getState().setCursorAvatarActive(false);
    document.body.style.cursor = '';
  });

  it('renders no 3D content when cursorAvatarActive is false', () => {
    const { container } = render(<CursorAvatar />);
    // The "active" branch renders a <group> + <primitive>; when inactive
    // only the visibility-toggle component is mounted (returns null).
    expect(container.querySelector('group')).toBeNull();
    expect(container.querySelector('primitive')).toBeNull();
  });

  it('does NOT hide the system cursor when inactive', () => {
    render(<CursorAvatar />);
    expect(document.body.style.cursor).not.toBe('none');
  });

  it('renders the 3D group + primitive when cursorAvatarActive is true', () => {
    useWorldStore.getState().setCursorAvatarActive(true);
    const { container } = render(<CursorAvatar />);
    expect(container.querySelector('group')).not.toBeNull();
    expect(container.querySelector('primitive')).not.toBeNull();
  });

  it('hides the system cursor when active and restores it on deactivate', () => {
    useWorldStore.getState().setCursorAvatarActive(true);
    const { rerender } = render(<CursorAvatar />);
    expect(document.body.style.cursor).toBe('none');

    useWorldStore.getState().setCursorAvatarActive(false);
    rerender(<CursorAvatar />);
    // After deactivation, the previous (empty) cursor style is restored.
    expect(document.body.style.cursor).not.toBe('none');
  });
});
