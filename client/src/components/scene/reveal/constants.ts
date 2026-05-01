/**
 * Reveal-sequence constants — shared timings + the camera-relative
 * letter-plane forward distance.
 *
 * Single source of truth so `Sword.tsx`, `BulletTimeDirector.tsx`, and
 * `CursorAvatar.tsx` (the three consumers) can't drift. The previous
 * arrangement had `SWING_PRE = 3.5` literally re-declared in three
 * places, with comments saying "must match Sword.tsx" — this file is
 * what those comments now point to.
 *
 * SWING phases (sword swing within the 'swinging' reveal state):
 *   Pre  — sword bursts in from the spawn point and decelerates into
 *          the formation pose.
 *   Mid  — formation hold; bullet-time camera orbit around the word.
 *   Post — sword launches forward into the wall ring; impact.
 *
 * SWING_DURATION = PRE + MID + POST (asserted by `constants.test.ts`).
 */
export const ARMED_DURATION = 0.8;
export const SWING_PRE = 3.5;
export const SWING_MID = 1.2;
export const SWING_POST = 0.8;
export const SWING_DURATION = SWING_PRE + SWING_MID + SWING_POST;
export const SWING_DURATION_MS = SWING_DURATION * 1000;

/** Letter-plane forward distance from the click camera. The mid pose
 *  is in this plane (camera-relative), so the formation reads at a
 *  fixed visual size regardless of where the click hit on the wall. */
export const MID_FORWARD = 22;
