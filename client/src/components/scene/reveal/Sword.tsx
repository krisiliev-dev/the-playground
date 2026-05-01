/**
 * Sword — Phase 4
 *
 * Animates one sword instance through three keyframes:
 *   spawn: deep in front of the camera, in-frame but small from being far.
 *          Lateral offset is proportional to where the sword will end up
 *          in the letter, so the trajectory aligns visually.
 *   mid:   a stroke pose in the click-cam-relative letter plane —
 *          spelling out one stroke of "VIBE" (see vibeFormation.ts).
 *   end:   a slot on a circle around the click point on the wall, with the
 *          blade plunged perpendicular into the wall.
 *
 * Movement reads as a boomerang: sword bursts in from depth (with a flash
 * of light), races toward the camera, decelerates into the letter pose,
 * then reverses and flies forward into the wall. Time-to-progress curve
 * keeps motion continuous and smooth — no freeze frames.
 */
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useGLTF, Trail } from '@react-three/drei';
import {
  AdditiveBlending,
  Box3,
  CanvasTexture,
  CatmullRomCurve3,
  Group,
  Matrix4,
  type Mesh,
  MeshStandardMaterial,
  type Object3D,
  Quaternion,
  type Sprite,
  Vector3,
} from 'three';
import { useWorldStore } from '@/store';
import { triggerImpactShake } from '../cameraShake';
import { FORMATION_SCALE, type SwordSlot } from './vibeFormation';
import { sfx, type PositionalLoopHandle } from '../../audio/SfxManager';
import { useSwordKinematics } from './useSwordKinematics';

const SWORD_URL = '/models/sword/scene.gltf';

/** Target world-space height of the sword. Drives the scale factor we
 *  derive from the live bbox so the blade always lands on the wall.
 *  Scaled by the formation factor so swords don't overflow into
 *  adjacent letters on narrow-aspect displays — letter geometry and
 *  blade length shrink together. */
const TARGET_FULL_HEIGHT = 10 * FORMATION_SCALE;

/** Spawn-position offsets. Lateral is computed dynamically (ray-cast
 *  to the right side wall of the cube minus an inset), so the spawn
 *  always lands AT the side wall regardless of where the camera was
 *  when the user clicked. Forward + up are small fixed offsets. */
const SPAWN_FIXED_FWD = 80;
const SPAWN_FIXED_UP = 20;
/** Inset from the cube wall — sword spawns this many units inside the
 *  side wall surface so it's not embedded in the wall. */
const SPAWN_WALL_INSET = 30;

/** Letter-plane forward distance from the click camera. Mid pose is in
 *  this plane (camera-relative), so the formation reads at a fixed
 *  visual size regardless of where the click hit on the wall. */
const MID_FORWARD = 22;

/** End ring radius around the click point on the wall. Each sword lands
 *  on the ring at angle `slot.endAngle`. */
/** Radius of the end-circle around the click point on the wall.
 *  Scaled with the formation so that on narrow aspects the swords
 *  land in a tighter ring proportional to the letter size. */
const END_RADIUS = 10 * FORMATION_SCALE;
/** Visual scale at spawn — disabled (set to 1.0). Apparent "incoming"
 *  growth now comes from real depth (spawn at ~320 lateral / 80 forward
 *  is much farther than mid at 22 forward), so perspective alone makes
 *  the sword look tiny at spawn and grow to full presence at formation. */
const SPAWN_VISUAL_SCALE = 1.0;

/** Subtle upward bow — like a thrown spear's natural arc. Lateral
 *  components removed: the trajectory is now collinear (spawn→mid→end
 *  on a straight line), and any lateral bow would re-introduce the
 *  "weird path" the previous design suffered from. Vertical bow only,
 *  modest magnitude — just enough to feel like gravity-assisted motion. */
const BOW_LEG1_VERTICAL = 5;
const BOW_LEG2_VERTICAL = 7;

/** Explicit swing phases — pre extended for the slow sword approach.
 *  Pre: 3.5s deliberate approach (rocket-flight from far spawn → formation).
 *  Mid: 1.2s formation hold (bullet-time camera orbit).
 *  Post: 0.8s slam into the wall ring.
 *  Total per-sword 5.5s. */
const SWING_PRE = 3.5;
const SWING_MID = 1.2;
const SWING_POST = 0.8;
const SWING_DURATION = SWING_PRE + SWING_MID + SWING_POST;

/** Time spent rotating between sideways (tip along trajectory) and the
 *  upright letter-stroke pose. With longer pre, bumped to 0.5s — gives
 *  the "U-turn into formation" suave maneuver more room to breathe. */
const ORIENTATION_TURN_TIME = 0.5;

/** Tumble disabled — swords keep a steady direction during transit, like
 *  rockets piercing space. The slice roll on spawn/end orientations is
 *  still applied (edge leads the motion), just no spinning. */
const PRE_ROTATIONS = 0;
const POST_ROTATIONS = 0;

/** Italics tilt during the formation hold. Swords lean to one side at
 *  the start of mid, slowly tilt through upright, finish leaning the
 *  other way — gives the held formation a subtle "italic →
 *  reverse-italic" sway. Radians. */
const TILT_MAX = 0.18;

/** Per-sword stagger delay — each sword's swing begins this many seconds
 *  after the previous one. Tightened to 0.05s so the cascade reads as a
 *  rapid barrage rather than a leisurely procession. */
const STAGGER_DELAY = 0.05;

/** Lerp aggressiveness — higher = snappier. */
const LERP_RATE = 18;

/** Spawn flash effect: a brief 4-pointed star sprite that pops at each
 *  sword's spawn position when its staggered swing begins. Scale values
 *  are large because the spawn is far (~330 units) — at that distance,
 *  scale 50 subtends ~9° of view, which is the right "visible spark"
 *  size. Smaller values (e.g. 9) are essentially invisible from camera. */
const FLASH_DURATION = 0.35;
const FLASH_INITIAL_SCALE = 8;
const FLASH_MAX_SCALE = 50;
const FLASH_RISE_FRACTION = 0.2;

/** Impact flash effect: a separate spark burst at the wall when the
 *  sword's tip reaches the end pose. Cyan tint differentiates it from
 *  the spawn flash and matches the cyberpunk grid colour. */
const IMPACT_FLASH_DURATION = 0.18;
const IMPACT_FLASH_INITIAL_SCALE = 0.6;
const IMPACT_FLASH_MAX_SCALE = 7;

/** Smoothstep — cubic ease in/out. Standard tweener for phase-internal
 *  easing across each phase of the swing. */
function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

const TMP_BLADE_LOCAL = new Vector3(0, 1, 0);

/** 90° roll around the blade's own long axis (local +Y). Composed onto
 *  spawnQuat and endQuat so the sword presents its EDGE to the direction
 *  of motion during the swoosh phases — looks like a slice through the
 *  air rather than the broadside pushing against it. midQuat doesn't get
 *  this roll, so the formation reads broadside-on for letter legibility. */
const SLICE_ROLL_QUAT = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2);

/** Generate a 4-pointed star texture procedurally. Cached so all 12 sword
 *  instances share one texture (12 sprite mats, 1 GPU texture upload). */
let starTextureCache: CanvasTexture | null = null;
function getStarTexture(): CanvasTexture {
  if (starTextureCache) {
    return starTextureCache;
  }
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const img = ctx.createImageData(256, 256);
    for (let y = 0; y < 256; y++) {
      for (let x = 0; x < 256; x++) {
        const dx = (x - 128) / 128;
        const dy = (y - 128) / 128;
        // Two perpendicular Gaussian rays + a small bright centre.
        const hRay = Math.exp(-dy * dy * 800) * Math.exp(-dx * dx * 3);
        const vRay = Math.exp(-dx * dx * 800) * Math.exp(-dy * dy * 3);
        const centre = Math.exp(-(dx * dx + dy * dy) * 90) * 0.6;
        const a = Math.min(1, hRay + vRay + centre);
        const i = (y * 256 + x) * 4;
        img.data[i] = 255;
        img.data[i + 1] = 255;
        img.data[i + 2] = 255;
        img.data[i + 3] = Math.floor(a * 255);
      }
    }
    ctx.putImageData(img, 0, 0);
  }
  starTextureCache = new CanvasTexture(canvas);
  starTextureCache.needsUpdate = true;
  return starTextureCache;
}

export interface SwordProps {
  slot: SwordSlot;
  /** Position in the spawn cascade. Sword `i` starts its swing
   *  `i × STAGGER_DELAY` seconds after the global 'swinging' state
   *  begins. Defaults to 0 (no stagger) for tests + back-compat. */
  staggerIndex?: number;
}

export function Sword({ slot, staggerIndex = 0 }: SwordProps): JSX.Element {
  const groupRef = useRef<Group>(null);
  const gltf = useGLTF(SWORD_URL);

  // Clone the scene per instance (Three.js objects can only have one
  // parent). Materials are also cloned so per-instance opacity ramps don't
  // fight each other.
  const scene = useMemo(() => {
    const cloned = gltf.scene.clone(true);
    cloned.traverse((obj: Object3D) => {
      const mesh = obj as Mesh;
      if (mesh.isMesh && mesh.material && !Array.isArray(mesh.material)) {
        mesh.material = (mesh.material as MeshStandardMaterial).clone();
      }
    });
    return cloned;
  }, [gltf.scene]);

  const revealState = useWorldStore((s) => s.revealState);
  const clickHit = useWorldStore((s) => s.clickHit);
  const dimensions = useWorldStore((s) => s.environment.dimensions);
  const cubeHalf = useMemo(
    () => new Vector3(dimensions[0] / 2, dimensions[1] / 2, dimensions[2] / 2),
    [dimensions],
  );

  const stateEnteredAt = useRef(0);
  const previousState = useRef(revealState);
  /** Per-sword flying-audio loop handle. Created when this sword's
   *  swing begins, position-updated each frame to track the mesh,
   *  stopped on impact. Ref so it survives re-renders. */
  const flyingHandleRef = useRef<PositionalLoopHandle | null>(null);
  /** Per-frame motion → audio binding (speed/spin/jerk → volume +
   *  pitch + dither on the flying loop). Returns the linear speed
   *  each frame so we can capture velocity AT impact for the
   *  swordSlam fire's velocity-scaled volume + pitch jitter. */
  const updateKinematics = useSwordKinematics();
  /** Velocity magnitude at the moment of slam fire — captured to
   *  scale the swordSlam cue's volume + pitch jitter, so harder hits
   *  (faster impact velocity) feel heavier. */
  const slamVelocity = useRef(0);
  // Stop the flying loop if the sword unmounts mid-flight (e.g. test
  // teardown or hot-reload) so it doesn't keep humming.
  useEffect(
    () => () => {
      flyingHandleRef.current?.stop();
      flyingHandleRef.current = null;
    },
    [],
  );
  // Stop the flying loop whenever the reveal leaves the swinging
  // state. The per-frame slam check only fires while `revealState ===
  // 'swinging'`, so if the orchestrator advances to `impact` before
  // a sword's swing arc completes (timer-driven, not slam-driven),
  // the slam path is skipped and the loop would otherwise keep
  // humming forever. This effect catches every state-exit path AND
  // fires a catch-up slam for any sword that hasn't fired one yet,
  // so all 11 slams are guaranteed audible regardless of timer race.
  useEffect(() => {
    if (revealState === 'swinging') {
      return;
    }
    flyingHandleRef.current?.stop(80);
    flyingHandleRef.current = null;
    if (revealState === 'impact' && !impactFired.current && clickHit) {
      impactFired.current = true;
      const SLAM_POS_JITTER = 20;
      // Use a moderate default velocity for catch-up slams since the
      // sword may not have completed its arc to peak speed.
      const fallbackVel = 60;
      void sfx.play('swordSlam', {
        volumeMultiplier: 0.55,
        pitchJitter: 0.6 + Math.min(0.15, fallbackVel / 400),
        filterGain: (Math.random() - 0.5) * 20,
        position: {
          x: clickHit.point[0] + (Math.random() - 0.5) * SLAM_POS_JITTER,
          y: clickHit.point[1] + (Math.random() - 0.5) * SLAM_POS_JITTER,
          z: clickHit.point[2] + (Math.random() - 0.5) * SLAM_POS_JITTER,
        },
      });
    }
  }, [revealState, clickHit]);
  useEffect(() => {
    if (previousState.current !== revealState) {
      stateEnteredAt.current = performance.now() / 1000;
      previousState.current = revealState;
    }
  }, [revealState]);

  // One-time setup: hide non-target variants, recentre on bbox, prepare
  // materials for opacity ramps.
  useEffect(() => {
    const root = scene;
    const isInChosenVariant = (obj: Object3D): boolean => {
      let cur: Object3D | null = obj;
      while (cur) {
        if (cur.name === slot.variant) {
          return true;
        }
        cur = cur.parent;
      }
      return false;
    };
    root.traverse((obj) => {
      const mesh = obj as Mesh;
      if (mesh.isMesh) {
        mesh.visible = isInChosenVariant(obj);
      }
    });

    const visibleVariant = root.getObjectByName(slot.variant);
    if (visibleVariant) {
      const box = new Box3().setFromObject(visibleVariant);
      const center = box.getCenter(new Vector3());
      root.position.sub(center);
    }

    root.traverse((obj: Object3D) => {
      const mesh = obj as Object3D & {
        material?: { transparent?: boolean; opacity?: number };
      };
      if (mesh.material && typeof mesh.material === 'object') {
        mesh.material.transparent = true;
        mesh.material.opacity = 0;
      }
    });
  }, [scene, slot.variant]);

  // Reusable buffers — no per-frame allocations.
  const targetPos = useMemo(() => new Vector3(), []);
  const targetQuat = useMemo(() => new Quaternion(), []);
  const spawnQuat = useMemo(() => new Quaternion(), []);
  const midQuat = useMemo(() => new Quaternion(), []);
  const endQuat = useMemo(() => new Quaternion(), []);
  const tmpA = useMemo(() => new Vector3(), []);
  const tmpB = useMemo(() => new Vector3(), []);
  const tmpQ = useMemo(() => new Quaternion(), []);
  const inwardRadial = useMemo(() => new Vector3(), []);
  const tangent = useMemo(() => new Vector3(), []);
  const endMatrix = useMemo(() => new Matrix4(), []);

  const hitPoint = useMemo(() => new Vector3(), []);
  const hitNormal = useMemo(() => new Vector3(), []);

  const clickCamPos = useMemo(() => new Vector3(), []);
  const clickCamQuat = useMemo(() => new Quaternion(), []);

  const camFwd = useMemo(() => new Vector3(), []);
  const camRight = useMemo(() => new Vector3(), []);
  const camUp = useMemo(() => new Vector3(), []);
  const wallRight = useMemo(() => new Vector3(), []);
  const wallUp = useMemo(() => new Vector3(), []);

  const spawnPos = useMemo(() => new Vector3(), []);
  const midPos = useMemo(() => new Vector3(), []);
  const endPos = useMemo(() => new Vector3(), []);
  const leg1Bow = useMemo(() => new Vector3(), []);
  const leg2Bow = useMemo(() => new Vector3(), []);

  /** Reusable Catmull-Rom curve through the 5 control points. The path
   *  passes through (spawn, leg1Bow, mid, leg2Bow, end) in order; the
   *  bow points add the boomerang arc on top of the natural depth swap. */
  const trajectoryCurve = useMemo(
    () =>
      new CatmullRomCurve3(
        [new Vector3(), new Vector3(), new Vector3(), new Vector3(), new Vector3()],
        false,
        'catmullrom',
        0.5,
      ),
    [],
  );

  const camera = useThree((s) => s.camera);
  const captured = useRef(false);
  const lastTargetRef = useRef(0);
  /** The bbox-derived scale factor we use as the "1.0" calibrated size.
   *  Multiplied by SPAWN_VISUAL_SCALE → 1.0 across the swing. */
  const calibratedScale = useRef(1);

  // Spawn flash — a 4-pointed star sprite positioned at spawnPos. Fires
  // per-sword when this sword's staggered swing begins (not on the global
  // armed transition), so the cascade reads as flashes-in-succession.
  const flashRef = useRef<Sprite>(null);
  const flashStartedAt = useRef(-1);
  const starTexture = useMemo(() => getStarTexture(), []);

  // Impact flash — second sprite positioned at endPos. Fires when the
  // sword's effective `t` first crosses SWING_DURATION (the moment the
  // blade reaches the wall). Gives the wall arrival visible consequence.
  const impactFlashRef = useRef<Sprite>(null);
  const impactFlashStartedAt = useRef(-1);
  const impactFired = useRef(false);

  useEffect(() => {
    if (revealState === 'idle') {
      flashStartedAt.current = -1;
      impactFlashStartedAt.current = -1;
      impactFired.current = false;
    }
  }, [revealState]);

  useFrame((state, delta) => {
    const obj = groupRef.current;
    if (!obj) {
      return;
    }

    // Once-per-target scale calibration. Measure live bbox of the visible
    // variant at scale=1, then derive the factor that brings the blade to
    // TARGET_FULL_HEIGHT in world units. We *don't* set the scale here —
    // the swing logic below applies SPAWN_VISUAL_SCALE → 1.0 on top of
    // this calibrated factor.
    if (lastTargetRef.current !== TARGET_FULL_HEIGHT) {
      const visibleVariant = scene.getObjectByName(slot.variant);
      if (visibleVariant) {
        obj.scale.setScalar(1);
        const box = new Box3().setFromObject(visibleVariant);
        const currentHeight = box.getSize(new Vector3()).y;
        if (currentHeight > 1e-3) {
          const factor = TARGET_FULL_HEIGHT / currentHeight;
          calibratedScale.current = factor;
          obj.scale.setScalar(factor);
          lastTargetRef.current = TARGET_FULL_HEIGHT;
        }
      }
    }

    // Capture camera pose on the first frame we see `armed`. Once captured
    // the trajectory is fixed regardless of camera motion afterwards.
    if (revealState === 'armed' && !captured.current) {
      clickCamPos.copy(camera.position);
      clickCamQuat.copy(camera.quaternion);
      captured.current = true;
    }
    if (revealState === 'idle') {
      captured.current = false;
    }

    if (clickHit) {
      hitPoint.set(...clickHit.point);
      hitNormal.set(...clickHit.normal);
    } else {
      hitPoint.set(0, 0, -400);
      hitNormal.set(0, 0, 1);
    }

    // Camera basis at click time.
    camFwd.set(0, 0, -1).applyQuaternion(clickCamQuat);
    camRight.set(1, 0, 0).applyQuaternion(clickCamQuat);
    camUp.set(0, 1, 0).applyQuaternion(clickCamQuat);

    // Wall basis (in the wall plane, derived from the hit normal).
    wallUp.copy(camUp).addScaledVector(hitNormal, -camUp.dot(hitNormal));
    if (wallUp.lengthSq() < 1e-3) {
      wallUp.set(0, 1, 0);
    }
    wallUp.normalize();
    wallRight.crossVectors(wallUp, hitNormal).normalize();

    // ------- positions -------
    // Spawn: at the right side wall of the cube. Compute the lateral
    // distance to the wall by ray-casting camRight from clickCamPos
    // to the cube boundary, then offset slightly inward (SPAWN_WALL_INSET)
    // so the sword isn't embedded in the wall surface.
    let tWall = Infinity;
    if (Math.abs(camRight.x) > 1e-6) {
      const t1 = (cubeHalf.x - clickCamPos.x) / camRight.x;
      const t2 = (-cubeHalf.x - clickCamPos.x) / camRight.x;
      if (t1 > 0 && t1 < tWall) {
        tWall = t1;
      }
      if (t2 > 0 && t2 < tWall) {
        tWall = t2;
      }
    }
    if (Math.abs(camRight.y) > 1e-6) {
      const t1 = (cubeHalf.y - clickCamPos.y) / camRight.y;
      const t2 = (-cubeHalf.y - clickCamPos.y) / camRight.y;
      if (t1 > 0 && t1 < tWall) {
        tWall = t1;
      }
      if (t2 > 0 && t2 < tWall) {
        tWall = t2;
      }
    }
    if (Math.abs(camRight.z) > 1e-6) {
      const t1 = (cubeHalf.z - clickCamPos.z) / camRight.z;
      const t2 = (-cubeHalf.z - clickCamPos.z) / camRight.z;
      if (t1 > 0 && t1 < tWall) {
        tWall = t1;
      }
      if (t2 > 0 && t2 < tWall) {
        tWall = t2;
      }
    }
    const lateralDist = Math.max(0, tWall - SPAWN_WALL_INSET);
    spawnPos
      .copy(clickCamPos)
      .addScaledVector(camRight, lateralDist)
      .addScaledVector(camFwd, SPAWN_FIXED_FWD)
      .addScaledVector(camUp, SPAWN_FIXED_UP);
    // Clamp to cube interior. The camFwd/camUp offsets can push the
    // final position past a non-camRight wall (e.g. when the camera is
    // rotated so camRight has significant Z component, the +Z wall is
    // closer than the +X wall). Per-axis clamp guarantees inside-cube
    // regardless of camera orientation.
    {
      const limX = cubeHalf.x - SPAWN_WALL_INSET;
      const limY = cubeHalf.y - SPAWN_WALL_INSET;
      const limZ = cubeHalf.z - SPAWN_WALL_INSET;
      spawnPos.x = Math.max(-limX, Math.min(limX, spawnPos.x));
      spawnPos.y = Math.max(-limY, Math.min(limY, spawnPos.y));
      spawnPos.z = Math.max(-limZ, Math.min(limZ, spawnPos.z));
    }
    // Mid: stroke centre in the click-cam-relative letter plane (formation
    // hovers in the air close to camera).
    midPos
      .copy(clickCamPos)
      .addScaledVector(camFwd, MID_FORWARD)
      .addScaledVector(camRight, slot.midPos[0])
      .addScaledVector(camUp, slot.midPos[1]);
    // End: ring around the click point on the wall (per-sword endAngle).
    endPos
      .copy(hitPoint)
      .addScaledVector(wallRight, END_RADIUS * Math.cos(slot.endAngle))
      .addScaledVector(wallUp, END_RADIUS * Math.sin(slot.endAngle));

    // Bow control points — vertical only. With spawn → mid → end already
    // collinear, the bow gives the trajectory a gentle upward arc
    // (overhand-throw feel) without re-introducing lateral wiggle.
    leg1Bow.copy(spawnPos).lerp(midPos, 0.5).addScaledVector(camUp, BOW_LEG1_VERTICAL);
    leg2Bow.copy(midPos).lerp(endPos, 0.5).addScaledVector(camUp, BOW_LEG2_VERTICAL);
    trajectoryCurve.points[0]!.copy(spawnPos);
    trajectoryCurve.points[1]!.copy(leg1Bow);
    trajectoryCurve.points[2]!.copy(midPos);
    trajectoryCurve.points[3]!.copy(leg2Bow);
    trajectoryCurve.points[4]!.copy(endPos);

    // ------- orientations -------
    // Spawn blade: along trajectory toward mid, with the 90° slice roll
    // so the edge leads the flight (slicing through air).
    tmpA.copy(midPos).sub(spawnPos);
    if (tmpA.lengthSq() < 1e-6) {
      tmpA.copy(camFwd);
    }
    tmpA.normalize();
    spawnQuat.setFromUnitVectors(TMP_BLADE_LOCAL, tmpA).multiply(SLICE_ROLL_QUAT);
    // Mid blade: along the letter stroke direction in the camera-relative
    // letter plane. No slice roll — formation reads broadside-on so
    // letters are legible from the camera POV.
    tmpA
      .copy(camRight)
      .multiplyScalar(slot.midDir[0])
      .addScaledVector(camUp, slot.midDir[1])
      .normalize();
    midQuat.setFromUnitVectors(TMP_BLADE_LOCAL, tmpA);
    // End orientation: blade perpendicular into wall (-hitNormal) AND
    // the sword's FLAT SIDE facing the centre of the ring. Build the
    // base rotation matrix (local +X → inwardRadial), then compose a
    // 90° roll around the blade axis so the flat side (was at local
    // +Z) ends up pointing toward the centre instead of the edge.
    inwardRadial.copy(hitPoint).sub(endPos);
    if (inwardRadial.lengthSq() < 1e-6) {
      inwardRadial.copy(camRight);
    }
    inwardRadial.normalize();
    tmpB.copy(hitNormal).negate(); // blade direction (local +Y)
    tangent.crossVectors(inwardRadial, tmpB).normalize();
    endMatrix.makeBasis(inwardRadial, tmpB, tangent);
    endQuat.setFromRotationMatrix(endMatrix).multiply(SLICE_ROLL_QUAT);

    // ------- phase logic -------
    const sinceEnter = state.clock.elapsedTime - stateEnteredAt.current;
    // Effective swing time for this sword — offset by the cascade index.
    // Swords with t < 0 haven't started yet (still parked at spawn,
    // invisible). Once t crosses 0, the flash fires and the swing runs.
    const t = sinceEnter - staggerIndex * STAGGER_DELAY;

    // Fire this sword's flash exactly when its effective swing begins.
    if (revealState === 'swinging' && flashStartedAt.current < 0 && t >= 0) {
      flashStartedAt.current = state.clock.elapsedTime;
      // Spawn punch: per-sword cue at the spawn point. Reverb is set
      // in the manifest so the cube room "rings" each spawn.
      const spawnAt = { x: spawnPos.x, y: spawnPos.y, z: spawnPos.z };
      void sfx.play('spawnFlash', { volumeMultiplier: 0.5, position: spawnAt });
      // Per-sword flying loop: starts at spawn, position is updated
      // each frame below to track the sword's mesh. Distance falloff
      // is handled by the panner so close-passing swords swell while
      // far ones stay quiet — the "dynamicness" the user wanted from
      // the cascade.
      flyingHandleRef.current = sfx.playPositionalLoop('swordFlying', spawnAt, {
        pitchJitter: 0.12,
        volumeMultiplier: 0.7,
      });
    }
    // Fire this sword's IMPACT flash + shake when it reaches the end of
    // its swing (slams into the wall ring after the post leg).
    if (revealState === 'swinging' && !impactFired.current && t >= SWING_DURATION) {
      impactFlashStartedAt.current = state.clock.elapsedTime;
      impactFired.current = true;
      triggerImpactShake(state.clock.elapsedTime);
      // Stop this sword's flying loop with a short fade so the cut
      // isn't an audible click — the slam's transient and the room's
      // wet tail cover the silence.
      flyingHandleRef.current?.stop(60);
      flyingHandleRef.current = null;
      // Velocity-driven slam + spatial jitter. Each slam:
      //   - Volume scaled by impact velocity (harder hit → louder).
      //   - Pitch jitter widened to ±40% (was ±25%) for distinctness
      //     across the 12-cascade.
      //   - Position offset by a small random vector around the wall
      //     hit point so each slam emits from a slightly different
      //     spatial location — the panner gives them slightly
      //     different stereo positions, helping the ear separate
      //     them instead of merging into a single block.
      const v = slamVelocity.current;
      const velFactor = Math.min(1.6, 0.7 + v / 80);
      // Wide jitter + spatial spread + per-fire EQ for cascade
      // distinctness:
      //   - pitchJitter 0.6 + velocity boost: each slam at a
      //     noticeably different fundamental frequency.
      //   - position jittered around hit point: each slam pans to a
      //     different stereo location.
      //   - filterGain ±10dB: high-shelf boost/cut at 3kHz varies per
      //     slam — some bright, some dark. Slam.wav is low-end heavy,
      //     so without per-fire EQ the 12 hits all sit in the same
      //     frequency band and the ear can't separate them.
      const SLAM_POS_JITTER = 20;
      void sfx.play('swordSlam', {
        volumeMultiplier: 0.55 * velFactor,
        pitchJitter: 0.6 + Math.min(0.15, v / 400),
        filterGain: (Math.random() - 0.5) * 20,
        position: {
          x: hitPoint.x + (Math.random() - 0.5) * SLAM_POS_JITTER,
          y: hitPoint.y + (Math.random() - 0.5) * SLAM_POS_JITTER,
          z: hitPoint.z + (Math.random() - 0.5) * SLAM_POS_JITTER,
        },
      });
    }

    let opacityTarget = 0;
    let visualScale = 1;

    switch (revealState) {
      case 'idle':
      case 'armed':
        // Both invisible at spawn; the per-sword stagger inside 'swinging'
        // is what brings each sword into being.
        targetPos.copy(spawnPos);
        targetQuat.copy(spawnQuat);
        opacityTarget = 0;
        visualScale = SPAWN_VISUAL_SCALE;
        break;
      case 'swinging': {
        // Pre-cascade hold: sword waits at spawn, invisible, no flash yet.
        if (t < 0) {
          targetPos.copy(spawnPos);
          targetQuat.copy(spawnQuat);
          visualScale = SPAWN_VISUAL_SCALE;
          opacityTarget = 0;
          break;
        }
        // Past the swing end: park at end pose so this sword settles
        // while later-cascade swords are still arriving / formation
        // hold finishes for them.
        if (t > SWING_DURATION) {
          targetPos.copy(endPos);
          targetQuat.copy(endQuat);
          visualScale = 1;
          opacityTarget = 1;
          break;
        }

        // ------- position (curve param p, mapped through the 3 phases) -------
        // Pre: ease-OUT cubic — sword starts fast (rocket bursting in
        // from the distance) and decelerates into formation. The decel
        // IS the "U-turn into position" feel, suave settling.
        // Mid: tiny linear drift through the formation.
        // Post: ease-IN cubic — sword launches from formation,
        // accelerates exponentially into the wall.
        let p: number;
        if (t < SWING_PRE) {
          const phaseT = t / SWING_PRE;
          const eased = 1 - Math.pow(1 - phaseT, 3);
          p = 0.5 * eased;
        } else if (t < SWING_PRE + SWING_MID) {
          const phaseT = (t - SWING_PRE) / SWING_MID;
          p = 0.5 + 0.05 * phaseT;
        } else {
          const phaseT = Math.min(1, (t - SWING_PRE - SWING_MID) / SWING_POST);
          const eased = phaseT * phaseT * phaseT;
          p = 0.55 + 0.45 * eased;
        }
        trajectoryCurve.getPoint(p, targetPos);

        // ------- orientation (sideways → upright → sideways) -------
        // Pre flies sideways (tip-along-trajectory + slice roll), pivots
        // upright in the last 0.5s. Mid holds upright. Post takes the
        // ENTIRE 1s to rotate back to sideways — slow tilt-back into the
        // sideways pose, so the formation gracefully unfolds toward the
        // wall instead of snapping out in 0.5s.
        if (t < SWING_PRE - ORIENTATION_TURN_TIME) {
          targetQuat.copy(spawnQuat);
        } else if (t < SWING_PRE) {
          const ot = (t - (SWING_PRE - ORIENTATION_TURN_TIME)) / ORIENTATION_TURN_TIME;
          targetQuat.copy(spawnQuat).slerp(midQuat, smoothstep(ot));
        } else if (t < SWING_PRE + SWING_MID) {
          targetQuat.copy(midQuat);
        } else {
          // Post: full 1s slerp from midQuat (upright, broadside) to
          // endQuat (sideways, slice-rolled).
          const ot = Math.min(1, (t - SWING_PRE - SWING_MID) / SWING_POST);
          targetQuat.copy(midQuat).slerp(endQuat, smoothstep(ot));
        }

        // ------- italics tilt (mid + fade through post) -------
        // Mid: +TILT_MAX → -TILT_MAX over 2s. Post: continues from
        // -TILT_MAX → 0 over 1s, so the formation un-tilts smoothly as
        // it rotates to sideways instead of cutting off at the boundary.
        let tiltAngle = 0;
        if (t >= SWING_PRE && t < SWING_PRE + SWING_MID) {
          const midPhaseT = (t - SWING_PRE) / SWING_MID;
          tiltAngle = TILT_MAX * (1 - 2 * midPhaseT);
        } else if (t >= SWING_PRE + SWING_MID && t < SWING_PRE + SWING_MID + SWING_POST) {
          const postPhaseT = (t - SWING_PRE - SWING_MID) / SWING_POST;
          tiltAngle = -TILT_MAX * (1 - postPhaseT);
        }
        if (tiltAngle !== 0) {
          tmpQ.setFromAxisAngle(camFwd, tiltAngle);
          targetQuat.premultiply(tmpQ);
        }

        // ------- tumble (end-over-end spin in world frame) -------
        // Spin angle eases out (fast → slow) within each phase so each
        // ends at exactly N×2π — that's identity, so the sword lands
        // cleanly without residual rotation. Spin is zero through mid
        // so the formation reads as a held pose, not a frozen tumble.
        let spinAngle = 0;
        if (t < SWING_PRE) {
          const phaseT = t / SWING_PRE;
          const easeOut = 1 - Math.pow(1 - phaseT, 3);
          spinAngle = PRE_ROTATIONS * 2 * Math.PI * easeOut;
        } else if (t < SWING_PRE + SWING_MID) {
          spinAngle = 0;
        } else {
          const phaseT = Math.min(1, (t - SWING_PRE - SWING_MID) / SWING_POST);
          const easeOut = 1 - Math.pow(1 - phaseT, 3);
          spinAngle = POST_ROTATIONS * 2 * Math.PI * easeOut;
        }
        // Spin around world-space camera-up axis so the sword swings
        // sideways in the camera's horizontal plane (helicopter-blade
        // rotation rather than vertical end-over-end tumble).
        tmpQ.setFromAxisAngle(camUp, spinAngle);
        targetQuat.premultiply(tmpQ);

        // ------- visual scale (small → full over the pre phase) -------
        if (t < SWING_PRE) {
          const phaseT = t / SWING_PRE;
          visualScale = SPAWN_VISUAL_SCALE + (1 - SPAWN_VISUAL_SCALE) * smoothstep(phaseT);
        } else {
          visualScale = 1;
        }

        opacityTarget = 1;
        break;
      }
      case 'impact':
      case 'revealed':
      default:
        targetPos.copy(endPos);
        targetQuat.copy(endQuat);
        opacityTarget = 1;
        visualScale = 1;
        break;
    }

    obj.position.copy(targetPos);
    obj.quaternion.copy(targetQuat);
    obj.scale.setScalar(calibratedScale.current * visualScale);

    // Drive the flying loop's volume/pitch/dither from per-frame
    // motion derivatives, and stash the linear speed so the next-frame
    // slam check sees the velocity AT impact.
    const dt = Math.max(delta, 1 / 240);
    slamVelocity.current = updateKinematics(targetPos, targetQuat, dt, flyingHandleRef.current);

    const lerpT = 1 - Math.exp(-LERP_RATE * delta);
    scene.traverse((o: Object3D) => {
      const mesh = o as Object3D & { material?: { opacity?: number } };
      if (mesh.material && typeof mesh.material.opacity === 'number') {
        mesh.material.opacity += (opacityTarget - mesh.material.opacity) * lerpT;
      }
    });

    // ------- spawn flash animation -------
    const flashSprite = flashRef.current;
    if (flashSprite) {
      flashSprite.position.copy(spawnPos);
      const flashMat = flashSprite.material;
      const startedAt = flashStartedAt.current;
      if (startedAt >= 0) {
        const elapsed = state.clock.elapsedTime - startedAt;
        if (elapsed < FLASH_DURATION) {
          const p = elapsed / FLASH_DURATION;
          flashSprite.scale.setScalar(
            FLASH_INITIAL_SCALE + p * (FLASH_MAX_SCALE - FLASH_INITIAL_SCALE),
          );
          flashMat.opacity =
            p < FLASH_RISE_FRACTION
              ? p / FLASH_RISE_FRACTION
              : Math.max(0, 1 - (p - FLASH_RISE_FRACTION) / (1 - FLASH_RISE_FRACTION));
        } else {
          flashMat.opacity = 0;
        }
      } else {
        flashMat.opacity = 0;
      }
    }

    // ------- impact flash animation -------
    const impactSprite = impactFlashRef.current;
    if (impactSprite) {
      impactSprite.position.copy(endPos);
      const impactMat = impactSprite.material;
      const startedAt = impactFlashStartedAt.current;
      if (startedAt >= 0) {
        const elapsed = state.clock.elapsedTime - startedAt;
        if (elapsed < IMPACT_FLASH_DURATION) {
          const p = elapsed / IMPACT_FLASH_DURATION;
          impactSprite.scale.setScalar(
            IMPACT_FLASH_INITIAL_SCALE + p * (IMPACT_FLASH_MAX_SCALE - IMPACT_FLASH_INITIAL_SCALE),
          );
          // Hard pop + linear fade — impact reads as a sharp hit, not
          // a soft glow.
          impactMat.opacity = 1 - p;
        } else {
          impactMat.opacity = 0;
        }
      } else {
        impactMat.opacity = 0;
      }
    }
  });

  return (
    <>
      <Trail width={0.4} color="#00ffcc" length={0.6} decay={1} attenuation={(t) => t * t}>
        <group ref={groupRef} position={[0, 60, 0]}>
          <primitive object={scene} />
        </group>
      </Trail>
      <sprite ref={flashRef}>
        <spriteMaterial
          map={starTexture}
          color="#ffffff"
          transparent
          opacity={0}
          blending={AdditiveBlending}
          depthWrite={false}
        />
      </sprite>
      <sprite ref={impactFlashRef}>
        <spriteMaterial
          map={starTexture}
          color="#00ffcc"
          transparent
          opacity={0}
          blending={AdditiveBlending}
          depthWrite={false}
        />
      </sprite>
    </>
  );
}

useGLTF.preload(SWORD_URL);

export const SWORD_CONSTANTS = {
  TARGET_FULL_HEIGHT,
  SWING_DURATION_MS: SWING_DURATION * 1000,
} as const;
