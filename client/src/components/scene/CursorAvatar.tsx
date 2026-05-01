/**
 * CursorAvatar — single 3D mesh that plays two roles, split into two
 * focused subcomponents:
 *
 *   POINTER MODE  — `<PointerCursor />`
 *     Sits at a fixed near-camera depth, projected from the OS pointer's
 *     NDC. Faces the camera. Acts visually as the user's cursor while
 *     reveal is idle / mid-reveal.
 *
 *   AVATAR MODE   — `<AvatarCursor />`
 *     Becomes a world-space avatar driven by WASD + mouselook. The
 *     camera anchors to it in a classic 3rd-person follow rig: a
 *     fixed offset in the avatar's local frame, rotating with
 *     yaw/pitch. Activated when the user dismisses the controls hint.
 *
 * `ActiveCursor` is the orchestrator. It owns the cursor mesh + outline
 * shells, the shared refs that survive the mode transition, and the
 * input listeners (which span both modes — touch swipe-to-look, drag
 * promotion, press-on-interactable, mouselook). The two subcomponents
 * each own one useFrame and never mount simultaneously.
 *
 * The OS cursor stays hidden whenever this component is mounted.
 */
import { useEffect, useMemo, useRef, type MutableRefObject, type RefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import {
  BackSide,
  Box3,
  Color,
  Euler,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  Quaternion,
  Raycaster,
  Vector2,
  Vector3,
} from 'three';
import { useWorldStore } from '@/store';
import { useIsTouchPrimary } from '@/utils';
import { sfx } from '../audio/SfxManager';
import { interactableHandlers, setTouchInProgress } from './Interactable';
import { SWING_PRE } from './reveal/constants';
import {
  clampToBoxInterior,
  computeCameraCollisionRatio,
  computeInitialPanProgress,
  computeLeanTarget,
  computeWalkVector,
  computeWallProximity,
  projectNDCToWorld,
  setYawQuat,
} from './cursorAvatarMath';

const MODEL_URL = '/models/3d_icon_cursor.glb';

// ─── Pointer-mode constants ───────────────────────────────────────────
/** Distance in front of the camera at which the pointer-mode cursor sits.
 *  Kept small so the cursor reads as foreground, not stuck on the wall. */
const POINTER_DEPTH = 3;
const POINTER_SCALE = 0.001;

// ─── Avatar-mode constants ────────────────────────────────────────────
const AVATAR_SCALE = 0.03;
const SCALE_LERP_RATE = 5.0;
/** Avatar movement (world units / sec). */
const WALK_SPEED = 60;
/** Mouse-delta → radians multiplier. */
const MOUSE_SENSITIVITY = 0.0025;
/** Camera offset behind+above the avatar, in the avatar's local frame.
 *  Tighter than a typical 3rd-person rig — the cursor-as-avatar feels
 *  best when the camera sits close. */
const FOLLOW_OFFSET = new Vector3(0, 3, 8);
/** Camera looks slightly above the avatar's origin (its "head"). */
const LOOK_AHEAD_HEIGHT = 1.5;
/** Padding from the cube walls — keeps the avatar's body clear of the
 *  geometry so it never visibly pokes through. */
const AVATAR_WALL_MARGIN = 8;
/** Cursor lean animation. While the user holds mouse-down on an
 *  interactable, the cursor lerps from its follow-rig position to a
 *  point just behind the target's surface (so the cursor's tip
 *  visually touches the object). On mouse-up it lerps back. Lerp rate
 *  is high so the lean feels snappy and physical, not floaty. The
 *  same rate drives the orientation slerp (camera-aligned + forward
 *  tilt while pressed; back to yaw-only on release). */
const LEAN_LERP_RATE = 32;
/** Extra forward pitch applied to the cursor's orientation while
 *  pressed — beyond the captured press-time camera alignment — so
 *  the cursor visibly *leans into* the target. ~32° is the smallest
 *  angle that reads as a deliberate bow at a glance; smaller values
 *  look static, larger ones over-rotate. Negative because we rotate
 *  around +X and the tip-direction is local -Z. */
const LEAN_TILT_RAD = -0.55;
/** How close (in world units) the avatar has to be to a wall before
 *  the wall-ambient drone becomes audible. Outside this band the
 *  ambient is silent; at distance 0 it's at the manifest base volume. */
const WALL_AMBIENT_FADE_DISTANCE = 12;
/** Manifest base volume for `wallAmbient` — kept in sync with
 *  sfxManifest.ts so the proximity factor can multiply against it. */
const WALL_AMBIENT_BASE_VOLUME = 0.5;
/** Padding from the cube walls for the camera. Smaller than the avatar
 *  margin so the camera can pull in tight when the avatar approaches a
 *  wall, without clipping through. */
const CAMERA_WALL_MARGIN = 3;
/** Lerp rate for the camera-to-target position interpolation. Used both
 *  when shortening (wall approaches) and when restoring (wall recedes),
 *  giving a coherent ease either way. */
const CAMERA_LERP_RATE = 12;
/** Seconds for the initial cinematic pan into 3rd-person view (smoothstep
 *  eased over time). After this elapses, the camera switches to per-frame
 *  lerp for ongoing follow. */
const INITIAL_PAN_DURATION = 1.5;

// ─── Mesh / appearance constants (shared) ─────────────────────────────
const EMISSIVE_HEX = '#00ffcc';
const EMISSIVE_INTENSITY = 1.0;
const BODY_COLOR_HEX = '#0a1a18';
/** Outline shell rendered as a back-faced, slightly-enlarged copy of
 *  each cursor mesh. Front faces are culled (BackSide) so only the
 *  back faces of the larger shell are visible — they appear as a
 *  halo at the cursor's silhouette. Main cursor renderOrder = 999;
 *  outline = 998 so the inside of the halo gets covered by the
 *  cursor and only the rim remains. The outline shares the cursor's
 *  `depthTest: false` so it stays on top of haze/geometry like the
 *  cursor itself. */
const OUTLINE_COLOR_HEX = '#ffffff';
const OUTLINE_SCALE = 1.06;
/** Asymmetric shift applied to the outline mesh, expressed as
 *  fractions of the cursor model's bbox size. After the geometry is
 *  re-centred for symmetric scaling, this offset pushes the outline
 *  slightly south + east (cursor-local -Y, +X) so the silhouette
 *  reads with weight toward the lower-right. */
const OUTLINE_SHIFT_X_FRACTION = 0.012;
const OUTLINE_SHIFT_Y_FRACTION = 0.012;

useGLTF.preload(MODEL_URL);

/**
 * Shared state between ActiveCursor and its mode subcomponents.
 * Bundled into one object so each subcomponent receives a single
 * `cursor` prop instead of 15+ individual refs. All refs survive
 * the mode transition (they live in ActiveCursor's scope), so a
 * value written by `<PointerCursor>` on its last frame is visible
 * to `<AvatarCursor>` on its first frame — that's how the initial
 * pan reads the cursor's screen-position to lerp from.
 */
interface CursorRefs {
  groupRef: RefObject<Group>;
  renderedScale: MutableRefObject<number>;
  tipLocalOffset: MutableRefObject<Vector3>;
  /** Avatar body position in world space. Read by AvatarCursor's
   *  follow rig; reset on entry to avatar mode. */
  avatarPos: MutableRefObject<Vector3>;
  avatarYaw: MutableRefObject<number>;
  avatarPitch: MutableRefObject<number>;
  /** WASD held state — populated by ActiveCursor's keyboard listener. */
  keys: MutableRefObject<{ w: boolean; a: boolean; s: boolean; d: boolean }>;
  /** Continuous forward/back throttle from a 2-finger pinch on touch
   *  devices. -1 = full backward, +1 = full forward, 0 = no walk. */
  touchWalkVelocity: MutableRefObject<number>;
  /** Initial-pan capture state. PointerCursor resets this every
   *  frame so the next AvatarCursor mount starts clean; AvatarCursor
   *  initializes on its first frame. */
  initialPanStart: MutableRefObject<number | null>;
  /** Cursor's *rendered* world position, persisted across frames so
   *  the follow-rig lerp accumulates instead of resetting. */
  renderedCursorPos: MutableRefObject<Vector3>;
  /** Lean-on-press capture: pose at the moment the user pressed an
   *  interactable. Used by AvatarCursor to keep the cursor world-
   *  anchored on the target while the user rotates the camera. */
  pressAnchorQuat: Quaternion;
  /** Captured pointer NDC during world-frozen / camera-anchored
   *  pointer modes. PointerCursor writes; the value persists if the
   *  pre-reveal click chain captures one before AvatarCursor takes
   *  over. */
  pointerCaptured: MutableRefObject<boolean>;
  capturedPointer: MutableRefObject<{ x: number; y: number }>;
  cursorFrozen: MutableRefObject<boolean>;
  frozenCursorPos: MutableRefObject<Vector3>;
  frozenCursorQuat: MutableRefObject<Quaternion>;
  swingingEnteredAt: MutableRefObject<number>;
}

// ─── Top-level entry point ────────────────────────────────────────────

export function CursorAvatar(): JSX.Element | null {
  const active = useWorldStore((s) => s.cursorAvatarActive);
  const revealState = useWorldStore((s) => s.revealState);
  const menuOpen = useWorldStore((s) => s.menuOpen);
  const isTouch = useIsTouchPrimary();

  // Hide the OS cursor while the avatar is active — except when the
  // pause menu is open. With the menu up the user expects a normal
  // cursor for hovering buttons; the 3D cursor would just be in the
  // way (and was the source of the "cursor invisible until hover"
  // bug, since the browser only reveals the OS cursor on its own
  // when there's an interaction surface to point at).
  useEffect(() => {
    if (!active || menuOpen) {
      return;
    }
    const previous = document.body.style.cursor;
    document.body.style.cursor = 'none';
    return () => {
      document.body.style.cursor = previous;
    };
  }, [active, menuOpen]);

  if (!active) {
    return null;
  }
  // On touch devices, hide the cursor mesh until the swords slam into
  // the wall — there's no OS pointer to mirror in the early phases,
  // and a floating arrow at screen centre is more confusing than
  // helpful. Becomes visible at `impact` so it's there for the
  // controls hint dismissal + avatar-mode interaction.
  if (isTouch && revealState !== 'impact' && revealState !== 'revealed') {
    return null;
  }
  return <ActiveCursor />;
}

// ─── ActiveCursor (orchestrator) ──────────────────────────────────────

function ActiveCursor(): JSX.Element {
  const groupRef = useRef<Group>(null);
  const { camera, gl, scene } = useThree();

  const revealState = useWorldStore((s) => s.revealState);
  const controlsDismissed = useWorldStore((s) => s.controlsDismissed);
  /** Visual avatar mode — cursor enlarges, camera transitions to 3rd
   *  person. Deferred until the user dismisses the controls hint. */
  const isAvatar = controlsDismissed;
  /** True from the first reveal click onward. Gates the input listeners
   *  so they're only mounted while a reveal sequence is in progress. */
  const isPostClick = revealState !== 'idle';

  const gltf = useGLTF(MODEL_URL);

  // Shared state — both subcomponents read from these refs. ActiveCursor
  // owns them so they survive the !isAvatar → isAvatar transition.
  const renderedScale = useRef(POINTER_SCALE);
  const tipLocalOffset = useRef(new Vector3());
  const avatarPos = useRef(new Vector3());
  const avatarYaw = useRef(0);
  const avatarPitch = useRef(0);
  const keys = useRef({ w: false, a: false, s: false, d: false });
  const touchWalkVelocity = useRef(0);
  const initialPanStart = useRef<number | null>(null);
  const renderedCursorPos = useRef(new Vector3());
  const pointerCaptured = useRef(false);
  const capturedPointer = useRef({ x: 0, y: 0 });
  const cursorFrozen = useRef(false);
  const frozenCursorPos = useRef(new Vector3());
  const frozenCursorQuat = useRef(new Quaternion());
  const swingingEnteredAt = useRef(-1);
  /** Cursor target quaternion captured at press-start (camera
   *  orientation at the moment of press × forward-tilt). */
  const pressAnchorQuat = useMemo(() => new Quaternion(), []);
  /** Constant forward-tilt quaternion in cursor-local frame. Composed
   *  onto the captured camera quaternion to get the lean orientation. */
  const leanTiltQuat = useMemo(
    () => new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), LEAN_TILT_RAD),
    [],
  );

  // ─── Mesh setup: outline shells + tipLocalOffset measurement ─────
  useEffect(() => {
    // Collect target meshes first — adding outline children inside
    // the traverse callback would cause traverse to visit the new
    // children too (and potentially loop or double-add).
    const targetMeshes: Mesh[] = [];
    gltf.scene.traverse((obj) => {
      const mesh = obj as Mesh;
      if (mesh.isMesh) {
        targetMeshes.push(mesh);
      }
    });

    /** Outline meshes added in this effect, tracked so we can
     *  remove them on cleanup (HMR / unmount). Without this, a hot
     *  reload would stack outlines on top of outlines. */
    const outlineMeshes: Mesh[] = [];

    targetMeshes.forEach((mesh) => {
      mesh.material = new MeshStandardMaterial({
        color: new Color(BODY_COLOR_HEX),
        emissive: new Color(EMISSIVE_HEX),
        emissiveIntensity: EMISSIVE_INTENSITY,
        metalness: 0.4,
        roughness: 0.35,
        // Always draw above haze (and any other 3D geometry) — the
        // cursor is a foreground UI affordance, not part of the scene.
        depthTest: false,
        transparent: true,
      });
      mesh.renderOrder = 999;

      // Outline shell — see OUTLINE_* constants for the rationale.
      const outlineGeom = mesh.geometry.clone();
      outlineGeom.computeBoundingBox();
      const outlineCenter = new Vector3();
      const outlineSize = new Vector3();
      outlineGeom.boundingBox?.getCenter(outlineCenter);
      outlineGeom.boundingBox?.getSize(outlineSize);
      outlineGeom.center();
      const outlineMesh = new Mesh(
        outlineGeom,
        new MeshBasicMaterial({
          color: new Color(OUTLINE_COLOR_HEX),
          side: BackSide,
          depthTest: false,
          transparent: true,
        }),
      );
      outlineMesh.position
        .copy(outlineCenter)
        .add(
          new Vector3(
            outlineSize.x * OUTLINE_SHIFT_X_FRACTION,
            outlineSize.y * OUTLINE_SHIFT_Y_FRACTION,
            0,
          ),
        );
      outlineMesh.scale.setScalar(OUTLINE_SCALE);
      outlineMesh.renderOrder = 998;
      mesh.add(outlineMesh);
      outlineMeshes.push(outlineMesh);
    });

    // Measure where the cursor's visible tip is relative to the model
    // pivot. For OS-arrow-cursor models the tip is at the upper-left
    // of the bbox (min X, max Y). Stored in the model's local frame,
    // pre-scale — at press time AvatarCursor rotates by pressAnchorQuat
    // and multiplies by AVATAR_SCALE. Done AFTER outline meshes are
    // added so they don't bias the bbox.
    gltf.scene.updateMatrixWorld(true);
    const bbox = new Box3();
    targetMeshes.forEach((mesh) => {
      mesh.geometry.computeBoundingBox();
      if (mesh.geometry.boundingBox) {
        const meshBbox = mesh.geometry.boundingBox.clone();
        meshBbox.applyMatrix4(mesh.matrixWorld);
        bbox.union(meshBbox);
      }
    });
    tipLocalOffset.current.set(bbox.min.x, bbox.max.y, (bbox.min.z + bbox.max.z) / 2);

    return () => {
      outlineMeshes.forEach((m) => {
        m.parent?.remove(m);
        // Dispose the cloned geometry + the dedicated material so
        // the GPU buffers don't leak across HMR cycles.
        m.geometry.dispose();
        if (m.material instanceof MeshBasicMaterial) {
          m.material.dispose();
        }
      });
    };
  }, [gltf.scene]);

  // ─── Keyboard listener (WASD → keys + waka loop) ────────────────
  useEffect(() => {
    const anyKeyHeld = (): boolean =>
      keys.current.w || keys.current.a || keys.current.s || keys.current.d;

    const onDown = (e: KeyboardEvent): void => {
      const k = e.key.toLowerCase();
      const wasMoving = anyKeyHeld();
      if (k === 'w') {
        keys.current.w = true;
      } else if (k === 'a') {
        keys.current.a = true;
      } else if (k === 's') {
        keys.current.s = true;
      } else if (k === 'd') {
        keys.current.d = true;
      }
      const isMoving = anyKeyHeld();
      if (!wasMoving && isMoving) {
        void sfx.play('cursorMove');
      }
    };
    const onUp = (e: KeyboardEvent): void => {
      const k = e.key.toLowerCase();
      if (k === 'w') {
        keys.current.w = false;
      } else if (k === 'a') {
        keys.current.a = false;
      } else if (k === 's') {
        keys.current.s = false;
      } else if (k === 'd') {
        keys.current.d = false;
      }
      if (!anyKeyHeld()) {
        sfx.stop('cursorMove', 80);
      }
    };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
    };
  }, []);

  /** World-space target the cursor leans toward while a press is
   *  active. Read each frame from the store; a non-null value pulls
   *  the cursor away from its follow-rig position toward the
   *  interactable's surface. */
  const pressedTargetPoint = useWorldStore((s) => s.pressedTargetPoint);

  // Capture the composed lean quaternion the moment a press starts.
  useEffect(() => {
    if (!pressedTargetPoint) {
      return;
    }
    pressAnchorQuat.copy(camera.quaternion).multiply(leanTiltQuat);
  }, [pressedTargetPoint, camera, leanTiltQuat, pressAnchorQuat]);

  // ─── Pointer-lock + touch listeners (mouselook + tap/swipe/pinch) ──
  // Mounted whenever a reveal sequence is in progress (`isPostClick`).
  // Drives the same shared refs that PointerCursor / AvatarCursor read.
  useEffect(() => {
    if (!isPostClick) {
      return;
    }
    const canvas = gl.domElement;

    const onMove = (e: MouseEvent): void => {
      if (document.pointerLockElement !== canvas) {
        return;
      }
      // Lock yaw/pitch while the BulletTimeDirector owns the camera.
      // Once the reveal sequence has handed control back ('impact'
      // onward), let mouselook resume.
      const rs = useWorldStore.getState().revealState;
      if (rs !== 'impact' && rs !== 'revealed') {
        return;
      }
      avatarYaw.current -= e.movementX * MOUSE_SENSITIVITY;
      const next = avatarPitch.current - e.movementY * MOUSE_SENSITIVITY;
      avatarPitch.current = Math.max(-Math.PI / 3, Math.min(Math.PI / 3, next));
    };
    const onClick = (): void => {
      // Skip pointer-lock acquisition while the menu is open — the
      // user is interacting with the menu, and re-grabbing the
      // cursor here would yank it back into the 3D world mid-click.
      if (useWorldStore.getState().menuOpen) {
        return;
      }
      if (document.pointerLockElement !== canvas) {
        // Synchronous in click handler — user gesture is valid here.
        void canvas.requestPointerLock?.();
      }
    };

    // Touch state — see comments below for tap-vs-drag classification,
    // press-on-interactable, and pinch-throttle bookkeeping.
    const TOUCH_TAP_DIST_THRESHOLD = 10;
    const TOUCH_TAP_TIME_THRESHOLD_MS = 250;
    const TOUCH_LOOK_SENSITIVITY = MOUSE_SENSITIVITY * 1.6;
    /** Pinch distance delta (px) that maps to full forward / backward
     *  throttle. ±150 fits on most phone screens; smaller values get
     *  jittery, larger values feel sluggish. */
    const PINCH_FULL_THROTTLE_DELTA = 150;

    let touchStartX = 0;
    let touchStartY = 0;
    let touchLastX = 0;
    let touchLastY = 0;
    let touchStartTime = 0;
    let touchIsDrag = false;
    let touchSingleActive = false;
    let pressInteractActive = false;
    let pinchActive = false;
    let pinchStartDist = 0;

    const fingerDistance = (e: TouchEvent): number => {
      const a = e.touches[0];
      const b = e.touches[1];
      if (!a || !b) {
        return 0;
      }
      return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    };

    const touchRaycaster = new Raycaster();
    const touchNDC = new Vector2();

    const interactableUnderTouch = (
      clientX: number,
      clientY: number,
    ): { id: string; point: Vector3 } | null => {
      touchNDC.set((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
      touchRaycaster.setFromCamera(touchNDC, camera);
      const hits = touchRaycaster.intersectObjects(scene.children, true);
      for (const hit of hits) {
        const data = hit.object.userData;
        if (!data.interactable) {
          continue;
        }
        const range = (data.interactableRange as number | undefined) ?? 60;
        if (hit.distance > range) {
          break;
        }
        const id = data.interactableId as string | undefined;
        if (!id) {
          continue;
        }
        return { id, point: hit.point };
      }
      return null;
    };

    const onTouchStart = (e: TouchEvent): void => {
      sfx.unlock();
      setTouchInProgress(true);

      if (e.touches.length === 2) {
        pinchActive = true;
        pinchStartDist = fingerDistance(e);
        touchSingleActive = false;
        if (pressInteractActive) {
          pressInteractActive = false;
          useWorldStore.getState().endInteractPress();
        }
        touchIsDrag = false;
        touchWalkVelocity.current = 0;
        return;
      }
      if (e.touches.length === 1) {
        const t = e.touches[0]!;
        touchStartX = t.clientX;
        touchStartY = t.clientY;
        touchStartTime = performance.now();

        const touchHit = interactableUnderTouch(t.clientX, t.clientY);
        if (touchHit) {
          pressInteractActive = true;
          touchSingleActive = false;
          useWorldStore
            .getState()
            .beginInteractPress(touchHit.id, [
              touchHit.point.x,
              touchHit.point.y,
              touchHit.point.z,
            ]);
          void sfx.play('mouseDown');
          return;
        }

        touchLastX = t.clientX;
        touchLastY = t.clientY;
        touchIsDrag = false;
        touchSingleActive = true;
      }
    };

    const onTouchMove = (e: TouchEvent): void => {
      if (pinchActive && e.touches.length >= 2) {
        const currentDist = fingerDistance(e);
        if (currentDist <= 0) {
          e.preventDefault();
          return;
        }
        const delta = currentDist - pinchStartDist;
        const v = Math.max(-1, Math.min(1, delta / PINCH_FULL_THROTTLE_DELTA));
        touchWalkVelocity.current = v;
        e.preventDefault();
        return;
      }

      if (pressInteractActive) {
        e.preventDefault();
        return;
      }

      if (!touchSingleActive) {
        return;
      }
      const t = e.touches[0];
      if (!t) {
        return;
      }
      if (!touchIsDrag) {
        const totalDx = t.clientX - touchStartX;
        const totalDy = t.clientY - touchStartY;
        if (Math.hypot(totalDx, totalDy) > TOUCH_TAP_DIST_THRESHOLD) {
          touchIsDrag = true;
        }
      }
      if (!touchIsDrag) {
        return;
      }
      const rs = useWorldStore.getState().revealState;
      if (rs !== 'impact' && rs !== 'revealed') {
        touchLastX = t.clientX;
        touchLastY = t.clientY;
        return;
      }
      const dx = t.clientX - touchLastX;
      const dy = t.clientY - touchLastY;
      avatarYaw.current -= dx * TOUCH_LOOK_SENSITIVITY;
      const next = avatarPitch.current - dy * TOUCH_LOOK_SENSITIVITY;
      avatarPitch.current = Math.max(-Math.PI / 3, Math.min(Math.PI / 3, next));
      touchLastX = t.clientX;
      touchLastY = t.clientY;
      e.preventDefault();
    };

    const onTouchEnd = (e: TouchEvent): void => {
      if (pinchActive && e.touches.length < 2) {
        pinchActive = false;
        touchWalkVelocity.current = 0;
      }
      if (e.touches.length === 0) {
        setTouchInProgress(false);
      }

      if (pressInteractActive && e.touches.length === 0) {
        pressInteractActive = false;
        const state = useWorldStore.getState();
        const pressedId = state.pressedInteractableId;
        if (pressedId) {
          const handler = interactableHandlers.get(pressedId);
          handler?.();
          void sfx.play('interactClick');
          void sfx.play('interactImpact');
        }
        void sfx.play('mouseUp');
        state.endInteractPress();
        setTouchInProgress(false);
        return;
      }

      if (!touchSingleActive || e.touches.length !== 0) {
        return;
      }
      touchSingleActive = false;
      if (touchIsDrag) {
        return;
      }
      const elapsed = performance.now() - touchStartTime;
      if (elapsed > TOUCH_TAP_TIME_THRESHOLD_MS) {
        return;
      }
      void sfx.play('mouseDown');
      void sfx.play('mouseUp');
      setTouchInProgress(false);
    };

    document.addEventListener('mousemove', onMove);
    canvas.addEventListener('click', onClick);
    canvas.addEventListener('touchstart', onTouchStart, { passive: true });
    canvas.addEventListener('touchmove', onTouchMove, { passive: false });
    canvas.addEventListener('touchend', onTouchEnd);
    return () => {
      document.removeEventListener('mousemove', onMove);
      canvas.removeEventListener('click', onClick);
      canvas.removeEventListener('touchstart', onTouchStart);
      canvas.removeEventListener('touchmove', onTouchMove);
      canvas.removeEventListener('touchend', onTouchEnd);
      if (document.pointerLockElement === canvas) {
        document.exitPointerLock?.();
      }
    };
  }, [isPostClick, gl.domElement, camera, scene]);

  const refs: CursorRefs = useMemo(
    () => ({
      groupRef,
      renderedScale,
      tipLocalOffset,
      avatarPos,
      avatarYaw,
      avatarPitch,
      keys,
      touchWalkVelocity,
      initialPanStart,
      renderedCursorPos,
      pressAnchorQuat,
      pointerCaptured,
      capturedPointer,
      cursorFrozen,
      frozenCursorPos,
      frozenCursorQuat,
      swingingEnteredAt,
    }),
    [pressAnchorQuat],
  );

  return (
    <group ref={groupRef}>
      <primitive object={gltf.scene} />
      {isAvatar ? <AvatarCursor refs={refs} /> : <PointerCursor refs={refs} />}
    </group>
  );
}

// ─── PointerCursor ────────────────────────────────────────────────────
// Pointer-mode useFrame: idle / world-frozen / camera-anchored
// projection. Returns null — purely behavioural.

interface ModeProps {
  refs: CursorRefs;
}

function PointerCursor({ refs }: ModeProps): null {
  const { pointer, camera } = useThree();
  const revealState = useWorldStore((s) => s.revealState);
  // Reusable buffers — three Vector3 + one PerspectiveCamera used for
  // the projection + lookAt math. Owned here (not in the shared refs)
  // because they're write-only scratch space.
  const tmpCamFwd = useRef(new Vector3());
  const tmpCamRight = useRef(new Vector3());
  const tmpCamUp = useRef(new Vector3());

  useFrame((state, delta) => {
    const group = refs.groupRef.current;
    if (!group) {
      return;
    }
    const k = 1 - Math.exp(-SCALE_LERP_RATE * delta);

    // Reset the initial-pan capture so a future avatar-mode mount
    // cleanly captures fresh starting state.
    refs.initialPanStart.current = null;

    // Track when 'swinging' began so we can split it into pre and
    // mid+post for the two cursor sub-behaviours below.
    if (revealState === 'swinging' && refs.swingingEnteredAt.current < 0) {
      refs.swingingEnteredAt.current = state.clock.elapsedTime;
    }
    if (revealState !== 'swinging') {
      refs.swingingEnteredAt.current = -1;
    }

    const swingTime =
      revealState === 'swinging' && refs.swingingEnteredAt.current >= 0
        ? state.clock.elapsedTime - refs.swingingEnteredAt.current
        : 0;

    // Phase classification:
    //   "world-frozen": chase phase (armed + early swinging) — cursor
    //                   stays at the click-time WORLD position. Camera
    //                   moves around it; user sees cursor parallax.
    //   "camera-anchored": mid + post (formation + slam) — cursor
    //                       projects through the live camera using a
    //                       captured pointer NDC; reads as still on
    //                       screen even while camera pans.
    const inWorldFrozen =
      revealState === 'armed' || (revealState === 'swinging' && swingTime < SWING_PRE);
    const inCameraAnchored = revealState === 'swinging' && swingTime >= SWING_PRE;

    // Hide the cursor entirely during the chase/world-frozen phase.
    group.visible = !inWorldFrozen;

    if (inWorldFrozen) {
      if (!refs.cursorFrozen.current) {
        refs.frozenCursorPos.current.copy(group.position);
        refs.frozenCursorQuat.current.copy(group.quaternion);
        refs.capturedPointer.current.x = pointer.x;
        refs.capturedPointer.current.y = pointer.y;
        refs.pointerCaptured.current = true;
        refs.cursorFrozen.current = true;
      }
      group.position.copy(refs.frozenCursorPos.current);
      group.quaternion.copy(refs.frozenCursorQuat.current);
    } else {
      // Camera-anchored OR live-pointer mode. Project NDC to a world-
      // space cursor pose using the camera's basis vectors directly
      // (no matrix inversion → no per-frame floating-point drift).
      const cam = camera as PerspectiveCamera;
      const fovY = (cam.fov * Math.PI) / 180;
      tmpCamFwd.current.set(0, 0, -1).applyQuaternion(camera.quaternion).normalize();
      tmpCamRight.current.set(1, 0, 0).applyQuaternion(camera.quaternion).normalize();
      tmpCamUp.current.set(0, 1, 0).applyQuaternion(camera.quaternion).normalize();

      let px: number;
      let py: number;
      if (inCameraAnchored) {
        if (!refs.pointerCaptured.current) {
          refs.capturedPointer.current.x = pointer.x;
          refs.capturedPointer.current.y = pointer.y;
          refs.pointerCaptured.current = true;
        }
        px = refs.capturedPointer.current.x;
        py = refs.capturedPointer.current.y;
      } else {
        // Idle / impact / revealed — live-pointer mode.
        refs.cursorFrozen.current = false;
        refs.pointerCaptured.current = false;
        px = pointer.x;
        py = pointer.y;
      }

      projectNDCToWorld(
        group.position,
        camera.position,
        tmpCamFwd.current,
        tmpCamRight.current,
        tmpCamUp.current,
        fovY,
        cam.aspect,
        POINTER_DEPTH,
        px,
        py,
      );
      group.quaternion.copy(camera.quaternion);
    }

    refs.renderedScale.current += (POINTER_SCALE - refs.renderedScale.current) * k;
    group.scale.setScalar(refs.renderedScale.current);
  }, 2);

  return null;
}

// ─── AvatarCursor ─────────────────────────────────────────────────────
// 3rd-person follow rig + lean-on-press. Returns null — purely behavioural.

function AvatarCursor({ refs }: ModeProps): null {
  const { camera } = useThree();
  const dimensions = useWorldStore((s) => s.environment.dimensions);
  const pressedTargetPoint = useWorldStore((s) => s.pressedTargetPoint);

  // Scratch buffers owned by AvatarCursor — write-only per frame.
  const tmpVec = useRef(new Vector3());
  const tmpEuler = useRef(new Euler());
  const tmpCamTarget = useRef(new Vector3());
  const tmpCubeHalf = useRef(new Vector3());
  const tmpHelper = useMemo(() => new PerspectiveCamera(), []);
  const targetCamQuat = useMemo(() => new Quaternion(), []);
  const avatarTargetQuat = useMemo(() => new Quaternion(), []);

  // Initial-pan captured-state buffers. ActiveCursor's initialPanStart
  // ref signals the capture moment; these refs hold the captured values.
  const initialCamPos = useRef(new Vector3());
  const initialCamQuat = useRef(new Quaternion());
  const initialCursorPos = useRef(new Vector3());
  const initialCursorQuat = useRef(new Quaternion());
  const initialScale = useRef(POINTER_SCALE);

  // Lean-target scratch buffers.
  const leanTarget = useRef(new Vector3());
  const tipWorldBuffer = useRef(new Vector3());

  // Anchor avatar position + reset yaw/pitch the moment AvatarCursor mounts.
  //
  // If a snapshot exists in the store (e.g. the user just flipped out
  // of Simple Experience and back), restore from it so they pick up
  // exactly where they were. Otherwise initialise from the camera —
  // that's the original first-mount path, where the avatar inherits
  // wherever the cube-formation camera was looking from.
  //
  // On unmount we capture the latest transform back into the store so
  // the next mount can restore. `setAvatarSnapshot` is read with
  // `getState()` rather than as a hook subscription — we only want to
  // write, not re-render when the snapshot changes.
  useEffect(() => {
    const snapshot = useWorldStore.getState().avatarSnapshot;
    if (snapshot) {
      refs.avatarPos.current.set(...snapshot.position);
      refs.avatarYaw.current = snapshot.yaw;
      refs.avatarPitch.current = snapshot.pitch;
    } else {
      refs.avatarPos.current.set(
        camera.position.x,
        camera.position.y - FOLLOW_OFFSET.y,
        camera.position.z - FOLLOW_OFFSET.z,
      );
      refs.avatarYaw.current = 0;
      refs.avatarPitch.current = 0;
    }
    sfx.unlock();
    void sfx.play('uiClick');

    return () => {
      const pos = refs.avatarPos.current;
      useWorldStore.getState().setAvatarSnapshot({
        position: [pos.x, pos.y, pos.z],
        yaw: refs.avatarYaw.current,
        pitch: refs.avatarPitch.current,
      });
    };
  }, [camera, refs]);

  useFrame((state, delta) => {
    const group = refs.groupRef.current;
    if (!group) {
      return;
    }
    const k = 1 - Math.exp(-SCALE_LERP_RATE * delta);

    // Capture pre-pan state on the first frame of avatar mode.
    if (refs.initialPanStart.current === null) {
      refs.initialPanStart.current = state.clock.elapsedTime;
      initialCamPos.current.copy(camera.position);
      initialCamQuat.current.copy(camera.quaternion);
      initialScale.current = refs.renderedScale.current;
      initialCursorPos.current.copy(group.position);
      initialCursorQuat.current.copy(group.quaternion);
    }

    const yaw = refs.avatarYaw.current;
    const walk = computeWalkVector(
      refs.keys.current,
      yaw,
      refs.avatarPitch.current,
      refs.touchWalkVelocity.current,
    );
    if (walk.len > 0) {
      // Cap normalisation at 1 so partial throttles (touch pinch at
      // half spread) move at half speed instead of being scaled back
      // to full. Diagonals (W+D = √2) still get anti-fast-diagonal
      // normalisation.
      const cappedLen = Math.max(1, walk.len);
      const step = (WALK_SPEED * delta) / cappedLen;
      refs.avatarPos.current.x += walk.mx * step;
      refs.avatarPos.current.y += walk.my * step;
      refs.avatarPos.current.z += walk.mz * step;
    }

    tmpCubeHalf.current.set(dimensions[0] * 0.5, dimensions[1] * 0.5, dimensions[2] * 0.5);
    clampToBoxInterior(refs.avatarPos.current, tmpCubeHalf.current, AVATAR_WALL_MARGIN);

    // Wall-proximity ambient — louder near walls, silent at centre.
    {
      const proximity = computeWallProximity(
        refs.avatarPos.current,
        tmpCubeHalf.current,
        WALL_AMBIENT_FADE_DISTANCE,
      );
      if (proximity > 0 && !sfx.isLoopActive('wallAmbient')) {
        void sfx.play('wallAmbient', { volumeMultiplier: 0 });
      }
      sfx.setLoopVolume('wallAmbient', WALL_AMBIENT_BASE_VOLUME * proximity);
    }

    // Avatar's target rotation (Y-axis yaw).
    setYawQuat(avatarTargetQuat, yaw);

    // Default 3rd-person offset rotated into world-space.
    tmpEuler.current.set(refs.avatarPitch.current, yaw, 0, 'YXZ');
    tmpVec.current.copy(FOLLOW_OFFSET).applyEuler(tmpEuler.current);

    // Camera collision: shorten the offset so the camera stays inside
    // the cube.
    const ratio = computeCameraCollisionRatio(
      refs.avatarPos.current,
      tmpVec.current,
      tmpCubeHalf.current,
      CAMERA_WALL_MARGIN,
    );
    tmpCamTarget.current.copy(refs.avatarPos.current).addScaledVector(tmpVec.current, ratio);

    // Compute target camera rotation via a temp PerspectiveCamera so
    // we can slerp toward it during the initial pan (snapping with
    // .lookAt would skip the pan entirely on the first frame).
    tmpHelper.position.copy(tmpCamTarget.current);
    tmpHelper.lookAt(
      refs.avatarPos.current.x,
      refs.avatarPos.current.y + LOOK_AHEAD_HEIGHT,
      refs.avatarPos.current.z,
    );
    targetCamQuat.copy(tmpHelper.quaternion);

    const elapsed = state.clock.elapsedTime - refs.initialPanStart.current;
    const panProgress = computeInitialPanProgress(elapsed, INITIAL_PAN_DURATION);

    if (panProgress < 1) {
      // Initial pan: smoothstep-eased over INITIAL_PAN_DURATION.
      // Drives camera position+rotation, cursor position+rotation,
      // and cursor scale together.
      camera.position.lerpVectors(initialCamPos.current, tmpCamTarget.current, panProgress);
      camera.quaternion.slerpQuaternions(initialCamQuat.current, targetCamQuat, panProgress);
      group.position.lerpVectors(initialCursorPos.current, refs.avatarPos.current, panProgress);
      group.quaternion.slerpQuaternions(initialCursorQuat.current, avatarTargetQuat, panProgress);
      refs.renderedScale.current =
        initialScale.current + (AVATAR_SCALE - initialScale.current) * panProgress;
      // Seed renderedCursorPos so the steady-state lerp picks up
      // exactly where the initial pan left off.
      refs.renderedCursorPos.current.copy(group.position);
    } else {
      // Steady-state. Camera lerps; cursor position + orientation lerp
      // toward press-aware targets so the lean motion accumulates
      // frame-to-frame instead of resetting from the follow rig.
      const camK = 1 - Math.exp(-CAMERA_LERP_RATE * delta);
      camera.position.lerp(tmpCamTarget.current, camK);
      camera.quaternion.copy(targetCamQuat);

      let cursorPosTarget: Vector3;
      let cursorQuatTarget: Quaternion;
      if (pressedTargetPoint) {
        // Position the group such that the visible tip (measured once
        // from the model's bbox) lands exactly on the raycast hit.
        // Press-time captured `pressAnchorQuat` (not live camera)
        // keeps the cursor world-anchored on the target while the
        // user rotates the camera during a held press.
        tmpVec.current.set(pressedTargetPoint[0], pressedTargetPoint[1], pressedTargetPoint[2]);
        computeLeanTarget(
          leanTarget.current,
          tmpVec.current,
          refs.tipLocalOffset.current,
          refs.pressAnchorQuat,
          AVATAR_SCALE,
          tipWorldBuffer.current,
        );
        cursorPosTarget = leanTarget.current;
        cursorQuatTarget = refs.pressAnchorQuat;
      } else {
        cursorPosTarget = refs.avatarPos.current;
        cursorQuatTarget = avatarTargetQuat;
      }

      const leanK = 1 - Math.exp(-LEAN_LERP_RATE * delta);
      refs.renderedCursorPos.current.lerp(cursorPosTarget, leanK);
      group.position.copy(refs.renderedCursorPos.current);
      group.quaternion.slerp(cursorQuatTarget, leanK);

      refs.renderedScale.current += (AVATAR_SCALE - refs.renderedScale.current) * k;
    }
    group.scale.setScalar(refs.renderedScale.current);
  }, 2);

  return null;
}
