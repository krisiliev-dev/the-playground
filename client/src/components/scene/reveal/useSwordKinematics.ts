/**
 * useSwordKinematics — per-frame motion-to-audio binding.
 *
 * Tracks position/orientation derivatives (linear speed, acceleration,
 * jerk, angular speed) across frames and applies them to a flying-loop
 * audio handle so volume/pitch/dither follow the sword's actual motion.
 *
 *   speed    (|Δpos/Δt|)         → volume (silent at rest, ~1.5× peak)
 *                                  + pitch (Doppler-style)
 *   angSpeed (|Δquat/Δt|)        → pitch (spin component)
 *   jerk     (|Δaccel/Δt|)       → pitch dither (erratic-motion feel)
 *
 * The hook returns an `update` function rather than reading the sword
 * mesh internally — callers (Sword.tsx) compute targetPos/targetQuat
 * from their swing logic and pass them in. The returned `speed` lets
 * the caller capture the kinematic value at any frame for one-shot
 * cues (e.g. impact-velocity-scaled slam volume).
 */
import { useRef } from 'react';
import { Quaternion, Vector3 } from 'three';
import type { PositionalLoopHandle } from '../../audio/SfxManager';

export type UpdateKinematics = (
  targetPos: Vector3,
  targetQuat: Quaternion,
  dt: number,
  handle: PositionalLoopHandle | null,
) => number;

export function useSwordKinematics(): UpdateKinematics {
  const prevPos = useRef(new Vector3());
  const prevQuat = useRef(new Quaternion());
  const prevSpeed = useRef(0);
  const prevAccel = useRef(0);

  return (targetPos, targetQuat, dt, handle): number => {
    const dx = targetPos.x - prevPos.current.x;
    const dy = targetPos.y - prevPos.current.y;
    const dz = targetPos.z - prevPos.current.z;
    const speed = Math.sqrt(dx * dx + dy * dy + dz * dz) / dt;
    prevPos.current.copy(targetPos);

    const accel = (speed - prevSpeed.current) / dt;
    const jerk = Math.abs(accel - prevAccel.current) / dt;
    prevSpeed.current = speed;
    prevAccel.current = accel;

    // Quaternion.angleTo returns the shortest rotation in radians —
    // works for any axis without decomposing into Euler angles.
    const angSpeed = prevQuat.current.angleTo(targetQuat) / dt;
    prevQuat.current.copy(targetQuat);

    if (handle) {
      handle.setPosition(targetPos.x, targetPos.y, targetPos.z);
      // Purely multiplicative speed → volume so a stationary sword
      // (mid-phase, holding its VIBE-letter pose) is silent.
      handle.setVolume(Math.min(1.5, speed / 80));
      // Pitch combines three motion sources, each capped so peak
      // values don't blow up the sound on edge frames.
      const speedPitch = Math.min(0.25, speed / 800);
      const spinPitch = Math.min(0.2, angSpeed / 18);
      const jerkAmount = Math.min(0.15, jerk / 50000);
      const jerkDither = (Math.random() - 0.5) * jerkAmount;
      handle.setPlaybackRate(0.95 + speedPitch + spinPitch + jerkDither);
    }
    return speed;
  };
}
