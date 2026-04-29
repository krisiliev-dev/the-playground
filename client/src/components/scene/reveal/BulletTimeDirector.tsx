/**
 * BulletTimeDirector — cinematic camera choreography during the reveal.
 *
 * Four phases, all driven from a single useFrame at priority 1 so the
 * director's writes happen *after* the default-priority useFrames
 * (CursorAvatar). Outside the reveal sequence the director early-returns
 * and CursorAvatar's writes stand.
 *
 *   Armed (800ms) — camera holds position, lookAt lerps from formation
 *                   centre to the spawn point. Pan toward where the
 *                   swords are about to come from.
 *   Pre  (2.0s)   — camera lerps from initial position to "side A"
 *                   profile (90° around formation centre); lookAt
 *                   tracks the swords as they fly from spawn to mid.
 *   Mid  (1.2s)   — 180° orbit around formation centre. Camera goes
 *                   side A → through front → side B.
 *   Post (0.8s)   — camera lerps from side B back to initial pose;
 *                   lookAt stays on formation centre.
 */
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Vector3 } from 'three';
import { useWorldStore } from '@/store';
import { WORD_CENTERING_FUDGE } from './vibeFormation';

const ARMED_DURATION = 0.8;
const SWING_PRE = 3.5;
const SWING_MID = 1.2;
const SWING_POST = 0.8;
const SWING_DURATION = SWING_PRE + SWING_MID + SWING_POST;

/** Distance from camera to formation centre at the *initial* (front)
 *  view — must match Sword.tsx's MID_FORWARD. */
const MID_FORWARD = 22;
/** Lateral drift during mid. Camera pans from MID_LATERAL_DRIFT units
 *  RIGHT of initial to MID_LATERAL_DRIFT units LEFT of initial — small
 *  movement, close to the original viewing position, while the swords
 *  hold formation in front of the camera. */
const MID_LATERAL_DRIFT = 6;
/** Forward dolly during armed — gives the camera some kinetic motion
 *  from the very first sparkle, instead of waiting until pre to start
 *  moving. By end of armed, camera has crept 5 units forward. */
const ARMED_DOLLY_FWD = 5;
/** Lateral dolly during armed, AWAY from the click side. Pushes the
 *  world-frozen cursor off its starting screen edge via parallax before
 *  the camera's lookAt rotation can sweep it through frame centre.
 *  Sign is flipped per-click based on the captured pointer NDC X. */
const ARMED_LATERAL_DRIFT = 6;
/** During pre, the camera "chases" the swords' herd centre but stays
 *  offset (1) to the side, (2) above, AND (3) AHEAD of the herd in its
 *  flight direction — so the camera sees the swords in PROFILE flying
 *  past, with the leading sword centred in view and the trailing tail
 *  visible behind it. */
const CHASE_SIDE_DISTANCE = 14;
const CHASE_UP_DISTANCE = 4;
const CHASE_AHEAD_DISTANCE = 60;
/** Camera reaches chasePoint over this duration at the start of pre.
 *  After this, camera DIRECTLY tracks chasePoint (no ease-out lag) so
 *  it stays consistently ahead of the row throughout the chase. */
const CHASE_RAMP_DURATION = 0.5;
/** Spawn position offsets (must match Sword.tsx). Lateral is computed
 *  dynamically via ray-cast to the cube wall — see capture block. */
const SPAWN_FIXED_FWD = 80;
const SPAWN_FIXED_UP = 20;
const SPAWN_WALL_INSET = 30;

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

export function BulletTimeDirector(): null {
  const dimensions = useWorldStore((s) => s.environment.dimensions);
  const cubeHalf = useMemo(
    () =>
      new Vector3(
        dimensions[0] / 2,
        dimensions[1] / 2,
        dimensions[2] / 2,
      ),
    [dimensions],
  );

  const previousState = useRef<string>('idle');
  const stateEnteredAt = useRef(0);
  const captured = useRef(false);
  /** Sign of the lateral-drift dolly during armed. Positive = +camRight,
   *  negative = -camRight. Set OPPOSITE the click NDC X so the cursor
   *  parallax-shifts off its own screen edge (right-click → camera dollies
   *  left → cursor pushed further right, off-screen). */
  const armedLateralSign = useRef(0);

  // Captured-at-click reference frame.
  const initialCamPos = useRef(new Vector3());
  const camFwd = useRef(new Vector3());
  const camRight = useRef(new Vector3());
  const camUp = useRef(new Vector3());
  const formationCenter = useRef(new Vector3());
  /** The actual visual centre of the word, accounting for the rightward
   *  centering fudge in vibeFormation.ts. The camera's lookAt aims here
   *  during mid + post so the formation reads centred. */
  const wordCenter = useRef(new Vector3());
  const spawnPoint = useRef(new Vector3());
  const sideA = useRef(new Vector3());
  const sideB = useRef(new Vector3());
  /** Position the camera ends up at by the end of armed — also the
   *  starting point for pre's lerp so motion is continuous. */
  const preStartPos = useRef(new Vector3());

  // Reusable per-frame buffers.
  const targetPos = useRef(new Vector3());
  const targetLook = useRef(new Vector3());
  /** Where the swords' "herd centre" is right now (lerps spawn → formation). */
  const herdPos = useRef(new Vector3());
  /** Camera's chase point — herd offset to the SIDE (perpendicular to
   *  flight direction) + slightly UP, so the camera sees the swords in
   *  profile flying past. */
  const chasePoint = useRef(new Vector3());
  /** Camera's per-frame intermediate target — blends chasePoint (early
   *  pre, side-view chase) with sideA (late pre, orbit start). */
  const intermediateTarget = useRef(new Vector3());
  /** Captured at click time: unit vector perpendicular to the swords'
   *  flight direction (= cross(motionDir, camUp)). The chase offset
   *  uses this so the camera always offsets perpendicular to motion. */
  const sidePerp = useRef(new Vector3());
  /** Captured at click time: unit vector along the swords' flight
   *  direction (spawn → wordCenter). Used to position the camera
   *  AHEAD of the herd so the full row of swords is visible. */
  const motionDir = useRef(new Vector3());

  useFrame(
    (state) => {
      const revealState = useWorldStore.getState().revealState;
      const now = state.clock.elapsedTime;

      // Track state transitions for per-state timing.
      if (previousState.current !== revealState) {
        stateEnteredAt.current = now;
        previousState.current = revealState;
      }

      if (revealState === 'idle') {
        captured.current = false;
        return;
      }

      // Capture click-cam reference frame on first entry to armed/swinging.
      if (!captured.current) {
        const camQuat = state.camera.quaternion;
        initialCamPos.current.copy(state.camera.position);
        camFwd.current.set(0, 0, -1).applyQuaternion(camQuat);
        camRight.current.set(1, 0, 0).applyQuaternion(camQuat);
        camUp.current.set(0, 1, 0).applyQuaternion(camQuat);
        formationCenter.current
          .copy(initialCamPos.current)
          .addScaledVector(camFwd.current, MID_FORWARD);
        // Word centre = formation centre + the rightward fudge that
        // shifts the letter formation in vibeFormation.ts. Camera's
        // lookAt aims here so the visual word is centred in view.
        wordCenter.current
          .copy(formationCenter.current)
          .addScaledVector(camRight.current, WORD_CENTERING_FUDGE);
        // Spawn lateral: ray-cast camRight from initialCamPos to the
        // nearest cube wall, minus a small inset. Same math as Sword.tsx
        // so the director's lookAt target tracks where swords actually are.
        const cR = camRight.current;
        let tWall = Infinity;
        if (Math.abs(cR.x) > 1e-6) {
          const t1 = (cubeHalf.x - initialCamPos.current.x) / cR.x;
          const t2 = (-cubeHalf.x - initialCamPos.current.x) / cR.x;
          if (t1 > 0 && t1 < tWall) tWall = t1;
          if (t2 > 0 && t2 < tWall) tWall = t2;
        }
        if (Math.abs(cR.y) > 1e-6) {
          const t1 = (cubeHalf.y - initialCamPos.current.y) / cR.y;
          const t2 = (-cubeHalf.y - initialCamPos.current.y) / cR.y;
          if (t1 > 0 && t1 < tWall) tWall = t1;
          if (t2 > 0 && t2 < tWall) tWall = t2;
        }
        if (Math.abs(cR.z) > 1e-6) {
          const t1 = (cubeHalf.z - initialCamPos.current.z) / cR.z;
          const t2 = (-cubeHalf.z - initialCamPos.current.z) / cR.z;
          if (t1 > 0 && t1 < tWall) tWall = t1;
          if (t2 > 0 && t2 < tWall) tWall = t2;
        }
        const lateralDist = Math.max(0, tWall - SPAWN_WALL_INSET);
        spawnPoint.current
          .copy(initialCamPos.current)
          .addScaledVector(camRight.current, lateralDist)
          .addScaledVector(camFwd.current, SPAWN_FIXED_FWD)
          .addScaledVector(camUp.current, SPAWN_FIXED_UP);
        // Clamp to cube interior — same as Sword.tsx so the director's
        // lookAt target matches the actual sword spawn position.
        {
          const limX = cubeHalf.x - SPAWN_WALL_INSET;
          const limY = cubeHalf.y - SPAWN_WALL_INSET;
          const limZ = cubeHalf.z - SPAWN_WALL_INSET;
          spawnPoint.current.x = Math.max(
            -limX,
            Math.min(limX, spawnPoint.current.x),
          );
          spawnPoint.current.y = Math.max(
            -limY,
            Math.min(limY, spawnPoint.current.y),
          );
          spawnPoint.current.z = Math.max(
            -limZ,
            Math.min(limZ, spawnPoint.current.z),
          );
        }
        // sideA and sideB are positions slightly to the right / left of
        // the camera's INITIAL pose (not at the formation). Mid phase
        // pans the camera between them — a subtle right-to-left drift
        // close to where the user was originally looking from.
        sideA.current
          .copy(initialCamPos.current)
          .addScaledVector(camRight.current, MID_LATERAL_DRIFT);
        sideB.current
          .copy(initialCamPos.current)
          .addScaledVector(camRight.current, -MID_LATERAL_DRIFT);
        // Lateral dolly sign: dolly OPPOSITE the click side. Right-click
        // → -camRight (cursor pushed further right via parallax → off
        // the right edge). Left-click → +camRight. clickPx near 0 → no
        // dolly (cursor at centre, pan can't help anyway).
        const clickPx = state.pointer.x;
        armedLateralSign.current = Math.abs(clickPx) < 0.05 ? 0 : -Math.sign(clickPx);
        // Pre starts where armed ended — forward dolly + lateral drift.
        preStartPos.current
          .copy(initialCamPos.current)
          .addScaledVector(camFwd.current, ARMED_DOLLY_FWD)
          .addScaledVector(
            camRight.current,
            ARMED_LATERAL_DRIFT * armedLateralSign.current,
          );
        // Capture motion direction (spawn → word centre, normalised).
        motionDir.current
          .copy(wordCenter.current)
          .sub(spawnPoint.current)
          .normalize();
        // Side perpendicular to flight direction. Negated so the camera
        // ends up on the audience-side of the trajectory.
        sidePerp.current
          .copy(motionDir.current)
          .cross(camUp.current)
          .normalize()
          .negate();
        captured.current = true;
      }

      // After swing ends (impact / revealed), release the camera so
      // CursorAvatar can resume control.
      if (revealState !== 'armed' && revealState !== 'swinging') return;

      const sinceEnter = now - stateEnteredAt.current;

      if (revealState === 'armed') {
        // Pan toward spawn + slight forward dolly + lateral drift away
        // from the click side. The lateral component eases in faster than
        // the lookAt rotation (sqrt vs smoothstep), so the cursor
        // parallax-pulls off its starting edge BEFORE the rotation can
        // sweep it through frame centre.
        const phaseT = Math.min(1, sinceEnter / ARMED_DURATION);
        const eased = smoothstep(phaseT);
        const lateralEase = Math.sqrt(phaseT);
        targetPos.current
          .copy(initialCamPos.current)
          .addScaledVector(camFwd.current, ARMED_DOLLY_FWD * eased)
          .addScaledVector(
            camRight.current,
            ARMED_LATERAL_DRIFT * armedLateralSign.current * lateralEase,
          );
        targetLook.current
          .copy(wordCenter.current)
          .lerp(spawnPoint.current, eased);
      } else {
        // revealState === 'swinging'
        const t = sinceEnter;

        if (t < SWING_PRE) {
          // Pre: TRUE chase camera. Camera lerps toward where the swords
          // ACTUALLY are right now — far right early on (tracking the
          // spawn), shifting to formation centre by end of pre. The
          // intermediate target itself blends from "current herd" to
          // sideA via an ease-in (so by end of pre, target = sideA and
          // we're set up for the orbit).
          const phaseT = t / SWING_PRE;

          // Where are the swords' herd centre right now? Lerp from spawn
          // toward the WORD centre (not formation centre) so the camera's
          // tracking aligns with the swords' actual mean position.
          const herdProgress = smoothstep(phaseT);
          herdPos.current
            .copy(spawnPoint.current)
            .lerp(wordCenter.current, herdProgress);

          // Chase point: herd offset PERPENDICULAR to flight direction
          // (sidePerp) + slightly UP + AHEAD in flight direction. The
          // ahead component places the camera in front of the herd
          // looking back — the full row of swords is visible behind
          // the leading sword instead of just the tail.
          chasePoint.current
            .copy(herdPos.current)
            .addScaledVector(sidePerp.current, CHASE_SIDE_DISTANCE)
            .addScaledVector(camUp.current, CHASE_UP_DISTANCE)
            .addScaledVector(motionDir.current, CHASE_AHEAD_DISTANCE);

          // Camera position: ramp from preStartPos to chasePoint over
          // CHASE_RAMP_DURATION at the start of pre, then track
          // chasePoint *directly* (no ease-out lag — keeps camera firmly
          // ahead of the row instead of slowly catching up).
          const ramp = Math.min(1, t / CHASE_RAMP_DURATION);
          targetPos.current
            .copy(preStartPos.current)
            .lerp(chasePoint.current, smoothstep(ramp));

          // Late-pre blend toward sideA (last ~10%) so mid starts
          // cleanly from sideA without a snap.
          const sideABlend = Math.pow(phaseT, 8);
          targetPos.current.lerp(sideA.current, sideABlend);

          // intermediateTarget is no longer used in this path but kept
          // assigned to satisfy the buffer reuse pattern.
          intermediateTarget.current.copy(chasePoint.current);

          // LookAt always at the herd — camera anchors visually on the
          // swords as it chases them.
          targetLook.current.copy(herdPos.current);
        } else if (t < SWING_PRE + SWING_MID) {
          // Mid: subtle right-to-left drift across the initial viewing
          // position. Camera lerps from sideA (slightly right of initial)
          // to sideB (slightly left of initial) over the formation hold.
          const phaseT = (t - SWING_PRE) / SWING_MID;
          const eased = smoothstep(phaseT);
          targetPos.current
            .copy(sideA.current)
            .lerp(sideB.current, eased);
          targetLook.current.copy(wordCenter.current);
        } else {
          // Post: lerp position from sideB back to initial. LookAt also
          // lerps from wordCenter (mid's offset target) back to
          // formationCenter (perpendicular forward), so the camera ends
          // at its original perpendicular orientation when CursorAvatar
          // takes back over.
          const phaseT = Math.min(
            1,
            (t - SWING_PRE - SWING_MID) / SWING_POST,
          );
          const eased = smoothstep(phaseT);
          targetPos.current
            .copy(sideB.current)
            .lerp(initialCamPos.current, eased);
          targetLook.current
            .copy(wordCenter.current)
            .lerp(formationCenter.current, eased);
        }
      }

      state.camera.position.copy(targetPos.current);
      state.camera.lookAt(targetLook.current);
    },
    1,
  );

  return null;
}

export const BULLET_TIME_CONSTANTS = {
  ARMED_DURATION,
  SWING_DURATION,
} as const;
