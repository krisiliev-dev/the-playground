/**
 * BulletTimeDirector — cinematic camera choreography during the reveal.
 *
 * Runs at useFrame priority 1, ordered between default-priority frames (0)
 * and CursorAvatar (2). The director writes camera.position +
 * camera.quaternion each frame; CursorAvatar (priority 2) reads them right
 * after to keep the cursor projected through the up-to-date camera pose.
 * Outside the reveal sequence the director early-returns and lets
 * CursorAvatar / OrbitControls own the camera.
 *
 *   Armed (800ms) — camera holds position, lookAt lerps from formation
 *                   centre to the spawn point. Pan toward where the
 *                   swords are about to come from.
 *   Pre  (3.5s)   — camera ramps to a chase point ahead of the herd,
 *                   then directly tracks the herd's flight; late-pre
 *                   blends toward sideA so mid starts cleanly.
 *   Mid  (1.2s)   — subtle right-to-left lateral drift through sideA →
 *                   sideB, lookAt held on the word centre.
 *   Post (0.8s)   — camera lerps from side B back to initial pose;
 *                   lookAt eases from word centre to formation centre.
 *
 * The per-phase target math lives in `./bulletTimeMath.ts` (pure,
 * unit-tested). This file owns the imperative work: capturing the
 * click-time camera basis, dispatching to the right helper per phase,
 * and applying `state.camera.lookAt`.
 */
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Vector3 } from 'three';
import { useWorldStore } from '@/store';
import { WORD_CENTERING_FUDGE } from './vibeFormation';
import { ARMED_DURATION, MID_FORWARD, SWING_DURATION, SWING_MID, SWING_PRE } from './constants';
import { computeSpawnPoint } from './spawnGeometry';
import {
  ARMED_DOLLY_FWD,
  ARMED_LATERAL_DRIFT,
  MID_LATERAL_DRIFT,
  computeArmedLateralSign,
  computeArmedTarget,
  computeMidTarget,
  computePostTarget,
  computePreTarget,
} from './bulletTimeMath';

export function BulletTimeDirector(): null {
  const dimensions = useWorldStore((s) => s.environment.dimensions);
  const cubeHalf = useMemo(
    () => new Vector3(dimensions[0] / 2, dimensions[1] / 2, dimensions[2] / 2),
    [dimensions],
  );

  const previousState = useRef<string>('idle');
  const stateEnteredAt = useRef(0);
  const captured = useRef(false);
  /** Sign of the lateral-drift dolly during armed (see
   *  computeArmedLateralSign). */
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

  // Reusable per-frame buffers — written by the bullet-time math
  // helpers, read by `state.camera.position.copy` / `lookAt` after.
  const targetPos = useRef(new Vector3());
  const targetLook = useRef(new Vector3());
  /** Scratch buffers for `computePreTarget`'s herd + chase
   *  intermediate values. Owned here (not the helper) so we don't
   *  allocate per frame. */
  const herdScratch = useRef(new Vector3());
  const chaseScratch = useRef(new Vector3());
  /** Captured at click time: unit vectors describing the swords'
   *  flight (motionDir = spawn → wordCenter, sidePerp ⊥ to motion). */
  const sidePerp = useRef(new Vector3());
  const motionDir = useRef(new Vector3());

  useFrame((state) => {
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
      // Spawn point: same math as Sword.tsx — see ./spawnGeometry. The
      // director's lookAt target tracks where the swords actually are
      // because both call sites share this helper.
      computeSpawnPoint(
        spawnPoint.current,
        initialCamPos.current,
        camRight.current,
        camFwd.current,
        camUp.current,
        cubeHalf,
      );
      // sideA and sideB: camera positions for mid's right-to-left drift.
      sideA.current
        .copy(initialCamPos.current)
        .addScaledVector(camRight.current, MID_LATERAL_DRIFT);
      sideB.current
        .copy(initialCamPos.current)
        .addScaledVector(camRight.current, -MID_LATERAL_DRIFT);
      armedLateralSign.current = computeArmedLateralSign(state.pointer.x);
      // Pre starts where armed ended — forward dolly + lateral drift.
      preStartPos.current
        .copy(initialCamPos.current)
        .addScaledVector(camFwd.current, ARMED_DOLLY_FWD)
        .addScaledVector(camRight.current, ARMED_LATERAL_DRIFT * armedLateralSign.current);
      // Capture motion direction (spawn → word centre, normalised) and
      // its perpendicular (negated so the camera ends up on the
      // audience-side of the trajectory).
      motionDir.current.copy(wordCenter.current).sub(spawnPoint.current).normalize();
      sidePerp.current.copy(motionDir.current).cross(camUp.current).normalize().negate();
      captured.current = true;
    }

    // After swing ends (impact / revealed), release the camera so
    // CursorAvatar can resume control.
    if (revealState !== 'armed' && revealState !== 'swinging') {
      return;
    }

    const sinceEnter = now - stateEnteredAt.current;

    if (revealState === 'armed') {
      computeArmedTarget(
        targetPos.current,
        targetLook.current,
        sinceEnter,
        initialCamPos.current,
        camFwd.current,
        camRight.current,
        wordCenter.current,
        spawnPoint.current,
        armedLateralSign.current,
      );
    } else {
      // revealState === 'swinging'
      const t = sinceEnter;
      if (t < SWING_PRE) {
        computePreTarget(
          targetPos.current,
          targetLook.current,
          herdScratch.current,
          chaseScratch.current,
          t,
          preStartPos.current,
          spawnPoint.current,
          wordCenter.current,
          sideA.current,
          sidePerp.current,
          camUp.current,
          motionDir.current,
        );
      } else if (t < SWING_PRE + SWING_MID) {
        computeMidTarget(
          targetPos.current,
          targetLook.current,
          t,
          sideA.current,
          sideB.current,
          wordCenter.current,
        );
      } else {
        computePostTarget(
          targetPos.current,
          targetLook.current,
          t,
          sideB.current,
          initialCamPos.current,
          wordCenter.current,
          formationCenter.current,
        );
      }
    }

    state.camera.position.copy(targetPos.current);
    state.camera.lookAt(targetLook.current);
  }, 1);

  return null;
}

export const BULLET_TIME_CONSTANTS = {
  ARMED_DURATION,
  SWING_DURATION,
} as const;
