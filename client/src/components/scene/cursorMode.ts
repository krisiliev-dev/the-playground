/**
 * Explicit state machine for the cursor's visual mode.
 *
 * Pre-existing logic in `<PointerCursor>` and `<AvatarCursor>`
 * computed each phase via scattered if/else chains over
 * `revealState`, `controlsDismissed`, `swingTime`, and pan
 * progress. This module names the five distinct modes and
 * exposes a pure function that derives the mode from those
 * inputs — so the rules live in one place, can be unit-tested,
 * and consumers can `switch` on the result instead of
 * re-deriving "are we in the camera-anchored phase?" inline.
 *
 * The enum is *prescriptive*: any new code that branches on
 * cursor behaviour should switch on `CursorMode` rather than
 * re-implementing the boolean logic.
 */
import type { RevealState } from '@/store';
import { SWING_PRE } from './reveal/constants';

export enum CursorMode {
  /** Live-pointer mode — cursor follows the mouse in real time.
   *  Used at idle, during impact, and post-reveal before the
   *  user dismisses the controls hint. */
  PointerLive = 'pointer-live',

  /** World-frozen — cursor pose is captured at click and stays
   *  pinned in world space while the camera pans around it.
   *  Spans the `armed` phase and the early portion of `swinging`
   *  (before SWING_PRE elapses). The cursor is hidden during
   *  this phase to avoid visual conflict with the swords. */
  PointerWorldFrozen = 'pointer-world-frozen',

  /** Camera-anchored — cursor projects through the live camera
   *  using a captured pointer NDC. Reads as still on screen
   *  even while the camera pans. Spans the mid+post portion of
   *  the swinging phase. */
  PointerCameraAnchored = 'pointer-camera-anchored',

  /** Initial-pan — the cursor has just transitioned to the 3rd-
   *  person follow rig and is lerping into position from its
   *  pointer-mode pose. */
  AvatarInitialPan = 'avatar-initial-pan',

  /** Steady-state avatar — 3rd-person follow rig, walk + look
   *  controls active. */
  AvatarSteady = 'avatar-steady',
}

export interface CursorModeInput {
  /** Reveal state machine (idle → armed → swinging → impact → revealed). */
  revealState: RevealState;
  /** Has the user dismissed the controls hint? Gates the
   *  pointer→avatar transition. */
  controlsDismissed: boolean;
  /** Seconds elapsed inside the current `swinging` phase
   *  (0 if revealState !== 'swinging'). */
  swingTime: number;
  /** 0..1 progress of the initial pointer→avatar pan, or null
   *  if no pan is in progress. */
  panProgress: number | null;
}

/**
 * Pure derivation of the cursor's current mode from runtime
 * state. No side effects.
 */
export function computeCursorMode(input: CursorModeInput): CursorMode {
  const { revealState, controlsDismissed, swingTime, panProgress } = input;

  if (controlsDismissed) {
    if (panProgress !== null && panProgress < 1) {
      return CursorMode.AvatarInitialPan;
    }
    return CursorMode.AvatarSteady;
  }

  if (revealState === 'armed') {
    return CursorMode.PointerWorldFrozen;
  }
  if (revealState === 'swinging') {
    return swingTime < SWING_PRE
      ? CursorMode.PointerWorldFrozen
      : CursorMode.PointerCameraAnchored;
  }

  // idle, impact, revealed — live pointer.
  return CursorMode.PointerLive;
}

/**
 * Convenience: which top-level rig is the cursor in right now?
 * Useful when callers care about pointer-vs-avatar but not the
 * sub-phase.
 */
export function isAvatarMode(mode: CursorMode): boolean {
  return mode === CursorMode.AvatarInitialPan || mode === CursorMode.AvatarSteady;
}
