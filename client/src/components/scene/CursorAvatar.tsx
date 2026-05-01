/**
 * CursorAvatar — single 3D mesh that plays two roles.
 *
 *   POINTER MODE  (revealState === 'idle')
 *     Sits at a fixed near-camera depth, projected from the OS pointer's
 *     NDC. Faces the camera. Acts visually as the user's cursor.
 *
 *   AVATAR MODE   (revealState !== 'idle', i.e. after first click)
 *     Becomes a world-space avatar driven by WASD + mouselook. The camera
 *     anchors to it in a classic 3rd-person follow rig: a fixed offset in
 *     the avatar's local frame, rotating with yaw/pitch.
 *
 * The OS cursor stays hidden whenever this component is mounted.
 */
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import {
  Color,
  Euler,
  Group,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Quaternion,
  Vector3,
} from 'three';
import { useWorldStore } from '@/store';
import { sfx } from '../audio/SfxManager';

const MODEL_URL = '/models/3d_icon_cursor.glb';

/** Distance in front of the camera at which the pointer-mode cursor sits.
 *  Kept small so the cursor reads as foreground, not stuck on the wall. */
const POINTER_DEPTH = 3;
const POINTER_SCALE = 0.001;
const AVATAR_SCALE = 0.03;
const SCALE_LERP_RATE = 5.0;

/** Reveal-phase boundary inside the 'swinging' state. Cursor stays
 *  world-frozen for `t < SWING_PRE` (the chase), then anchors to camera
 *  for the mid + post phases. Must match Sword.tsx's SWING_PRE. */
const SWING_PRE = 3.5;

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
/** Distance the cursor pulls back from the actual surface point so
 *  the visible tip lands at the surface instead of clipping through.
 *  Tuned for the cursor model + AVATAR_SCALE = 0.03 — the model's
 *  visible tip sits roughly this far from its group origin in world
 *  units once scaled. Adjust by eye if the cursor changes. */
const CURSOR_TIP_OFFSET = 1.8;
/** Extra forward pitch applied to the cursor's orientation while
 *  pressed — beyond camera-alignment — so the cursor visibly *leans
 *  into* the target rather than just pointing rigidly at it. */
const LEAN_TILT_RAD = -0.28;
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

/** Magenta is the complement of the scene's cyan accent (`#00ffcc`),
 *  so the cursor stays visually distinct even when its mesh is
 *  touching cyan-glowing interactables — the eye separates them as
 *  different objects rather than reading one merged glow. Bumped
 *  intensity vs the previous cyan because magenta also reads slightly
 *  darker at equal luminance, so we lift it to compensate. */
const EMISSIVE_HEX = '#ff00cc';
const EMISSIVE_INTENSITY = 1.6;
const BODY_COLOR_HEX = '#1a0a18';

useGLTF.preload(MODEL_URL);

export function CursorAvatar(): JSX.Element | null {
  const active = useWorldStore((s) => s.cursorAvatarActive);

  useEffect(() => {
    if (!active) {
      return;
    }
    const previous = document.body.style.cursor;
    document.body.style.cursor = 'none';
    return () => {
      document.body.style.cursor = previous;
    };
  }, [active]);

  if (!active) {
    return null;
  }
  return <ActiveCursor />;
}

function ActiveCursor(): JSX.Element {
  const groupRef = useRef<Group>(null);
  const { pointer, camera, gl } = useThree();

  const revealState = useWorldStore((s) => s.revealState);
  const controlsDismissed = useWorldStore((s) => s.controlsDismissed);
  /** Visual avatar mode — cursor enlarges, camera transitions to 3rd
   *  person. Deferred until the user dismisses the controls hint. */
  const isAvatar = controlsDismissed;
  /** True from the first reveal click onward. Gates the mouselook listener
   *  so it's only mounted while a reveal sequence is in progress. */
  const isPostClick = revealState !== 'idle';
  const dimensions = useWorldStore((s) => s.environment.dimensions);

  const gltf = useGLTF(MODEL_URL);

  const avatarPos = useRef(new Vector3());
  const avatarYaw = useRef(0);
  const avatarPitch = useRef(0);
  const keys = useRef({ w: false, a: false, s: false, d: false });
  const renderedScale = useRef(POINTER_SCALE);

  const tmpVec = useRef(new Vector3());
  const tmpEuler = useRef(new Euler());
  const tmpCamTarget = useRef(new Vector3());
  /** Camera-basis buffers — we reproject the cursor each frame from
   *  camera.quaternion + camera.position directly, instead of going through
   *  unproject(). Skipping the matrix inversion removes a small floating-
   *  point jitter that leaked through after BulletTimeDirector's lookAt. */
  const tmpCamFwd = useRef(new Vector3());
  const tmpCamRight = useRef(new Vector3());
  const tmpCamUp = useRef(new Vector3());
  /** Captured normalised pointer at the moment the reveal animation
   *  begins. Used to project cursor at the click-time screen position
   *  while the bullet-time camera pans, so the cursor reads as still
   *  from the camera's viewpoint regardless of camera motion. */
  const pointerCaptured = useRef(false);
  const capturedPointer = useRef({ x: 0, y: 0 });
  /** Frozen cursor world pose during the chase phase — cursor stays at
   *  the click world position, independent of camera motion. */
  const cursorFrozen = useRef(false);
  const frozenCursorPos = useRef(new Vector3());
  const frozenCursorQuat = useRef(new Quaternion());
  /** Tracks when the 'swinging' state began so we can compute the swing
   *  time and distinguish pre vs mid+post within it. */
  const swingingEnteredAt = useRef(-1);

  // Initial-pan state: captured the moment isAvatar flips on. Drives a
  // single eased time curve for camera position, rotation, cursor
  // position, cursor rotation, and cursor scale so they all complete
  // together.
  const initialPanStart = useRef<number | null>(null);
  const initialCamPos = useRef(new Vector3());
  const initialCamQuat = useRef(new Quaternion());
  const initialCursorPos = useRef(new Vector3());
  const initialCursorQuat = useRef(new Quaternion());
  const initialScale = useRef(POINTER_SCALE);
  // PerspectiveCamera (not Object3D) so its lookAt uses the camera
  // convention (local -Z toward target). Plain Object3D's lookAt orients
  // +Z toward target, which would slerp the camera 180° around.
  const tmpHelper = useMemo(() => new PerspectiveCamera(), []);
  const targetCamQuat = useMemo(() => new Quaternion(), []);
  const avatarTargetQuat = useMemo(() => new Quaternion(), []);

  useEffect(() => {
    gltf.scene.traverse((obj) => {
      const mesh = obj as Mesh;
      if (!mesh.isMesh) {
        return;
      }
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
    });
  }, [gltf.scene]);

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
      // Start the cursor-movement waka loop on the *aggregate*
      // false→true transition (was idle, now moving). OS key-repeat
      // fires this handler many times per second; SfxManager's loop
      // guard ensures we don't try to restart an already-running loop.
      if (!wasMoving && anyKeyHeld()) {
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
      // Stop the waka loop when the last movement key is released.
      // Short fade so the cut isn't a hard click.
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
  const leanForward = useRef(new Vector3());
  const leanTarget = useRef(new Vector3());
  /** Working buffer for the press-state target quaternion (camera
   *  orientation × forward-tilt). */
  const leanRotQuat = useMemo(() => new Quaternion(), []);
  /** Constant forward-tilt quaternion in cursor-local frame. Composed
   *  onto camera.quaternion to get the press-state cursor orientation. */
  const leanTiltQuat = useMemo(
    () => new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), LEAN_TILT_RAD),
    [],
  );
  /** The cursor's *rendered* world position, persisted across frames.
   *  The follow-rig and lean logic compute a *target* each frame; this
   *  ref lerps toward that target so motion accumulates instead of
   *  resetting from the follow point every frame (which is what made
   *  the lean feel jittery + "stuck at 40% of the way"). */
  const renderedCursorPos = useRef(new Vector3());

  // Desktop: mouselook via pointer lock. Mobile: swipe-to-look via
  // touch events + synthesized mousedown/mouseup on tap. Both paths
  // mount in the same effect so they share lifecycle (gated on
  // `isPostClick` and the same dep array).
  //
  // Pointer-lock note: itself requested by ControlsHint's dismiss-click
  // handler (synchronously inside the user-gesture window) — attempting
  // it from this effect throws "requires a user gesture" because React
  // effects run after commit, past the activation token's lifetime. The
  // canvas click listener here re-engages lock if Esc dropped it.
  useEffect(() => {
    if (!isPostClick) {
      return;
    }
    const canvas = gl.domElement;

    const onMove = (e: MouseEvent): void => {
      if (document.pointerLockElement !== canvas) {
        return;
      }
      // Lock yaw/pitch while the BulletTimeDirector owns the camera. Once
      // the reveal sequence has handed control back ('impact' onward —
      // camera is settled at its final pose and the swords have hit the
      // wall), let mouselook resume so the cursor wakes up sooner.
      const rs = useWorldStore.getState().revealState;
      if (rs !== 'impact' && rs !== 'revealed') {
        return;
      }
      avatarYaw.current -= e.movementX * MOUSE_SENSITIVITY;
      const next = avatarPitch.current - e.movementY * MOUSE_SENSITIVITY;
      avatarPitch.current = Math.max(-Math.PI / 3, Math.min(Math.PI / 3, next));
    };
    const onClick = (): void => {
      if (document.pointerLockElement !== canvas) {
        // Synchronous in click handler — user gesture is valid here.
        void canvas.requestPointerLock?.();
      }
    };

    // Touch state for tap-vs-drag classification. A touchstart begins
    // a candidate gesture; if the user moves the finger more than
    // TOUCH_TAP_DIST_THRESHOLD pixels we commit to "drag" (swipe-to-
    // look). Otherwise touchend within TOUCH_TAP_TIME_THRESHOLD ms
    // dispatches a synthetic mousedown+mouseup on window, reusing the
    // global click pipeline (interaction + audio).
    const TOUCH_TAP_DIST_THRESHOLD = 10;
    const TOUCH_TAP_TIME_THRESHOLD_MS = 250;
    const TOUCH_LOOK_SENSITIVITY = MOUSE_SENSITIVITY * 1.6; // touch deltas read smaller than mouse

    let touchStartX = 0;
    let touchStartY = 0;
    let touchLastX = 0;
    let touchLastY = 0;
    let touchStartTime = 0;
    let touchIsDrag = false;

    const onTouchStart = (e: TouchEvent): void => {
      const t = e.touches[0];
      if (!t) {
        return;
      }
      touchStartX = touchLastX = t.clientX;
      touchStartY = touchLastY = t.clientY;
      touchStartTime = performance.now();
      touchIsDrag = false;
      // First touch is the canonical user gesture on mobile — unlock
      // the AudioContext now so subsequent taps can produce sound.
      sfx.unlock();
    };
    const onTouchMove = (e: TouchEvent): void => {
      const t = e.touches[0];
      if (!t) {
        return;
      }
      // Promote to "drag" once we've moved past the tap threshold, and
      // stay in drag mode until touchend.
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
      // Same gating as mouselook — only apply look while the reveal
      // has handed control back to the user.
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
      // preventDefault to stop the browser's pull-to-refresh / scroll
      // overlapping the look gesture.
      e.preventDefault();
    };
    const onTouchEnd = (): void => {
      if (touchIsDrag) {
        return; // drag already handled; no synthetic click
      }
      const elapsed = performance.now() - touchStartTime;
      if (elapsed > TOUCH_TAP_TIME_THRESHOLD_MS) {
        return;
      }
      // Tap: synthesise a mousedown + mouseup on window so the
      // existing InteractionController + global mouseDown/Up cues
      // fire identically to a desktop click. clientX/Y are the touch's
      // start point (not strictly needed since the crosshair always
      // raycasts through screen centre, but keeps the events looking
      // like a real click).
      const init = { bubbles: true, clientX: touchStartX, clientY: touchStartY } as const;
      window.dispatchEvent(new MouseEvent('mousedown', init));
      window.dispatchEvent(new MouseEvent('mouseup', init));
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
  }, [isPostClick, gl.domElement, camera]);

  // Anchor avatar position + reset yaw/pitch the moment the user dismisses
  // ControlsHint (controlsDismissed → isAvatar). Discards any mouse delta
  // accumulated during impact/revealed so the avatar starts looking
  // straight ahead instead of at a weird drifted angle.
  useEffect(() => {
    if (!isAvatar) {
      return;
    }
    avatarPos.current.set(
      camera.position.x,
      camera.position.y - FOLLOW_OFFSET.y,
      camera.position.z - FOLLOW_OFFSET.z,
    );
    avatarYaw.current = 0;
    avatarPitch.current = 0;
    // Audio: this transition is also a user-gesture-derived event
    // (the user dismissed the controls hint by clicking). Re-call
    // unlock() in case the cube reveal click hasn't happened yet
    // (dev hotkey path). Idempotent.
    sfx.unlock();
    // Mark the cursor → avatar transition with the UI click (the same
    // cue that previously fired on first reveal click).
    void sfx.play('uiClick');
  }, [isAvatar, camera]);

  useFrame((state, delta) => {
    if (!groupRef.current) {
      return;
    }
    const k = 1 - Math.exp(-SCALE_LERP_RATE * delta);

    if (!isAvatar) {
      // Reset the initial-pan capture so the next isAvatar=true cleanly
      // captures fresh starting state.
      initialPanStart.current = null;

      // Track when 'swinging' began so we can split it into pre and
      // mid+post for the two cursor behaviours.
      if (revealState === 'swinging' && swingingEnteredAt.current < 0) {
        swingingEnteredAt.current = state.clock.elapsedTime;
      }
      if (revealState !== 'swinging') {
        swingingEnteredAt.current = -1;
      }

      const swingTime =
        revealState === 'swinging' && swingingEnteredAt.current >= 0
          ? state.clock.elapsedTime - swingingEnteredAt.current
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

      // Hide the cursor entirely during the chase/world-frozen phase. The
      // camera's lookAt rotation would otherwise sweep the cursor through
      // frame centre before parallax pushes it off screen — even at small
      // scale, it reads as "the cursor got in the way for a beat".
      groupRef.current.visible = !inWorldFrozen;

      if (inWorldFrozen) {
        // Capture world pose AND pointer NDC on entry. Capturing the NDC
        // here (rather than waiting for camera-anchored to start) is what
        // pins the cursor to the click position: pointer-lock isn't yet
        // engaged during the hidden phase, so without this the user can
        // drift the OS pointer and the cursor would re-appear at the
        // mouse's current location instead of where they clicked.
        if (!cursorFrozen.current) {
          frozenCursorPos.current.copy(groupRef.current.position);
          frozenCursorQuat.current.copy(groupRef.current.quaternion);
          capturedPointer.current.x = pointer.x;
          capturedPointer.current.y = pointer.y;
          pointerCaptured.current = true;
          cursorFrozen.current = true;
        }
        groupRef.current.position.copy(frozenCursorPos.current);
        groupRef.current.quaternion.copy(frozenCursorQuat.current);
      } else {
        // Camera-anchored OR live-pointer mode: project an NDC pointer to
        // a world-space cursor pose using the camera's basis vectors (no
        // matrix inversion → no per-frame floating-point drift). Cursor
        // sits POINTER_DEPTH in front of the camera, with NDC offsets
        // along the screen-plane right/up axes.
        const cam = camera as PerspectiveCamera;
        const fovY = (cam.fov * Math.PI) / 180;
        const halfH = POINTER_DEPTH * Math.tan(fovY / 2);
        const halfW = halfH * cam.aspect;
        tmpCamFwd.current.set(0, 0, -1).applyQuaternion(camera.quaternion).normalize();
        tmpCamRight.current.set(1, 0, 0).applyQuaternion(camera.quaternion).normalize();
        tmpCamUp.current.set(0, 1, 0).applyQuaternion(camera.quaternion).normalize();

        let px: number;
        let py: number;
        if (inCameraAnchored) {
          // NDC was captured on entry to world-frozen above. If we somehow
          // skipped that phase (e.g. entered swinging without armed), grab
          // it now as a fallback.
          if (!pointerCaptured.current) {
            capturedPointer.current.x = pointer.x;
            capturedPointer.current.y = pointer.y;
            pointerCaptured.current = true;
          }
          px = capturedPointer.current.x;
          py = capturedPointer.current.y;
        } else {
          // Idle / impact / revealed — live-pointer mode.
          cursorFrozen.current = false;
          pointerCaptured.current = false;
          px = pointer.x;
          py = pointer.y;
        }

        groupRef.current.position
          .copy(camera.position)
          .addScaledVector(tmpCamFwd.current, POINTER_DEPTH)
          .addScaledVector(tmpCamRight.current, px * halfW)
          .addScaledVector(tmpCamUp.current, py * halfH);
        groupRef.current.quaternion.copy(camera.quaternion);
      }

      renderedScale.current += (POINTER_SCALE - renderedScale.current) * k;
      groupRef.current.scale.setScalar(renderedScale.current);
      return;
    }

    // Capture pre-pan state on the first frame of avatar mode. Includes
    // the cursor's CURRENT in-world position/orientation so the lerp
    // can ease it into the avatar slot from wherever it was on screen,
    // instead of snapping to the avatar position and growing in place.
    if (initialPanStart.current === null) {
      initialPanStart.current = state.clock.elapsedTime;
      initialCamPos.current.copy(camera.position);
      initialCamQuat.current.copy(camera.quaternion);
      initialScale.current = renderedScale.current;
      initialCursorPos.current.copy(groupRef.current.position);
      initialCursorQuat.current.copy(groupRef.current.quaternion);
    }

    const yaw = avatarYaw.current;
    const pitch = avatarPitch.current;
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    const cp = Math.cos(pitch);
    const sp = Math.sin(pitch);

    // Forward = (0, 0, -1) rotated by Euler(pitch, yaw, 0, 'YXZ') — same
    // direction the camera is looking. W/S move along this so the avatar
    // flies up/down when the camera is pitched.
    // Strafe (A/D) drops pitch so left/right stays horizontal (FPS feel).
    let mx = 0;
    let my = 0;
    let mz = 0;
    if (keys.current.w) {
      mx += -sy * cp;
      my += sp;
      mz += -cy * cp;
    }
    if (keys.current.s) {
      mx -= -sy * cp;
      my -= sp;
      mz -= -cy * cp;
    }
    if (keys.current.d) {
      mx += cy;
      mz += -sy;
    }
    if (keys.current.a) {
      mx -= cy;
      mz -= -sy;
    }

    const len = Math.hypot(mx, my, mz);
    if (len > 0) {
      const step = (WALK_SPEED * delta) / len;
      avatarPos.current.x += mx * step;
      avatarPos.current.y += my * step;
      avatarPos.current.z += mz * step;
    }

    // Avatar collision: clamp to cube interior so the body never pokes
    // through a wall.
    const aMaxX = dimensions[0] * 0.5 - AVATAR_WALL_MARGIN;
    const aMaxY = dimensions[1] * 0.5 - AVATAR_WALL_MARGIN;
    const aMaxZ = dimensions[2] * 0.5 - AVATAR_WALL_MARGIN;
    if (avatarPos.current.x < -aMaxX) {
      avatarPos.current.x = -aMaxX;
    } else if (avatarPos.current.x > aMaxX) {
      avatarPos.current.x = aMaxX;
    }
    if (avatarPos.current.y < -aMaxY) {
      avatarPos.current.y = -aMaxY;
    } else if (avatarPos.current.y > aMaxY) {
      avatarPos.current.y = aMaxY;
    }
    // Proximity ambient: the cube hums louder as the avatar drifts
    // toward an edge, silent at the centre. Compute distance to the
    // *nearest* wall (any axis), map to a 0..1 factor over the fade
    // band, and drive the loop's gain. Loop is started lazily the
    // first frame the avatar enters the band.
    {
      const cx = dimensions[0] * 0.5 - Math.abs(avatarPos.current.x);
      const cy = dimensions[1] * 0.5 - Math.abs(avatarPos.current.y);
      const cz = dimensions[2] * 0.5 - Math.abs(avatarPos.current.z);
      const distNearest = Math.min(cx, cy, cz);
      const proximity = Math.max(0, 1 - distNearest / WALL_AMBIENT_FADE_DISTANCE);
      if (proximity > 0 && !sfx.isLoopActive('wallAmbient')) {
        // Start silent; the next setLoopVolume below ramps it in.
        void sfx.play('wallAmbient', { volumeMultiplier: 0 });
      }
      sfx.setLoopVolume('wallAmbient', WALL_AMBIENT_BASE_VOLUME * proximity);
    }

    if (avatarPos.current.z < -aMaxZ) {
      avatarPos.current.z = -aMaxZ;
    } else if (avatarPos.current.z > aMaxZ) {
      avatarPos.current.z = aMaxZ;
    }

    // Avatar's target rotation as a quaternion (Y-axis yaw rotation).
    // Y-axis quaternion: (0, sin(θ/2), 0, cos(θ/2)).
    const halfYaw = yaw * 0.5;
    avatarTargetQuat.set(0, Math.sin(halfYaw), 0, Math.cos(halfYaw));

    // Default 3rd-person offset, rotated into world-space.
    tmpEuler.current.set(avatarPitch.current, yaw, 0, 'YXZ');
    tmpVec.current.copy(FOLLOW_OFFSET).applyEuler(tmpEuler.current);

    // Camera collision: shorten the offset so the camera stays inside
    // the cube. Solve for the smallest positive t along the offset
    // direction at which (avatarPos + dir·t) hits the wall the offset
    // points toward, on each axis.
    const offsetLen = FOLLOW_OFFSET.length();
    const cMaxX = dimensions[0] * 0.5 - CAMERA_WALL_MARGIN;
    const cMaxY = dimensions[1] * 0.5 - CAMERA_WALL_MARGIN;
    const cMaxZ = dimensions[2] * 0.5 - CAMERA_WALL_MARGIN;
    let maxT = offsetLen;
    const dx = tmpVec.current.x / offsetLen;
    const dy = tmpVec.current.y / offsetLen;
    const dz = tmpVec.current.z / offsetLen;
    if (Math.abs(dx) > 1e-6) {
      const t = ((dx > 0 ? cMaxX : -cMaxX) - avatarPos.current.x) / dx;
      if (t > 0 && t < maxT) {
        maxT = t;
      }
    }
    if (Math.abs(dy) > 1e-6) {
      const t = ((dy > 0 ? cMaxY : -cMaxY) - avatarPos.current.y) / dy;
      if (t > 0 && t < maxT) {
        maxT = t;
      }
    }
    if (Math.abs(dz) > 1e-6) {
      const t = ((dz > 0 ? cMaxZ : -cMaxZ) - avatarPos.current.z) / dz;
      if (t > 0 && t < maxT) {
        maxT = t;
      }
    }

    // Target camera position with the (possibly shortened) offset.
    const ratio = Math.max(0, maxT) / offsetLen;
    tmpCamTarget.current.copy(avatarPos.current).addScaledVector(tmpVec.current, ratio);

    // Compute target camera rotation via a temp Object3D so we can
    // slerp toward it during the initial pan (snapping with .lookAt
    // would skip the pan entirely on the first frame).
    tmpHelper.position.copy(tmpCamTarget.current);
    tmpHelper.lookAt(
      avatarPos.current.x,
      avatarPos.current.y + LOOK_AHEAD_HEIGHT,
      avatarPos.current.z,
    );
    targetCamQuat.copy(tmpHelper.quaternion);

    const elapsed = state.clock.elapsedTime - initialPanStart.current;
    if (elapsed < INITIAL_PAN_DURATION) {
      // Initial pan: smoothstep-eased over INITIAL_PAN_DURATION. Drives
      // camera position+rotation, cursor position+rotation, and cursor
      // scale together so the cursor visually slides+grows from its
      // last screen position into the 3rd-person avatar slot.
      const tNorm = elapsed / INITIAL_PAN_DURATION;
      const eased = tNorm * tNorm * (3 - 2 * tNorm);
      camera.position.lerpVectors(initialCamPos.current, tmpCamTarget.current, eased);
      camera.quaternion.slerpQuaternions(initialCamQuat.current, targetCamQuat, eased);
      groupRef.current.position.lerpVectors(initialCursorPos.current, avatarPos.current, eased);
      groupRef.current.quaternion.slerpQuaternions(
        initialCursorQuat.current,
        avatarTargetQuat,
        eased,
      );
      renderedScale.current = initialScale.current + (AVATAR_SCALE - initialScale.current) * eased;
      // Seed renderedCursorPos so the steady-state lerp picks up
      // exactly where the initial pan left off (instead of starting
      // at origin and snapping in on the first steady frame).
      renderedCursorPos.current.copy(groupRef.current.position);
    } else {
      // Steady-state. Camera lerps as before; cursor position +
      // orientation lerp toward press-aware targets so the lean
      // motion accumulates frame-to-frame instead of resetting from
      // the follow rig each frame (the previous bug — caused the
      // jitter the user reported).
      const camK = 1 - Math.exp(-CAMERA_LERP_RATE * delta);
      camera.position.lerp(tmpCamTarget.current, camK);
      camera.quaternion.copy(targetCamQuat);

      let cursorPosTarget: Vector3;
      let cursorQuatTarget: Quaternion;
      if (pressedTargetPoint) {
        // Position: hit point pulled back along camera-forward by
        // CURSOR_TIP_OFFSET so the visible tip ends up at the surface,
        // not clipping through it.
        leanForward.current.set(0, 0, -1).applyQuaternion(camera.quaternion);
        leanTarget.current
          .set(pressedTargetPoint[0], pressedTargetPoint[1], pressedTargetPoint[2])
          .addScaledVector(leanForward.current, -CURSOR_TIP_OFFSET);
        cursorPosTarget = leanTarget.current;
        // Orientation: camera-aligned (so the cursor's tip points
        // along the crosshair direction toward the hit) plus a small
        // forward tilt (so it visibly leans into the object).
        leanRotQuat.copy(camera.quaternion).multiply(leanTiltQuat);
        cursorQuatTarget = leanRotQuat;
      } else {
        cursorPosTarget = avatarPos.current;
        cursorQuatTarget = avatarTargetQuat;
      }

      const leanK = 1 - Math.exp(-LEAN_LERP_RATE * delta);
      renderedCursorPos.current.lerp(cursorPosTarget, leanK);
      groupRef.current.position.copy(renderedCursorPos.current);
      groupRef.current.quaternion.slerp(cursorQuatTarget, leanK);

      renderedScale.current += (AVATAR_SCALE - renderedScale.current) * k;
    }
    groupRef.current.scale.setScalar(renderedScale.current);
  }, 2);

  return (
    <group ref={groupRef}>
      <primitive object={gltf.scene} />
    </group>
  );
}
