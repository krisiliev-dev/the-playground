/**
 * `acquirePointerLock` — shared helper that wraps the
 * canvas-instanceof + API-typeof + already-locked checks used by
 * PauseMenu, ControlsHint, and App's doc → 3D handoff.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { acquirePointerLock } from '@/utils';

function makeCanvas(opts: { withApi?: boolean } = {}): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  if (opts.withApi !== false) {
    // The real `requestPointerLock` is on the prototype; jsdom's
    // version omits it. Patching the instance keeps the test self-
    // contained (no global mutation needed for the no-API case).
    (canvas as unknown as { requestPointerLock: () => void }).requestPointerLock = vi.fn();
  }
  return canvas;
}

describe('acquirePointerLock', () => {
  let canvas: HTMLCanvasElement | null = null;

  afterEach(() => {
    if (canvas && canvas.parentNode) {
      canvas.parentNode.removeChild(canvas);
    }
    canvas = null;
    // Reset pointerLockElement override if any test set it.
    Object.defineProperty(document, 'pointerLockElement', {
      configurable: true,
      value: null,
    });
  });

  it('returns false when no canvas is in the DOM', () => {
    expect(acquirePointerLock()).toBe(false);
  });

  it('returns false when the canvas lacks requestPointerLock', () => {
    canvas = makeCanvas({ withApi: false });
    document.body.appendChild(canvas);
    expect(acquirePointerLock()).toBe(false);
  });

  it('returns false (and does not re-request) when the canvas is already pointer-locked', () => {
    canvas = makeCanvas();
    document.body.appendChild(canvas);
    Object.defineProperty(document, 'pointerLockElement', {
      configurable: true,
      value: canvas,
    });
    expect(acquirePointerLock()).toBe(false);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(canvas.requestPointerLock).not.toHaveBeenCalled();
  });

  it('calls requestPointerLock and returns true when the canvas is unlocked', () => {
    canvas = makeCanvas();
    document.body.appendChild(canvas);
    expect(acquirePointerLock()).toBe(true);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(canvas.requestPointerLock).toHaveBeenCalledTimes(1);
  });
});
