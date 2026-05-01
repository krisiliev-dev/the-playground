/**
 * BulletTimeDirector camera math — pure helpers that compute the
 * per-frame camera target position + lookAt point for each phase of
 * the reveal sequence.
 *
 * Each helper takes:
 *   - `outPos: Vector3` — written with the target camera position.
 *   - `outLook: Vector3` — written with the target lookAt point.
 *   - phase time `t` (or `sinceEnter` for the armed phase)
 *   - the captured camera basis vectors (initialCamPos, camFwd, …)
 *
 * No allocations: every call writes into the supplied output vectors.
 * Some helpers (the chase-phase one in particular) need scratch
 * vectors for intermediate values; those are also caller-owned.
 *
 * Quaternion math (camera.lookAt) stays in BulletTimeDirector.tsx —
 * Three.js's `lookAt` writes the camera quaternion in-place from the
 * world-up direction, which doesn't translate cleanly to a pure
 * function and isn't worth the wrapping anyway.
 */
import { Vector3 } from 'three';
import { ARMED_DURATION, SWING_MID, SWING_POST, SWING_PRE } from './constants';

/** Forward dolly during armed — gives the camera some kinetic motion
 *  from the very first sparkle, instead of waiting until pre to start
 *  moving. By end of armed, camera has crept this far forward. */
export const ARMED_DOLLY_FWD = 5;

/** Lateral dolly during armed, AWAY from the click side. Pushes the
 *  world-frozen cursor off its starting screen edge via parallax
 *  before the camera's lookAt rotation can sweep it through frame
 *  centre. Sign is flipped per-click based on the captured pointer
 *  NDC X (see `computeArmedLateralSign`). */
export const ARMED_LATERAL_DRIFT = 6;

/** Lateral drift during mid. Camera pans from MID_LATERAL_DRIFT units
 *  RIGHT of initial to MID_LATERAL_DRIFT units LEFT of initial — small
 *  movement, close to the original viewing position, while the swords
 *  hold formation in front of the camera. */
export const MID_LATERAL_DRIFT = 6;

/** During pre, the camera "chases" the swords' herd centre but stays
 *  offset (1) to the side, (2) above, AND (3) AHEAD of the herd in
 *  its flight direction — so the camera sees the swords in PROFILE
 *  flying past, with the leading sword centred and the tail visible. */
export const CHASE_SIDE_DISTANCE = 14;
export const CHASE_UP_DISTANCE = 4;
export const CHASE_AHEAD_DISTANCE = 60;

/** Camera reaches chasePoint over this duration at the start of pre.
 *  After this, the camera DIRECTLY tracks chasePoint (no ease-out lag)
 *  so it stays consistently ahead of the row throughout the chase. */
export const CHASE_RAMP_DURATION = 0.5;

/** Pointer-NDC threshold below which we drop the lateral dolly. A
 *  click at screen centre has no "side" to pull the cursor off, so we
 *  keep the camera straight rather than guess a direction. */
export const ARMED_DOLLY_PIXEL_DEADZONE = 0.05;

/** Cubic ease in/out — same shape as the swordPhases helper, kept
 *  local here so the two camera/sword paths can drift independently
 *  if their easing requirements ever diverge. */
function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

/**
 * Sign of the armed-phase lateral dolly direction, derived from the
 * click's NDC X. Returns:
 *   - +1 if pointer is on the left half (dolly +camRight)
 *   - -1 if pointer is on the right half (dolly -camRight)
 *   - 0  if pointer is within the deadzone around screen centre
 *
 * The dolly direction is OPPOSITE the click side so the cursor
 * parallax-shifts off its own screen edge — right-click → camera
 * dollies left → cursor pushed further right, off-screen.
 */
export function computeArmedLateralSign(pointerX: number): number {
  if (Math.abs(pointerX) < ARMED_DOLLY_PIXEL_DEADZONE) {
    return 0;
  }
  return -Math.sign(pointerX);
}

/**
 * Camera target during the armed phase. Pans toward the spawn point +
 * dollies forward + drifts laterally away from the click side. The
 * lateral component eases in faster than the lookAt rotation
 * (`Math.sqrt(phaseT)` vs `smoothstep(phaseT)`), so the cursor
 * parallax-pulls off its starting edge BEFORE the rotation can sweep
 * it through frame centre.
 */
export function computeArmedTarget(
  outPos: Vector3,
  outLook: Vector3,
  sinceEnter: number,
  initialCamPos: Vector3,
  camFwd: Vector3,
  camRight: Vector3,
  wordCenter: Vector3,
  spawnPoint: Vector3,
  armedLateralSign: number,
): void {
  const phaseT = Math.min(1, sinceEnter / ARMED_DURATION);
  const eased = smoothstep(phaseT);
  const lateralEase = Math.sqrt(phaseT);
  outPos
    .copy(initialCamPos)
    .addScaledVector(camFwd, ARMED_DOLLY_FWD * eased)
    .addScaledVector(camRight, ARMED_LATERAL_DRIFT * armedLateralSign * lateralEase);
  outLook.copy(wordCenter).lerp(spawnPoint, eased);
}

/**
 * Where the swords' herd centre is right now during the chase. Lerps
 * from `spawnPoint` to `wordCenter` over the pre phase (smoothstep-
 * eased), so the camera anchors visually on the swords' actual mean
 * position instead of where the formation will end up.
 */
export function computeHerdPosition(
  out: Vector3,
  t: number,
  spawnPoint: Vector3,
  wordCenter: Vector3,
): void {
  const phaseT = Math.min(1, Math.max(0, t / SWING_PRE));
  out.copy(spawnPoint).lerp(wordCenter, smoothstep(phaseT));
}

/**
 * Chase point: the herd position offset PERPENDICULAR to flight
 * direction (`sidePerp`), slightly UP, and AHEAD in flight direction.
 * Places the camera in front of the herd looking back so the full row
 * of swords is visible behind the leading sword instead of just the
 * tail.
 */
export function computeChasePoint(
  out: Vector3,
  herd: Vector3,
  sidePerp: Vector3,
  camUp: Vector3,
  motionDir: Vector3,
): void {
  out
    .copy(herd)
    .addScaledVector(sidePerp, CHASE_SIDE_DISTANCE)
    .addScaledVector(camUp, CHASE_UP_DISTANCE)
    .addScaledVector(motionDir, CHASE_AHEAD_DISTANCE);
}

/**
 * Camera target during the pre / chase phase. Camera ramps from
 * `preStartPos` to the chase point over `CHASE_RAMP_DURATION`, then
 * tracks the chase point directly (no ease-out lag — the camera stays
 * firmly ahead of the row instead of slowly catching up). In the
 * final ~10% of pre, blends toward `sideA` so mid starts cleanly.
 *
 * Writes both `outPos` and `outLook`. Uses `scratchHerd` and
 * `scratchChase` as intermediate buffers; both are caller-owned.
 */
export function computePreTarget(
  outPos: Vector3,
  outLook: Vector3,
  scratchHerd: Vector3,
  scratchChase: Vector3,
  t: number,
  preStartPos: Vector3,
  spawnPoint: Vector3,
  wordCenter: Vector3,
  sideA: Vector3,
  sidePerp: Vector3,
  camUp: Vector3,
  motionDir: Vector3,
): void {
  const phaseT = t / SWING_PRE;
  computeHerdPosition(scratchHerd, t, spawnPoint, wordCenter);
  computeChasePoint(scratchChase, scratchHerd, sidePerp, camUp, motionDir);
  const ramp = Math.min(1, t / CHASE_RAMP_DURATION);
  outPos.copy(preStartPos).lerp(scratchChase, smoothstep(ramp));
  // Late-pre blend toward sideA (last ~10%) so mid starts cleanly
  // from sideA without a snap. `pow(phaseT, 8)` is essentially zero
  // until phaseT > 0.8, then ramps quickly to 1.
  const sideABlend = Math.pow(phaseT, 8);
  outPos.lerp(sideA, sideABlend);
  outLook.copy(scratchHerd);
}

/**
 * Camera target during the formation hold (mid). Camera lerps from
 * `sideA` (slightly right of initial) to `sideB` (slightly left of
 * initial) — subtle right-to-left drift across the initial viewing
 * position while the swords hold formation. lookAt anchors on
 * `wordCenter` throughout.
 */
export function computeMidTarget(
  outPos: Vector3,
  outLook: Vector3,
  t: number,
  sideA: Vector3,
  sideB: Vector3,
  wordCenter: Vector3,
): void {
  const phaseT = (t - SWING_PRE) / SWING_MID;
  outPos.copy(sideA).lerp(sideB, smoothstep(phaseT));
  outLook.copy(wordCenter);
}

/**
 * Camera target during the post (slam-into-wall) phase. Position
 * lerps from `sideB` back to `initialCamPos`; lookAt eases from
 * `wordCenter` (mid's offset target) back to `formationCenter`
 * (perpendicular forward) so the camera ends at its original
 * orientation when CursorAvatar takes back over.
 */
export function computePostTarget(
  outPos: Vector3,
  outLook: Vector3,
  t: number,
  sideB: Vector3,
  initialCamPos: Vector3,
  wordCenter: Vector3,
  formationCenter: Vector3,
): void {
  const phaseT = Math.min(1, (t - SWING_PRE - SWING_MID) / SWING_POST);
  const eased = smoothstep(phaseT);
  outPos.copy(sideB).lerp(initialCamPos, eased);
  outLook.copy(wordCenter).lerp(formationCenter, eased);
}
