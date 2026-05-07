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

/** Total reveal sequence durations per phase (seconds). The
 *  RevealOrchestrator's setTimeout cascade is the canonical
 *  driver — the values below are derived from it so any
 *  consumer can compute "where am I in the timeline?" without
 *  needing to know what's happening per-phase. */
export const ARMED_DURATION_S = ARMED_DURATION;
/** Time spent in the `swinging` state. Slightly longer than
 *  `SWING_DURATION` so every sword's swing has finished + its
 *  impact tail has played before we advance to `impact`. */
export const SWINGING_DURATION_S = 6.8;
export const IMPACT_DURATION_S = 1.45;

/** Same in milliseconds — for `setTimeout` consumers. */
export const ARMED_DURATION_MS = ARMED_DURATION_S * 1000;
export const SWINGING_DURATION_MS = SWINGING_DURATION_S * 1000;
export const IMPACT_DURATION_MS = IMPACT_DURATION_S * 1000;

/** Seconds from click → haze fully transparent. Hand-tuned so the
 *  veil clears in time for the formation pose, *before* impact. */
export const HAZE_FADE_DURATION_S = 2.3;

/** Letter-plane forward distance from the click camera. The mid pose
 *  is in this plane (camera-relative), so the formation reads at a
 *  fixed visual size regardless of where the click hit on the wall. */
export const MID_FORWARD = 22;
