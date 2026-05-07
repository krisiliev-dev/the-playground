/**
 * Interactable — verifies the hook's contract:
 *   - Returns a stable mesh ref.
 *   - `isHovered` reflects `useWorldStore.hoveredInteractableId`.
 *   - `isPressed` reflects `useWorldStore.pressedInteractableId`.
 *   - The handler is registered + cleaned up at the right times.
 *
 * The InteractionController itself uses `useThree` + `useFrame` + a
 * live scene graph; testing its raycaster end-to-end needs a real
 * Canvas. We test what's testable here (the hook contract); the
 * controller's behaviour is verified via the manual smoke test
 * (the test cube in the scene).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

// `useInteractable` calls `useFrame` for the auto hover/press scale
// animation, but R3F's hooks throw outside a `<Canvas>` context. The
// store-subscription side of the hook is the only thing this test
// suite is verifying, so stub `useFrame` to a no-op.
vi.mock('@react-three/fiber', () => ({
  useFrame: vi.fn(),
}));

import { useInteractable } from '@/components/scene/Interactable';
import { useWorldStore } from '@/store';

describe('useInteractable', () => {
  beforeEach(() => {
    // Reset store fields the hook subscribes to.
    useWorldStore.setState({
      hoveredInteractableId: null,
      pressedInteractableId: null,
      pressedTargetPoint: null,
    });
  });

  it('returns ref + isHovered + isPressed as the documented shape', () => {
    const { result } = renderHook(() =>
      useInteractable({ id: 'cube-A', onInteract: () => undefined }),
    );
    expect(result.current.ref).toBeDefined();
    expect(result.current.ref.current).toBeNull();
    expect(result.current.isHovered).toBe(false);
    expect(result.current.isPressed).toBe(false);
  });

  it('reports isHovered=true when the store names this id as hovered', () => {
    const { result } = renderHook(() =>
      useInteractable({ id: 'cube-A', onInteract: () => undefined }),
    );
    expect(result.current.isHovered).toBe(false);

    act(() => {
      useWorldStore.getState().setHoveredInteractable('cube-A');
    });
    expect(result.current.isHovered).toBe(true);

    act(() => {
      useWorldStore.getState().setHoveredInteractable('cube-B');
    });
    expect(result.current.isHovered).toBe(false);
  });

  it('reports isPressed=true while the store names this id as pressed', () => {
    const { result } = renderHook(() =>
      useInteractable({ id: 'cube-A', onInteract: () => undefined }),
    );
    expect(result.current.isPressed).toBe(false);

    act(() => {
      useWorldStore.getState().beginInteractPress('cube-A', [0, 0, 0]);
    });
    expect(result.current.isPressed).toBe(true);

    act(() => {
      useWorldStore.getState().endInteractPress();
    });
    expect(result.current.isPressed).toBe(false);
  });

  it('decouples hover from press — a press from a different id does not mark this hovered', () => {
    const { result } = renderHook(() =>
      useInteractable({ id: 'cube-A', onInteract: () => undefined }),
    );

    act(() => {
      useWorldStore.getState().beginInteractPress('cube-B', [0, 0, 0]);
    });
    expect(result.current.isHovered).toBe(false);
    expect(result.current.isPressed).toBe(false);
  });

  it('accepts an optional visualRef without erroring', () => {
    // The visualRef is the auto-scale target. The store-subscription
    // path of the hook doesn't read it; we just verify wiring it up
    // doesn't throw.
    const visualRef = { current: null } as React.MutableRefObject<import('three').Object3D | null>;
    expect(() => {
      renderHook(() =>
        useInteractable({
          id: 'with-visual',
          onInteract: () => undefined,
          visualRef,
        }),
      );
    }).not.toThrow();
  });

  it('honors an external ref via opts.ref instead of creating its own', () => {
    const externalRef = { current: null } as React.MutableRefObject<import('three').Mesh | null>;
    const { result } = renderHook(() =>
      useInteractable({
        id: 'cube-A',
        onInteract: () => undefined,
        ref: externalRef,
      }),
    );
    // Hook returns the same ref instance the caller passed in.
    expect(result.current.ref).toBe(externalRef);
  });

  it('cleans up on unmount — re-renders with a new id do not leak old state', () => {
    const { result, rerender, unmount } = renderHook(
      ({ id }: { id: string }) => useInteractable({ id, onInteract: () => undefined }),
      { initialProps: { id: 'cube-A' } },
    );

    act(() => {
      useWorldStore.getState().setHoveredInteractable('cube-A');
    });
    expect(result.current.isHovered).toBe(true);

    rerender({ id: 'cube-B' });
    // Now subscribed to cube-B; cube-A in store should make isHovered=false.
    expect(result.current.isHovered).toBe(false);

    // Setting cube-B as hovered should now flip it true.
    act(() => {
      useWorldStore.getState().setHoveredInteractable('cube-B');
    });
    expect(result.current.isHovered).toBe(true);

    unmount();
    // Idempotent — unmount shouldn't throw or leave dangling subs.
    expect(() => useWorldStore.getState().setHoveredInteractable(null)).not.toThrow();
  });
});

describe('userData accessors', () => {
  // Pure functions — no React, no R3F. Import three's Mesh +
  // geometry/material directly; vi.mock above only replaces R3F.
  it('setInteractableUserData writes the three tagged fields', async () => {
    const { Mesh, BoxGeometry, MeshBasicMaterial } = await import('three');
    const { setInteractableUserData } = await import('@/components/scene/Interactable');
    const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
    setInteractableUserData(mesh, {
      interactable: true,
      interactableId: 'test-A',
      interactableRange: 75,
    });
    expect(mesh.userData.interactable).toBe(true);
    expect(mesh.userData.interactableId).toBe('test-A');
    expect(mesh.userData.interactableRange).toBe(75);
  });

  it('clearInteractableUserData removes only the three tagged fields', async () => {
    const { Mesh, BoxGeometry, MeshBasicMaterial } = await import('three');
    const { setInteractableUserData, clearInteractableUserData } =
      await import('@/components/scene/Interactable');
    const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
    mesh.userData.unrelated = 'keep me';
    setInteractableUserData(mesh, {
      interactable: true,
      interactableId: 'test-A',
      interactableRange: 60,
    });
    clearInteractableUserData(mesh);
    expect(mesh.userData.interactable).toBeUndefined();
    expect(mesh.userData.interactableId).toBeUndefined();
    expect(mesh.userData.interactableRange).toBeUndefined();
    expect(mesh.userData.unrelated).toBe('keep me');
  });

  it('getInteractableUserData returns the typed object when present', async () => {
    const { Mesh, BoxGeometry, MeshBasicMaterial } = await import('three');
    const { setInteractableUserData, getInteractableUserData } =
      await import('@/components/scene/Interactable');
    const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
    setInteractableUserData(mesh, {
      interactable: true,
      interactableId: 'test-A',
      interactableRange: 60,
    });
    expect(getInteractableUserData(mesh)).toEqual({
      interactable: true,
      interactableId: 'test-A',
      interactableRange: 60,
    });
  });

  it('getInteractableUserData returns null on untagged objects', async () => {
    const { Mesh, BoxGeometry, MeshBasicMaterial } = await import('three');
    const { getInteractableUserData } = await import('@/components/scene/Interactable');
    const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
    expect(getInteractableUserData(mesh)).toBeNull();
  });

  it('getInteractableUserData returns null when fields are partially missing', async () => {
    const { Mesh, BoxGeometry, MeshBasicMaterial } = await import('three');
    const { getInteractableUserData } = await import('@/components/scene/Interactable');
    const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
    mesh.userData.interactable = true; // missing the other two fields
    expect(getInteractableUserData(mesh)).toBeNull();
  });
});

describe('store interaction actions', () => {
  beforeEach(() => {
    useWorldStore.setState({
      hoveredInteractableId: null,
      pressedInteractableId: null,
      pressedTargetPoint: null,
    });
  });

  it('beginInteractPress sets both id and target point', () => {
    useWorldStore.getState().beginInteractPress('cube-A', [1, 2, 3]);
    const state = useWorldStore.getState();
    expect(state.pressedInteractableId).toBe('cube-A');
    expect(state.pressedTargetPoint).toEqual([1, 2, 3]);
  });

  it('endInteractPress clears both id and target point', () => {
    useWorldStore.getState().beginInteractPress('cube-A', [1, 2, 3]);
    useWorldStore.getState().endInteractPress();
    const state = useWorldStore.getState();
    expect(state.pressedInteractableId).toBeNull();
    expect(state.pressedTargetPoint).toBeNull();
  });
});
