/**
 * InteractionController — integration coverage for the click-handler
 * path. The raycaster lives inside useFrame and needs a real Canvas to
 * exercise end-to-end; we mock useFrame as a no-op (the React refs
 * inside the controller stay alive) and drive the click pipeline by
 * manipulating the store + dispatching window events directly.
 *
 * What this covers:
 *   - Mount / unmount lifecycle with mocked R3F.
 *   - The pure `planRelease` decision function (synchronous-vs-deferred
 *     release based on held duration).
 *   - mouseup commit path: when pressedInteractableId === hoveredId,
 *     the registered handler from `interactableHandlers` fires.
 *   - Suppression gate: mouseup is a no-op while
 *     `setTouchInProgress(true)` is active.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { Group, Vector3 } from 'three';

vi.mock('@react-three/fiber', () => ({
  useFrame: vi.fn(),
  useThree: () => ({
    pointer: { x: 0, y: 0 },
    camera: {
      position: { x: 0, y: 0, z: 0 },
      quaternion: { x: 0, y: 0, z: 0, w: 1 },
    },
    scene: new Group(),
    gl: { domElement: document.createElement('canvas') },
  }),
}));

import {
  InteractionController,
  MIN_PRESS_HOLD_MS,
  interactableHandlers,
  planRelease,
  setTouchInProgress,
} from '@/components/scene/Interactable';
import { useWorldStore } from '@/store';

describe('planRelease', () => {
  it('immediate=true when heldMs ≥ minPressMs', () => {
    expect(planRelease(MIN_PRESS_HOLD_MS, MIN_PRESS_HOLD_MS)).toEqual({
      immediate: true,
      delayMs: 0,
    });
    expect(planRelease(MIN_PRESS_HOLD_MS + 100, MIN_PRESS_HOLD_MS)).toEqual({
      immediate: true,
      delayMs: 0,
    });
  });

  it('defers with the remaining time when heldMs < minPressMs', () => {
    expect(planRelease(0, MIN_PRESS_HOLD_MS)).toEqual({
      immediate: false,
      delayMs: MIN_PRESS_HOLD_MS,
    });
    expect(planRelease(50, 130)).toEqual({ immediate: false, delayMs: 80 });
  });

  it('boundary — at exactly minPressMs, releases immediately (>= comparison)', () => {
    const plan = planRelease(130, 130);
    expect(plan.immediate).toBe(true);
  });

  it('handles negative heldMs defensively (returns full delay)', () => {
    // A clock skew or fake-timer reset could in principle produce a
    // negative heldMs. The pure function clamps via the < comparison
    // and returns minPressMs - (-1) = minPressMs + 1 ms — slightly
    // longer than necessary but not catastrophic.
    expect(planRelease(-1, 130)).toEqual({ immediate: false, delayMs: 131 });
  });
});

describe('InteractionController mount / unmount', () => {
  beforeEach(() => {
    useWorldStore.setState({
      controlsDismissed: false,
      hoveredInteractableId: null,
      pressedInteractableId: null,
      pressedTargetPoint: null,
    });
    interactableHandlers.clear();
    setTouchInProgress(false);
  });

  afterEach(() => {
    interactableHandlers.clear();
  });

  it('renders null and does not throw on mount', () => {
    expect(() => render(<InteractionController />)).not.toThrow();
  });

  it('cleans up window event listeners on unmount', () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    const { unmount } = render(<InteractionController />);
    const downAdds = addSpy.mock.calls.filter(([type]) => type === 'mousedown').length;
    const upAdds = addSpy.mock.calls.filter(([type]) => type === 'mouseup').length;
    expect(downAdds).toBeGreaterThanOrEqual(1);
    expect(upAdds).toBeGreaterThanOrEqual(1);

    unmount();

    const downRemoves = removeSpy.mock.calls.filter(([type]) => type === 'mousedown').length;
    const upRemoves = removeSpy.mock.calls.filter(([type]) => type === 'mouseup').length;
    expect(downRemoves).toBeGreaterThanOrEqual(downAdds);
    expect(upRemoves).toBeGreaterThanOrEqual(upAdds);
    addSpy.mockRestore();
    removeSpy.mockRestore();
  });
});

describe('InteractionController click commit path', () => {
  beforeEach(() => {
    // Suppression module-state can carry across files: the prior test
    // suite ends with `setTouchInProgress(false)` which arms a 400 ms
    // buffer. Use fake timers + advance past it so the controller's
    // handlers actually run when we dispatch events.
    vi.useFakeTimers({ toFake: ['performance', 'setTimeout', 'clearTimeout', 'Date'] });
    setTouchInProgress(false);
    vi.advanceTimersByTime(500);
    useWorldStore.setState({
      controlsDismissed: true, // gate is open; controller's handlers run
      hoveredInteractableId: null,
      pressedInteractableId: null,
      pressedTargetPoint: null,
    });
    interactableHandlers.clear();
  });

  afterEach(() => {
    interactableHandlers.clear();
    vi.useRealTimers();
  });

  it('mouseup fires the registered handler when pressed === hovered', () => {
    const handler = vi.fn();
    interactableHandlers.set('cube-A', handler);
    useWorldStore.setState({
      hoveredInteractableId: 'cube-A',
    });
    useWorldStore.getState().beginInteractPress('cube-A', [0, 0, 0]);

    render(<InteractionController />);

    window.dispatchEvent(new MouseEvent('mouseup'));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('mouseup does NOT fire handler if cursor wandered off (pressed !== hovered)', () => {
    const handler = vi.fn();
    interactableHandlers.set('cube-A', handler);
    useWorldStore.setState({
      hoveredInteractableId: 'cube-B', // different from pressed
    });
    useWorldStore.getState().beginInteractPress('cube-A', [0, 0, 0]);

    render(<InteractionController />);
    window.dispatchEvent(new MouseEvent('mouseup'));
    expect(handler).not.toHaveBeenCalled();
  });

  it('mouseup is a no-op when no press is active', () => {
    const handler = vi.fn();
    interactableHandlers.set('cube-A', handler);
    useWorldStore.setState({
      hoveredInteractableId: 'cube-A',
      // pressedInteractableId stays null — no beginInteractPress called
    });

    render(<InteractionController />);
    window.dispatchEvent(new MouseEvent('mouseup'));
    expect(handler).not.toHaveBeenCalled();
  });

  it('mouseup is suppressed entirely while a touch is in progress (iOS synth-event gate)', () => {
    const handler = vi.fn();
    interactableHandlers.set('cube-A', handler);
    useWorldStore.setState({ hoveredInteractableId: 'cube-A' });
    useWorldStore.getState().beginInteractPress('cube-A', [0, 0, 0]);

    setTouchInProgress(true); // synthetic mouseup from iOS would otherwise reach us

    render(<InteractionController />);
    window.dispatchEvent(new MouseEvent('mouseup'));
    expect(handler).not.toHaveBeenCalled();

    setTouchInProgress(false);
  });

  it('clears the pressed state on mouseup (long-held synchronous path)', () => {
    // Note: pressStartTime is closure-internal — without driving the
    // controller's own onMouseDown (which needs a populated `latestHit`
    // ref from the live raycaster) we can't simulate a *short* press.
    // pressStartTime stays at its initial 0; performance.now() under
    // these fake timers is well past 0 (advanced past the suppression
    // buffer in beforeEach), so heldMs is large → planRelease returns
    // immediate. This pins the mouseup→cleanup path; the deferred
    // timing branch is covered by `planRelease` tests above.
    useWorldStore.setState({ hoveredInteractableId: 'cube-A' });
    useWorldStore.getState().beginInteractPress('cube-A', [0, 0, 0]);

    render(<InteractionController />);
    window.dispatchEvent(new MouseEvent('mouseup'));

    expect(useWorldStore.getState().pressedInteractableId).toBeNull();
    expect(useWorldStore.getState().pressedTargetPoint).toBeNull();
  });
});

// Use Vector3 once so the import isn't dead — keeps three's tree-shake
// from accidentally complaining when more elaborate scene mocks land.
void new Vector3();
