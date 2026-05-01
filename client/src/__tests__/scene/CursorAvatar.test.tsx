import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';

// Mock R3F hooks — they require a Canvas context that jsdom can't provide.
// gl.domElement appears in CursorAvatar's mouselook useEffect dep array, so
// it must be defined even when the effect early-returns.
vi.mock('@react-three/fiber', () => ({
  useFrame: vi.fn(),
  useThree: () => ({
    pointer: { x: 0, y: 0 },
    camera: {
      position: { x: 0, y: 0, z: 0 },
      quaternion: { x: 0, y: 0, z: 0, w: 1 },
      matrixWorld: { elements: [] },
      projectionMatrixInverse: { elements: [] },
      fov: 60,
      aspect: 1,
    },
    gl: { domElement: document.createElement('canvas') },
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

  it('restores the system cursor when the pause menu opens, re-hides on close', () => {
    useWorldStore.setState({ menuOpen: false });
    useWorldStore.getState().setCursorAvatarActive(true);
    const { rerender } = render(<CursorAvatar />);
    expect(document.body.style.cursor).toBe('none');

    // Menu opens — the cursor effect re-runs because menuOpen is in
    // its dep array; the cleanup of the previous run restores the
    // body cursor, and the new run early-returns (no hiding).
    useWorldStore.setState({ menuOpen: true });
    rerender(<CursorAvatar />);
    expect(document.body.style.cursor).not.toBe('none');

    // Menu closes — the effect re-runs again, this time taking the
    // hide path because menuOpen is false and active is still true.
    useWorldStore.setState({ menuOpen: false });
    rerender(<CursorAvatar />);
    expect(document.body.style.cursor).toBe('none');
  });
});
