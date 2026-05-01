/**
 * BulletTimeDirector camera math — covers the pure per-phase target
 * helpers extracted from BulletTimeDirector.tsx. The component itself
 * is tightly coupled to useFrame + the Three.js camera; these tests
 * isolate the *target computation* (where the camera should be at
 * time t in this phase) so each phase's curve can be pinned without
 * standing up an R3F scene.
 *
 * Each helper writes into `outPos` + `outLook` Vector3 buffers; tests
 * provide fresh buffers per assertion so cross-test leakage is
 * impossible.
 */
import { describe, it, expect } from 'vitest';
import { Vector3 } from 'three';
import {
  ARMED_DOLLY_FWD,
  ARMED_DOLLY_PIXEL_DEADZONE,
  ARMED_LATERAL_DRIFT,
  CHASE_AHEAD_DISTANCE,
  CHASE_RAMP_DURATION,
  CHASE_SIDE_DISTANCE,
  CHASE_UP_DISTANCE,
  computeArmedLateralSign,
  computeArmedTarget,
  computeChasePoint,
  computeHerdPosition,
  computeMidTarget,
  computePostTarget,
  computePreTarget,
} from '@/components/scene/reveal/bulletTimeMath';
import {
  ARMED_DURATION,
  SWING_DURATION,
  SWING_MID,
  SWING_POST,
  SWING_PRE,
} from '@/components/scene/reveal/constants';

// Standard click-camera basis used across the helpers: camera at
// origin, looking down -Z. Matches what the scene captures on click
// when the user is staring straight at the front wall.
const initialCamPos = new Vector3(0, 0, 0);
const camFwd = new Vector3(0, 0, -1);
const camRight = new Vector3(1, 0, 0);
const camUp = new Vector3(0, 1, 0);
const wordCenter = new Vector3(0, 0, -22);
const formationCenter = new Vector3(0, 0, -22);
const spawnPoint = new Vector3(50, 5, -80);
const sideA = new Vector3(6, 0, 0);
const sideB = new Vector3(-6, 0, 0);
const preStartPos = new Vector3(-6, 0, -5);
const motionDir = new Vector3(0.5, 0.05, -0.85).normalize();
const sidePerp = new Vector3().copy(motionDir).cross(camUp).normalize().negate();

describe('computeArmedLateralSign', () => {
  it('returns +1 when click is on the LEFT half (negative pointer X)', () => {
    expect(computeArmedLateralSign(-0.5)).toBe(1);
    expect(computeArmedLateralSign(-1)).toBe(1);
  });

  it('returns -1 when click is on the RIGHT half (positive pointer X)', () => {
    expect(computeArmedLateralSign(0.5)).toBe(-1);
    expect(computeArmedLateralSign(1)).toBe(-1);
  });

  it('returns 0 inside the centre deadzone', () => {
    expect(computeArmedLateralSign(0)).toBe(0);
    expect(computeArmedLateralSign(ARMED_DOLLY_PIXEL_DEADZONE - 1e-9)).toBe(0);
    expect(computeArmedLateralSign(-(ARMED_DOLLY_PIXEL_DEADZONE - 1e-9))).toBe(0);
  });

  it('returns the dolly direction OPPOSITE the click side (parallax kicks the cursor off-screen)', () => {
    // Right-click → -1 → camera dollies in -camRight → cursor parallax
    // pushes off the right edge.
    expect(computeArmedLateralSign(0.8)).toBe(-1);
    // Left-click → +1 → opposite.
    expect(computeArmedLateralSign(-0.8)).toBe(1);
  });
});

describe('computeArmedTarget', () => {
  it('starts at initialCamPos with lookAt = wordCenter at sinceEnter=0', () => {
    const outPos = new Vector3();
    const outLook = new Vector3();
    computeArmedTarget(
      outPos,
      outLook,
      0,
      initialCamPos,
      camFwd,
      camRight,
      wordCenter,
      spawnPoint,
      1,
    );
    expect(outPos.equals(initialCamPos)).toBe(true);
    expect(outLook.equals(wordCenter)).toBe(true);
  });

  it('reaches the full dolly + lateral drift at sinceEnter = ARMED_DURATION', () => {
    const outPos = new Vector3();
    const outLook = new Vector3();
    computeArmedTarget(
      outPos,
      outLook,
      ARMED_DURATION,
      initialCamPos,
      camFwd,
      camRight,
      wordCenter,
      spawnPoint,
      1,
    );
    // Eased to 1.0 → full ARMED_DOLLY_FWD along camFwd, full
    // ARMED_LATERAL_DRIFT along +camRight (sign = 1).
    expect(outPos.x).toBeCloseTo(ARMED_LATERAL_DRIFT, 6);
    expect(outPos.z).toBeCloseTo(-ARMED_DOLLY_FWD, 6);
    // lookAt fully lerped to spawnPoint.
    expect(outLook.equals(spawnPoint)).toBe(true);
  });

  it('flips the lateral drift direction with armedLateralSign = -1', () => {
    const outPos = new Vector3();
    const outLook = new Vector3();
    computeArmedTarget(
      outPos,
      outLook,
      ARMED_DURATION,
      initialCamPos,
      camFwd,
      camRight,
      wordCenter,
      spawnPoint,
      -1,
    );
    expect(outPos.x).toBeCloseTo(-ARMED_LATERAL_DRIFT, 6);
  });

  it('lateral component leads the lookAt rotation (sqrt vs smoothstep)', () => {
    // At phaseT = 0.25, sqrt(0.25) = 0.5 (lateral) but smoothstep(0.25)
    // ≈ 0.156 (lookAt easing). Lateral should be further along.
    const outPos = new Vector3();
    const outLook = new Vector3();
    computeArmedTarget(
      outPos,
      outLook,
      ARMED_DURATION * 0.25,
      initialCamPos,
      camFwd,
      camRight,
      wordCenter,
      spawnPoint,
      1,
    );
    const lateralProgress = outPos.x / ARMED_LATERAL_DRIFT;
    // outLook lerped from wordCenter (0,0,-22) toward spawnPoint
    // (50,5,-80). The X component reflects the lerp alpha.
    const lookProgress = outLook.x / spawnPoint.x;
    expect(lateralProgress).toBeGreaterThan(lookProgress);
  });

  it('clamps phaseT at 1 if sinceEnter overshoots ARMED_DURATION', () => {
    const a = new Vector3();
    const b = new Vector3();
    const aLook = new Vector3();
    const bLook = new Vector3();
    computeArmedTarget(
      a,
      aLook,
      ARMED_DURATION,
      initialCamPos,
      camFwd,
      camRight,
      wordCenter,
      spawnPoint,
      1,
    );
    computeArmedTarget(
      b,
      bLook,
      ARMED_DURATION * 5,
      initialCamPos,
      camFwd,
      camRight,
      wordCenter,
      spawnPoint,
      1,
    );
    expect(a.equals(b)).toBe(true);
    expect(aLook.equals(bLook)).toBe(true);
  });
});

describe('computeHerdPosition', () => {
  it('is at spawnPoint at t=0', () => {
    const out = new Vector3();
    computeHerdPosition(out, 0, spawnPoint, wordCenter);
    expect(out.equals(spawnPoint)).toBe(true);
  });

  it('reaches wordCenter at end of pre', () => {
    const out = new Vector3();
    computeHerdPosition(out, SWING_PRE, spawnPoint, wordCenter);
    expect(out.equals(wordCenter)).toBe(true);
  });

  it('clamps past end of pre — herd stays at wordCenter', () => {
    const out = new Vector3();
    computeHerdPosition(out, SWING_PRE * 2, spawnPoint, wordCenter);
    expect(out.equals(wordCenter)).toBe(true);
  });

  it('progress is monotonic', () => {
    let prev = -Infinity;
    for (let t = 0; t <= SWING_PRE; t += 0.1) {
      const out = new Vector3();
      computeHerdPosition(out, t, spawnPoint, wordCenter);
      // The lerp travels from spawnPoint (50,...) to wordCenter (0,...);
      // the X component decreases monotonically with progress.
      expect(out.x).toBeLessThanOrEqual(prev === -Infinity ? Infinity : prev);
      prev = out.x;
    }
  });
});

describe('computeChasePoint', () => {
  it('herd + sidePerp·14 + camUp·4 + motionDir·60 (each component unit-tested)', () => {
    const herd = new Vector3(0, 0, 0);
    const out = new Vector3();
    computeChasePoint(out, herd, sidePerp, camUp, motionDir);
    const expected = new Vector3()
      .copy(herd)
      .addScaledVector(sidePerp, CHASE_SIDE_DISTANCE)
      .addScaledVector(camUp, CHASE_UP_DISTANCE)
      .addScaledVector(motionDir, CHASE_AHEAD_DISTANCE);
    expect(out.distanceTo(expected)).toBeLessThan(1e-9);
  });
});

describe('computePreTarget', () => {
  it('starts ramping from preStartPos toward the chase point', () => {
    const outPos = new Vector3();
    const outLook = new Vector3();
    const herd = new Vector3();
    const chase = new Vector3();
    // At t = 0, ramp = 0, smoothstep(0) = 0 — outPos lerps NO progress
    // toward chase, but the late-pre `pow(0, 8) = 0` blend toward sideA
    // is also 0. So outPos = preStartPos.
    computePreTarget(
      outPos,
      outLook,
      herd,
      chase,
      0,
      preStartPos,
      spawnPoint,
      wordCenter,
      sideA,
      sidePerp,
      camUp,
      motionDir,
    );
    expect(outPos.distanceTo(preStartPos)).toBeLessThan(1e-9);
    // outLook = herd at t=0 = spawnPoint.
    expect(outLook.distanceTo(spawnPoint)).toBeLessThan(1e-9);
  });

  it("after CHASE_RAMP_DURATION, camera is on the chase point (before late-pre's sideA blend)", () => {
    const outPos = new Vector3();
    const outLook = new Vector3();
    const herd = new Vector3();
    const chase = new Vector3();
    computePreTarget(
      outPos,
      outLook,
      herd,
      chase,
      CHASE_RAMP_DURATION,
      preStartPos,
      spawnPoint,
      wordCenter,
      sideA,
      sidePerp,
      camUp,
      motionDir,
    );
    // ramp = 1 → smoothstep(1) = 1 → outPos = chase (modulo small
    // pow(phaseT, 8) toward sideA — which at t=0.5 of SWING_PRE=3.5 is
    // (0.143)^8 ≈ 9e-8, negligible).
    expect(outPos.distanceTo(chase)).toBeLessThan(1e-3);
  });

  it('late-pre blends toward sideA — outPos approaches sideA as t → SWING_PRE', () => {
    const outPos = new Vector3();
    const outLook = new Vector3();
    const herd = new Vector3();
    const chase = new Vector3();
    // Sample at exactly t = SWING_PRE - 1e-6: pow((1 - 1e-6/SWING_PRE), 8) ≈ 1
    // → blends almost fully to sideA.
    computePreTarget(
      outPos,
      outLook,
      herd,
      chase,
      SWING_PRE - 1e-6,
      preStartPos,
      spawnPoint,
      wordCenter,
      sideA,
      sidePerp,
      camUp,
      motionDir,
    );
    expect(outPos.distanceTo(sideA)).toBeLessThan(1e-3);
  });
});

describe('computeMidTarget', () => {
  it('starts at sideA at t = SWING_PRE', () => {
    const outPos = new Vector3();
    const outLook = new Vector3();
    computeMidTarget(outPos, outLook, SWING_PRE, sideA, sideB, wordCenter);
    expect(outPos.equals(sideA)).toBe(true);
    expect(outLook.equals(wordCenter)).toBe(true);
  });

  it('crosses sideA→sideB midpoint at t = SWING_PRE + SWING_MID/2', () => {
    const outPos = new Vector3();
    const outLook = new Vector3();
    computeMidTarget(outPos, outLook, SWING_PRE + SWING_MID / 2, sideA, sideB, wordCenter);
    const midX = (sideA.x + sideB.x) / 2;
    expect(outPos.x).toBeCloseTo(midX, 6);
  });

  it('reaches sideB at end of mid', () => {
    const outPos = new Vector3();
    const outLook = new Vector3();
    computeMidTarget(outPos, outLook, SWING_PRE + SWING_MID, sideA, sideB, wordCenter);
    expect(outPos.distanceTo(sideB)).toBeLessThan(1e-6);
  });
});

describe('computePostTarget', () => {
  it('starts at sideB / wordCenter at t = SWING_PRE + SWING_MID', () => {
    const outPos = new Vector3();
    const outLook = new Vector3();
    computePostTarget(
      outPos,
      outLook,
      SWING_PRE + SWING_MID,
      sideB,
      initialCamPos,
      wordCenter,
      formationCenter,
    );
    expect(outPos.equals(sideB)).toBe(true);
    expect(outLook.equals(wordCenter)).toBe(true);
  });

  it('ends at initialCamPos / formationCenter at SWING_DURATION', () => {
    const outPos = new Vector3();
    const outLook = new Vector3();
    computePostTarget(
      outPos,
      outLook,
      SWING_DURATION,
      sideB,
      initialCamPos,
      wordCenter,
      formationCenter,
    );
    expect(outPos.equals(initialCamPos)).toBe(true);
    expect(outLook.equals(formationCenter)).toBe(true);
  });

  it('clamps past SWING_DURATION — camera holds final pose', () => {
    const a = new Vector3();
    const b = new Vector3();
    const aLook = new Vector3();
    const bLook = new Vector3();
    computePostTarget(a, aLook, SWING_DURATION, sideB, initialCamPos, wordCenter, formationCenter);
    computePostTarget(
      b,
      bLook,
      SWING_DURATION + 5,
      sideB,
      initialCamPos,
      wordCenter,
      formationCenter,
    );
    expect(a.equals(b)).toBe(true);
    expect(aLook.equals(bLook)).toBe(true);
  });

  it('post duration aligns with SWING_POST', () => {
    // Sanity check on the constants — SWING_POST is what scales the
    // phaseT inside the helper; if it ever drifts from the difference
    // between SWING_DURATION and SWING_PRE+SWING_MID, the helper would
    // produce phaseT > 1 at the natural endpoint.
    expect(SWING_DURATION - SWING_PRE - SWING_MID).toBeCloseTo(SWING_POST, 10);
  });
});
