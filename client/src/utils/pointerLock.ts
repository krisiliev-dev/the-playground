/**
 * Acquire pointer-lock on the live `<canvas>` element if it isn't
 * already locked. Returns `true` if a request was issued (the
 * browser may still reject it asynchronously — most commonly when
 * the call wasn't inside a user-gesture window), `false` if there
 * was no canvas to lock or the API is unavailable.
 *
 * Centralises three near-identical call sites (PauseMenu close,
 * ControlsHint dismissal, and the document → 3D transition in
 * App.tsx) — each previously hand-rolled the same instanceof +
 * typeof + pointerLockElement check, so any guard tightening would
 * have had to be applied in three places.
 */
export function acquirePointerLock(): boolean {
  if (typeof document === 'undefined') {
    return false;
  }
  const canvas = document.querySelector('canvas');
  if (!(canvas instanceof HTMLCanvasElement) || typeof canvas.requestPointerLock !== 'function') {
    return false;
  }
  if (document.pointerLockElement === canvas) {
    return false;
  }
  void canvas.requestPointerLock();
  return true;
}
