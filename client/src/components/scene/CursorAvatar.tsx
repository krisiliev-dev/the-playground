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
import { getInteractableUserData, interactableHandlers, setTouchInProgress } from './Interactable';
import { cursorWorldPosition, cursorWorldQuaternion } from './cursorWorldPosition';
import { SWING_PRE } from './reveal/constants';
import {
  clampToBoxInterior,
  computeCameraCollisionRatio,
  computeInitialPanProgress,
  computeLeanTarget,
  computeWalkLeanTarget,
  computeWalkVector,
  computeWallProximity,
  type PortalHole,
  projectNDCToWorld,
} from './cursorAvatarMath';
import { FLAT_ROUTES, MAIN_CUBE_BOB } from '@/content/routes';
import {
  avatarWorldEntryFor,
  clampRouteForLocalPosition,
  routeForAvatar,
} from '@/content/routeForPosition';
import { floatOffset } from './floatBob';
import {
  DEFAULT_PORTAL_SIZE,
  FORMATION_QUADRANT_OFFSET,
  type PortalEndpoint,
  wallBasis,
} from '@/content/portals';
import type { ClickHit } from '@/store';
import type { Entity } from '@/multiplayer/types';
import {
  bobbedEndpoint,
  findCrossedPortal,
  planPortalLeap,
  teleportPose,
} from './portal/portalMath';
import { getScene } from '@/scenes/sceneRegistry';

const MODEL_URL = '/models/3d_icon_cursor.glb';

import { CASCADE_OVERLAY_LAYER, CURSOR_LAYER } from './sceneLayers';
import { RENDER_ORDER_CURSOR_BODY, RENDER_ORDER_CURSOR_OUTLINE } from './renderOrder';

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
/** Click-to-portal leap speed, in world units per second. ~5× walk
 *  so a click visibly pulls the avatar through the portal in a few
 *  frames regardless of where they were standing. */
const LEAP_SPEED = 320;
/** Distance at which a leap is considered "arrived" if the avatar
 *  hasn't crossed a portal plane on the way in. Cleared at this
 *  threshold so the avatar doesn't oscillate around the target. */
const LEAP_ARRIVAL_EPS = 1.0;
/** How far past the portal's plane the click-leap target sits, in
 *  world units. Large enough that the avatar's leap segment crosses
 *  the plane (so `findCrossedPortal` fires); small enough that if the
 *  cross somehow misses, the leap stops just past the portal rather
 *  than launching into the back wall. */
const PORTAL_LEAP_OVERSHOOT = 8;
/** Forward-lean angle (radians) applied to the cursor at FULL forward
 *  walking velocity. The lean scales linearly with `fwdInput` (W − S
 *  + touch throttle, clamped to ±1). Walking forward → cursor tilts
 *  head-first; walking backward → tilts back. Sideways/strafe input
 *  contributes no lean (would be roll, not pitch). */
const WALK_LEAN_MAX_RAD = (20 * Math.PI) / 180; // 20°
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
 *  halo at the cursor's silhouette. The outline shares the cursor's
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
/** Scale multiplier applied to the in-scene cursor copy (the
 *  `CASCADE_OVERLAY_LAYER` mesh rendered inside the portal cascade's
 *  through-view passes). The main-view cursor is sized for the
 *  3rd-person follow rig (camera ~3 world units from the avatar); at
 *  cascade vCam distances of 300+ world units the same size projects
 *  to a sub-pixel speck. 5× keeps the in-scene copy recognisable at
 *  typical cascade depths without overwhelming the level-0 view, and
 *  has no effect on the main render (CASCADE_OVERLAY_LAYER is excluded
 *  from mainCam.layers). */
const INSCENE_CURSOR_SCALE = 5;

/**
 * Factory: cursor body material (MeshStandardMaterial) used for both
 * the main-view always-on-top cursor and the in-scene depth-tested
 * copy. The two only differ in `depthTest`; everything else (color,
 * emissive, metalness, roughness, depthWrite, transparency) is
 * shared. Extracting the factory removes ~12 lines of duplication
 * and means a future change to e.g. emissiveIntensity flows to both
 * cursors at once.
 */
function createCursorBodyMaterial(opts: { depthTest: boolean }): MeshStandardMaterial {
  return new MeshStandardMaterial({
    color: new Color(BODY_COLOR_HEX),
    emissive: new Color(EMISSIVE_HEX),
    emissiveIntensity: EMISSIVE_INTENSITY,
    metalness: 0.4,
    roughness: 0.35,
    depthTest: opts.depthTest,
    // depthWrite must be off too: the cursor renders inside the
    // portal cascade's through-view passes; any depth value it
    // leaves in the framebuffer would block the next recursion
    // level's surface-plane stencil mark via depth-LESS rejection.
    depthWrite: false,
    transparent: true,
  });
}

/** Factory: cursor outline shell material (MeshBasicMaterial,
 *  BackSide). Same depthTest split as the body factory. */
function createCursorOutlineMaterial(opts: { depthTest: boolean }): MeshBasicMaterial {
  return new MeshBasicMaterial({
    color: new Color(OUTLINE_COLOR_HEX),
    side: BackSide,
    depthTest: opts.depthTest,
    depthWrite: false,
    transparent: true,
  });
}

useGLTF.preload(MODEL_URL);

const FORMATION_ROUTE = '/';
/** Map from each section room's path to the id of its exit portal —
 *  same ids the factory in `content/portals.ts` builds. Avoids a
 *  string-match scan over the endpoint array each frame for the
 *  hot clamp path. */
const ROOM_EXIT_ID_BY_PATH: Record<string, string> = {
  '/about': 'room-about-exit',
  '/projects': 'room-projects-exit',
  '/writing': 'room-writing-exit',
};

/**
 * Compute the array of `PortalHole`s to pass into
 * `clampToBoxInterior` based on which route the avatar is in:
 *
 *   - On the main cube ('/'), one FOUR-quadrant hole per
 *     player who's currently revealing — built from each
 *     player's broadcast click hit. The avatar can walk
 *     through any actor's cluster.
 *   - In a section room, one single-square hole per actor's
 *     room-exit portal in the current room (matched by id
 *     suffix `::<room-exit-id>`). Avatars can return through
 *     any actor's exit.
 *
 * Per-call allocation is OK here: hole count is bounded by
 * concurrent revealers, typically <10. Each hole is a small
 * object with 4 fresh Vector3s — well under any frame budget.
 */
function portalHolesForRoute(
  routePath: string,
  endpoints: ReadonlyArray<PortalEndpoint>,
  entities: ReadonlyMap<string, Entity>,
  localActorId: string,
  localClickHit: ClickHit | null,
  bobY: number,
): PortalHole[] {
  const holes: PortalHole[] = [];

  if (routePath === FORMATION_ROUTE) {
    // Local player's formation hole (only when we have a click
    // hit — i.e., the local player has revealed at least once).
    if (localClickHit) {
      holes.push(buildFormationHole(localClickHit, bobY));
    }
    // Each remote player who's actively revealing also gets a
    // hole — the local avatar should be able to walk through
    // anyone's cluster.
    for (const [id, ent] of entities) {
      if (ent.kind !== 'player' || id === localActorId) {
        continue;
      }
      const remoteHit = readRemoteClickHit(ent);
      if (remoteHit) {
        holes.push(buildFormationHole(remoteHit, bobY));
      }
    }
    return holes;
  }

  const exitSuffix = ROOM_EXIT_ID_BY_PATH[routePath];
  if (!exitSuffix) {
    return holes;
  }
  // Find every endpoint whose id matches the suffix — covers
  // both legacy un-namespaced ids (`'room-writing-exit'`) and
  // the per-actor namespaced ids (`'<actorId>::room-writing-exit'`).
  // Each becomes a single-square hole the avatar can walk through.
  for (const ep of endpoints) {
    if (ep.id === exitSuffix || ep.id.endsWith(`::${exitSuffix}`)) {
      holes.push(buildExitHole(ep, bobY));
    }
  }
  return holes;
}

function buildFormationHole(clickHit: ClickHit, bobY: number): PortalHole {
  const right = new Vector3();
  const up = new Vector3();
  wallBasis(clickHit.normal, right, up);
  const normal = new Vector3(...clickHit.normal).normalize();
  const center = new Vector3(...clickHit.point);
  center.y += bobY;
  return {
    center,
    normal,
    radius: DEFAULT_PORTAL_SIZE / 2,
    right,
    up,
    quadrantOffset: FORMATION_QUADRANT_OFFSET,
  };
}

function buildExitHole(exit: PortalEndpoint, bobY: number): PortalHole {
  const center = new Vector3(...exit.position);
  center.y += bobY;
  const normal = new Vector3(0, 0, 1).applyQuaternion({
    x: exit.quaternion[0],
    y: exit.quaternion[1],
    z: exit.quaternion[2],
    w: exit.quaternion[3],
  } as Quaternion);
  return {
    center,
    normal,
    radius: exit.size.width / 2,
  };
}

/** Read a remote player's broadcast click hit from their entity
 *  props, or null if they're not currently revealing. Tolerant
 *  of missing fields. */
function readRemoteClickHit(ent: Entity): ClickHit | null {
  const p = ent.props as Record<string, unknown>;
  const state = p.reveal_state;
  if (typeof state !== 'string' || state === 'idle') {
    return null;
  }
  const point = p.click_hit_point;
  const normal = p.click_hit_normal;
  if (!isVec3Tuple(point) || !isVec3Tuple(normal)) {
    return null;
  }
  return { point, normal };
}

function isVec3Tuple(v: unknown): v is [number, number, number] {
  return (
    Array.isArray(v) &&
    v.length === 3 &&
    typeof v[0] === 'number' &&
    typeof v[1] === 'number' &&
    typeof v[2] === 'number'
  );
}

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
  const documentMode = useWorldStore((s) => s.documentMode);
  const isTouch = useIsTouchPrimary();

  // Hide the OS cursor while the avatar is active — except when the
  // pause menu is open. With the menu up the user expects a normal
  // cursor for hovering buttons; the 3D cursor would just be in the
  // way (and was the source of the "cursor invisible until hover"
  // bug, since the browser only reveals the OS cursor on its own
  // when there's an interaction surface to point at).
  useEffect(() => {
    // Restore the OS cursor whenever the user is interacting with
    // chrome rather than the 3D world: the pause menu, or document
    // mode (the latter reachable via the Simple Experience portal
    // *or* the menu, so gating only on menuOpen leaves doc-mode
    // users with a hidden cursor over the document).
    if (!active || menuOpen || documentMode) {
      return;
    }
    const previous = document.body.style.cursor;
    document.body.style.cursor = 'none';
    return () => {
      document.body.style.cursor = previous;
    };
  }, [active, menuOpen, documentMode]);

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
  // CursorAvatar mounts at the *root* R3F context (so `useThree`'s
  // `pointer` reflects live mouse coords — createPortal sub-stores
  // freeze pointer at (0, 0)). World, however, renders inside the
  // 'cube' scene via createPortal, and SceneHost swaps the camera's
  // active scene to it. Without re-parenting, the avatar's group
  // lives in the root scene and the camera never sees it. Attach
  // the group into the cube scene on mount so the camera renders
  // it alongside the cube contents.
  useEffect(() => {
    const group = groupRef.current;
    if (!group || typeof group.updateWorldMatrix !== 'function') {
      return;
    }
    getScene('cube').attach(group);
  }, []);
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
      // Main-view cursor body: always-on-top via depthTest=false.
      mesh.material = createCursorBodyMaterial({ depthTest: false });
      // Cursor body must draw AFTER the (BackSide) outline shell so
      // the body covers the outline's interior and only the
      // silhouette halo remains. Both stay above haze — see
      // `renderOrder.ts` for the band layout.
      mesh.renderOrder = RENDER_ORDER_CURSOR_BODY;
      // Cursor mesh on its own layer (enabled by SceneHost on the
      // main camera). The layer + `depthTest: false` is what keeps
      // it visually on top in the player's view.
      mesh.layers.disable(0);
      mesh.layers.enable(CURSOR_LAYER);

      // Outline shell — see OUTLINE_* constants for the rationale.
      const outlineGeom = mesh.geometry.clone();
      outlineGeom.computeBoundingBox();
      const outlineCenter = new Vector3();
      const outlineSize = new Vector3();
      outlineGeom.boundingBox?.getCenter(outlineCenter);
      outlineGeom.boundingBox?.getSize(outlineSize);
      outlineGeom.center();
      const outlineMesh = new Mesh(outlineGeom, createCursorOutlineMaterial({ depthTest: false }));
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
      outlineMesh.renderOrder = RENDER_ORDER_CURSOR_OUTLINE;
      outlineMesh.layers.disable(0);
      outlineMesh.layers.enable(CURSOR_LAYER);
      mesh.add(outlineMesh);
      outlineMeshes.push(outlineMesh);

      // === In-scene cursor copy ===========================================
      // A second cursor on `CASCADE_OVERLAY_LAYER` for the portal cascade's
      // through-view renders. Same geometry and same world position as the
      // main-view cursor, but with `depthTest: true` so closer scene
      // geometry (portal rims, cube walls) properly occludes it instead of
      // the cursor drawing over them. Without this dual-mesh setup, the
      // cursor's `depthTest: false` (correct for main-view always-on-top)
      // makes it overlay the pink rim's particles inside the cascade's
      // through-view, hiding the rim wherever the cursor projects to the
      // same screen pixels — visible as "pink portal not rendering" in
      // certain camera-cursor configurations.
      //
      // Both copies share the parent group, so they track the same world
      // position. Layer mask determines which copy renders in which pass:
      // - Phase D (cascade through-views): includes CASCADE_OVERLAY_LAYER.
      // - Phase 3 (main-view top render): includes CURSOR_LAYER.
      //
      // Scaled `INSCENE_CURSOR_SCALE` × the main cursor so the in-scene
      // copy stays visible at typical cascade vCam distances. The main
      // cursor is sized for a ~3-unit camera distance (3rd-person follow
      // rig); at cascade vCam distances of 300+ world units, the same
      // size projects to ~2 pixels. Scaling up here keeps the cursor
      // recognisable through the portal without affecting main view
      // (CASCADE_OVERLAY_LAYER is excluded from mainCam.layers). The
      // outline shell uses the same multiplier so it stays in proportion.
      // In-scene depth-tested copy for the cascade overlay layer.
      const inSceneBody = new Mesh(mesh.geometry, createCursorBodyMaterial({ depthTest: true }));
      inSceneBody.scale.setScalar(INSCENE_CURSOR_SCALE);
      inSceneBody.renderOrder = RENDER_ORDER_CURSOR_BODY;
      inSceneBody.layers.disable(0);
      inSceneBody.layers.enable(CASCADE_OVERLAY_LAYER);
      // Frustum-culling defaults to the geometry's bounding sphere
      // computed at load time. For deep cascade levels, the vCam sits
      // thousands of units from the avatar — combined with the per-
      // frame `group.position` updates and the in-scene body's parent
      // chain (group → gltf.scene → mesh → inSceneBody), the bounding
      // sphere can fail Three.js's frustum test in ways that culling
      // a one-pixel mesh wouldn't normally matter for, but here we
      // want it to render reliably across all cascade depths.
      inSceneBody.frustumCulled = false;
      const inSceneOutline = new Mesh(
        outlineGeom,
        createCursorOutlineMaterial({ depthTest: true }),
      );
      inSceneOutline.position.copy(outlineMesh.position);
      inSceneOutline.scale.copy(outlineMesh.scale);
      inSceneOutline.renderOrder = RENDER_ORDER_CURSOR_OUTLINE;
      inSceneOutline.layers.disable(0);
      inSceneOutline.layers.enable(CASCADE_OVERLAY_LAYER);
      inSceneOutline.frustumCulled = false;
      inSceneBody.add(inSceneOutline);
      mesh.add(inSceneBody);
      outlineMeshes.push(inSceneBody, inSceneOutline);
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
      // Suppress movement input when the pause menu is open or
      // we're in the Simple Experience document mode — both put
      // the user "in chrome" and movement should freeze. Without
      // this gate, holding W during a menu open continues walking
      // the avatar even though mouselook is paused (pointer-lock
      // released by PauseMenu).
      const state = useWorldStore.getState();
      if (state.menuOpen || state.documentMode) {
        return;
      }
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

  // Clear any held WASD keys + stop the move loop when chrome
  // takes over (pause menu opens, document mode entered). Without
  // this, a key held *during* the menu-open transition stays
  // logically pressed because the keyup listener is still bound
  // but the user might switch focus to the menu and never
  // release. Result: avatar walks indefinitely while paused.
  const movementChromeFlags = useWorldStore((s) => (s.menuOpen ? 1 : 0) | (s.documentMode ? 2 : 0));
  useEffect(() => {
    if (movementChromeFlags !== 0) {
      keys.current.w = false;
      keys.current.a = false;
      keys.current.s = false;
      keys.current.d = false;
      sfx.stop('cursorMove', 80);
    }
  }, [movementChromeFlags]);

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
        const data = getInteractableUserData(hit.object);
        if (!data) {
          continue;
        }
        if (hit.distance > data.interactableRange) {
          break;
        }
        return { id: data.interactableId, point: hit.point };
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
  /** When true, the next frame's camera + cursor position lerps run
   *  with rate = 1 (effectively `copy` instead of `lerp`) so a
   *  teleport reads as an instant cut, not a long visible slide.
   *  Reserved for the next portal design — currently unused but kept
   *  so the camera-snap plumbing downstream stays exercised. */
  const teleportSnapRef = useRef(false);
  /** Scratch for the per-frame clamp call. Reused so the per-route
   *  clamp lookup doesn't allocate. */
  const clampCenter = useRef(new Vector3());
  const clampHalf = useRef(new Vector3());
  /** Avatar position at the START of each frame (before walking is
   *  applied). Used by the portal-crossing detector to test prev →
   *  cur traversal against each portal's plane. */
  const prevAvatarPos = useRef(new Vector3());
  /** Smoothly interpolated walk-lean angle in radians. Lerps toward
   *  `fwdInput * WALK_LEAN_MAX_RAD` each frame, so the cursor visibly
   *  tilts in/out of the lean instead of snapping. */
  const currentWalkLean = useRef(0);

  // Lean-target scratch buffers.
  const leanTarget = useRef(new Vector3());
  const tipWorldBuffer = useRef(new Vector3());

  // Anchor avatar position + reset yaw/pitch the moment AvatarCursor
  // mounts. The Canvas stays mounted across Simple Experience toggles
  // (App pauses the render loop + visibility:hidden), so this effect
  // runs *once* per session — transient ref state is preserved
  // across mode flips for free.
  //
  // Spawn rule: stand `SPAWN_WALL_INSET` units from the clicked wall,
  // facing the swords. clickHit.normal points INTO the cube, so
  // `clickHit.point + normal * inset` lands the avatar inside the
  // cube near the impacted wall. Yaw orients the avatar so its
  // forward direction is `-normal` (toward the wall) — derived from
  // `atan2(normal.x, normal.z)` since yaw=0 means "looking down -Z".
  useEffect(() => {
    const clickHit = useWorldStore.getState().clickHit;
    if (clickHit) {
      const SPAWN_WALL_INSET = 60;
      refs.avatarPos.current.set(
        clickHit.point[0] + clickHit.normal[0] * SPAWN_WALL_INSET,
        clickHit.point[1] + clickHit.normal[1] * SPAWN_WALL_INSET,
        clickHit.point[2] + clickHit.normal[2] * SPAWN_WALL_INSET,
      );
      refs.avatarYaw.current = Math.atan2(clickHit.normal[0], clickHit.normal[2]);
    } else {
      // Fallback for the unusual case of mounting without a clickHit
      // (e.g. tests, or future code paths that bypass the reveal):
      // start where the camera was, FOLLOW_OFFSET behind it.
      refs.avatarPos.current.set(
        camera.position.x,
        camera.position.y - FOLLOW_OFFSET.y,
        camera.position.z - FOLLOW_OFFSET.z,
      );
      refs.avatarYaw.current = 0;
    }
    refs.avatarPitch.current = 0;
    sfx.unlock();
    void sfx.play('uiClick');
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

    // Snapshot pre-walk position for portal-crossing detection. The
    // detector tests whether the (prev → cur) segment crosses any
    // portal's plane this frame; if so, we teleport the avatar to
    // the paired portal's emergence pose before the clamp/route
    // resolution steps below run on the new position.
    prevAvatarPos.current.copy(refs.avatarPos.current);

    // `let` (not const) because portal teleport below may rewrite
    // `refs.avatarYaw.current`, and the avatar's target orientation +
    // camera follow-offset (computed further down this frame) need to
    // pick up the post-teleport yaw on the same frame — otherwise the
    // first post-teleport frame uses the pre-teleport yaw and the
    // camera/avatar visibly rotate the difference on the next tick.
    let yaw = refs.avatarYaw.current;
    const walk = computeWalkVector(
      refs.keys.current,
      yaw,
      refs.avatarPitch.current,
      refs.touchWalkVelocity.current,
    );
    // Click-to-portal: PortalMesh queued a portal id; resolve it
    // here, where the live avatar position + cube bob are available
    // for the active-side gate. `planPortalLeap` returns null for an
    // invalid click (e.g. clicking the back of a single-sided portal),
    // in which case we just clear the request — the click is
    // silently consumed, the avatar doesn't move.
    {
      const pendingClickId = useWorldStore.getState().pendingPortalClick;
      if (pendingClickId) {
        const bobYNow = floatOffset(state.clock.elapsedTime, MAIN_CUBE_BOB);
        const endpoints = useWorldStore.getState().portalEndpoints;
        const sourceEp = endpoints.find((ep) => ep.id === pendingClickId);
        if (sourceEp) {
          if (sourceEp.trigger === 'simple-experience') {
            // Trigger portals fire their action immediately on click;
            // no leap, no teleport. The avatar stays put while the
            // app flips to document mode.
            useWorldStore.getState().setDocumentMode(true);
          } else {
            const bobbedSource = bobbedEndpoint(sourceEp, bobYNow);
            const target = planPortalLeap(
              {
                x: refs.avatarPos.current.x,
                y: refs.avatarPos.current.y,
                z: refs.avatarPos.current.z,
              },
              bobbedSource,
              PORTAL_LEAP_OVERSHOOT,
            );
            if (target) {
              useWorldStore.getState().setLeapTarget(target);
            }
          }
        }
        useWorldStore.getState().setPendingPortalClick(null);
      }
    }

    // Leap mode (click-to-portal): when a leap target is set, ignore
    // walk input entirely and pull the avatar straight at the target
    // at LEAP_SPEED. The natural walk-through crossing detector below
    // catches the portal cross during the leap and runs the same
    // teleportPose pipeline a manual walk-in would. If the target is
    // reached without a cross (defensive fallback), clear the leap so
    // the avatar can resume normal movement.
    const leapTarget = useWorldStore.getState().leapTarget;
    if (leapTarget) {
      const dx = leapTarget[0] - refs.avatarPos.current.x;
      const dy = leapTarget[1] - refs.avatarPos.current.y;
      const dz = leapTarget[2] - refs.avatarPos.current.z;
      const dist = Math.hypot(dx, dy, dz);
      if (dist < LEAP_ARRIVAL_EPS) {
        useWorldStore.getState().setLeapTarget(null);
      } else {
        const step = Math.min(LEAP_SPEED * delta, dist);
        refs.avatarPos.current.x += (dx / dist) * step;
        refs.avatarPos.current.y += (dy / dist) * step;
        refs.avatarPos.current.z += (dz / dist) * step;
      }
    } else if (walk.len > 0) {
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

    // URL → avatar teleport: a deep-link / browser-back set
    // pendingAvatarTeleport in the store. Snap the avatar to the
    // matching route's bob-compensated entry point, then clear the
    // signal. Done before clamp so the new position is what gets
    // clamped + routed below.
    {
      const pendingTeleport = useWorldStore.getState().pendingAvatarTeleport;
      if (pendingTeleport) {
        const match = FLAT_ROUTES.find((fr) => fr.route.path === pendingTeleport);
        if (match) {
          const entry = avatarWorldEntryFor(
            match.route.bounds,
            match.route.entryPoint,
            state.clock.elapsedTime,
            MAIN_CUBE_BOB,
          );
          refs.avatarPos.current.set(entry[0], entry[1], entry[2]);
        }
        useWorldStore.getState().setPendingAvatarTeleport(null);
      }
    }

    // Portal crossing: if the avatar's prev → cur segment crossed a
    // portal's plane this frame (with sidedness gate), teleport to
    // the paired portal's emergence pose. Portals are authored in
    // cube-local frame; the cube bobs in Y, so we bob-compensate
    // their world Y before the geometric crossing check.
    {
      const bobY = floatOffset(state.clock.elapsedTime, MAIN_CUBE_BOB);
      const endpoints = useWorldStore.getState().portalEndpoints;
      const bobbedEndpoints = endpoints.map((ep) => bobbedEndpoint(ep, bobY));
      const crossing = findCrossedPortal(
        {
          x: prevAvatarPos.current.x,
          y: prevAvatarPos.current.y,
          z: prevAvatarPos.current.z,
        },
        {
          x: refs.avatarPos.current.x,
          y: refs.avatarPos.current.y,
          z: refs.avatarPos.current.z,
        },
        bobbedEndpoints,
      );
      if (crossing) {
        if (crossing.kind === 'trigger') {
          // Trigger portals (Simple Experience) flip an app state
          // instead of teleporting. Clear any in-flight leap so the
          // avatar doesn't keep marching past the trigger plane while
          // the app rerenders into document mode.
          if (crossing.trigger === 'simple-experience') {
            useWorldStore.getState().setDocumentMode(true);
          }
          if (useWorldStore.getState().leapTarget !== null) {
            useWorldStore.getState().setLeapTarget(null);
          }
        } else {
          // Teleport: re-call teleportPose with the avatar's actual
          // yaw (findCrossedPortal returns yaw=0 as a placeholder) so
          // the resulting orientation matches the front-to-front
          // R₁₈₀_Y identification of paired portals.
          const pose = teleportPose(
            {
              x: refs.avatarPos.current.x,
              y: refs.avatarPos.current.y,
              z: refs.avatarPos.current.z,
            },
            refs.avatarYaw.current,
            crossing.source,
            crossing.destination,
          );
          refs.avatarPos.current.set(pose.position.x, pose.position.y, pose.position.z);
          refs.avatarYaw.current = pose.yaw;
          // Refresh local `yaw` so downstream computations (camera
          // follow-offset rotation, avatarTargetQuat) use the post-
          // teleport orientation on this frame.
          yaw = pose.yaw;
          // Tell the camera-follow rig downstream to snap (lerp
          // rate=1) instead of sliding across the world. Without
          // this the camera would visibly travel from the source-
          // side follow point to the dest-side follow point over
          // multiple frames.
          teleportSnapRef.current = true;
          // The click-leap (if any) drove us into this crossing;
          // clear the leap target now so the avatar emerges at the
          // destination without continuing to chase the source-side
          // leap target.
          if (useWorldStore.getState().leapTarget !== null) {
            useWorldStore.getState().setLeapTarget(null);
          }
        }
      }
    }

    tmpCubeHalf.current.set(dimensions[0] * 0.5, dimensions[1] * 0.5, dimensions[2] * 0.5);
    // Per-route clamp: the avatar is confined to whichever route's
    // bbox they're currently inside (the deepest route whose `box`
    // declares `clamp.enabled`). Walking + teleporting both move
    // the avatar; THIS step is what keeps them from leaving the
    // current room.
    //
    // Coordinate frame: routes' bounds are in cube-local space, but
    // the avatar lives in world space and the cube bobs in Y.
    // Convert the avatar to local for the lookup, then translate
    // the chosen bbox back to world (Y + bob) for the clamp call.
    {
      const avatarWorld = refs.avatarPos.current;
      const bobY = floatOffset(state.clock.elapsedTime, MAIN_CUBE_BOB);
      const localPos: [number, number, number] = [
        avatarWorld.x,
        avatarWorld.y - bobY,
        avatarWorld.z,
      ];
      const clampRoute = clampRouteForLocalPosition(localPos, FLAT_ROUTES);
      if (clampRoute) {
        const b = clampRoute.route.bounds;
        const clampMargin = clampRoute.route.box?.clamp?.margin ?? AVATAR_WALL_MARGIN;
        // World-space center: lift by bob on Y; X/Z untouched.
        clampCenter.current.set(
          (b.min[0] + b.max[0]) / 2,
          (b.min[1] + b.max[1]) / 2 + bobY,
          (b.min[2] + b.max[2]) / 2,
        );
        clampHalf.current.set(
          (b.max[0] - b.min[0]) / 2,
          (b.max[1] - b.min[1]) / 2,
          (b.max[2] - b.min[2]) / 2,
        );
        // Carve a portal-shaped exception in the wall clamp so the
        // avatar can walk into the formation portals (main cube's
        // back wall) or the room's exit portal (room's +Z wall).
        // Without this the wall stops the avatar before they reach
        // the portal plane, and walk-through teleport never fires.
        const state = useWorldStore.getState();
        // Admin no-clip: skip the clamp entirely so the operator
        // can fly through walls. Per ADR-009; persisted in
        // localStorage, never broadcast — purely a local QoL
        // toggle for inspecting / debugging the world.
        if (!state.adminNoClip) {
          const localActorId = state.localPlayerId ?? 'local';
          const portalHoles = portalHolesForRoute(
            clampRoute.route.path,
            state.portalEndpoints,
            state.entities,
            localActorId,
            state.clickHit,
            bobY,
          );
          clampToBoxInterior(
            avatarWorld,
            clampHalf.current,
            clampMargin,
            portalHoles,
            clampCenter.current,
          );
        }
      }
    }

    // Route resolution: derive the avatar's URL from its position.
    // We pass the avatar's WORLD position + the current time;
    // routeForAvatar transforms into the cube's local frame
    // (subtracting the float bob) before doing the bbox test, so
    // the route is stable across the cube's vertical bob.
    {
      const avatarWorld = refs.avatarPos.current;
      const newRoute = routeForAvatar(
        [avatarWorld.x, avatarWorld.y, avatarWorld.z],
        state.clock.elapsedTime,
        FLAT_ROUTES,
        MAIN_CUBE_BOB,
      );
      const prevRoute = useWorldStore.getState().currentRoute;
      if (newRoute !== prevRoute) {
        useWorldStore.getState().setCurrentRoute(newRoute);
      }
    }

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

    // Avatar's target rotation (Y-axis yaw + X-axis walk-lean).
    // Forward input (W/S/touch throttle) scales the lean angle from
    // 0 to ±WALK_LEAN_MAX_RAD; the smoothed lean lerps toward the
    // target each frame so it eases in/out instead of snapping.
    {
      const targetLean = computeWalkLeanTarget(
        refs.keys.current,
        refs.touchWalkVelocity.current,
        WALK_LEAN_MAX_RAD,
      );
      const leanK = 1 - Math.exp(-LEAN_LERP_RATE * delta);
      currentWalkLean.current += (targetLean - currentWalkLean.current) * leanK;
    }
    // Euler order YXZ: yaw first (around world Y), then lean
    // (around the post-yaw local X = right axis). Positive X
    // rotation in YXZ tilts local -Z (forward) toward local -Y
    // (down) — that's the "head-first lean" direction.
    tmpEuler.current.set(currentWalkLean.current, yaw, 0, 'YXZ');
    avatarTargetQuat.setFromEuler(tmpEuler.current);

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
      // After a teleport, snap by setting the lerp rate to 1 — the
      // camera and cursor cut directly to their new follow positions
      // instead of sliding across the world.
      const snapping = teleportSnapRef.current;

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

      if (snapping) {
        // After a teleport: don't snap to "no lag" (which would cause
        // a 5-10-frame transient as the lerp builds up steady-state
        // lag), but to "steady-state lag" position. The avatar's
        // post-teleport walking velocity (in the NEW yaw direction)
        // tells us how much the camera/cursor should trail behind the
        // ideal target. Pre-applying that lag means the lerp on
        // subsequent frames maintains it instead of building it up,
        // and the rubber band that scaled with walking speed disappears.
        //
        // Math: for lerp `c[n+1] = c[n] + (target - c[n]) * k`, the
        // steady-state lag when target moves at velocity v per frame
        // is `lag = ((1-k)/k) * v`.
        const postWalk = computeWalkVector(
          refs.keys.current,
          yaw,
          refs.avatarPitch.current,
          refs.touchWalkVelocity.current,
        );
        const camK = 1 - Math.exp(-CAMERA_LERP_RATE * delta);
        const leanK = 1 - Math.exp(-LEAN_LERP_RATE * delta);
        const camLagFactor = camK > 0 ? (1 - camK) / camK : 0;
        const cursorLagFactor = leanK > 0 ? (1 - leanK) / leanK : 0;

        camera.position.copy(tmpCamTarget.current);
        refs.renderedCursorPos.current.copy(cursorPosTarget);
        if (postWalk.len > 0) {
          const cappedLen = Math.max(1, postWalk.len);
          const step = (WALK_SPEED * delta) / cappedLen;
          // Camera trails BEHIND avatar in walking direction by
          // steady-state lag, so the camera target's per-frame
          // motion exactly cancels the lerp's catch-up.
          camera.position.x -= postWalk.mx * step * camLagFactor;
          camera.position.y -= postWalk.my * step * camLagFactor;
          camera.position.z -= postWalk.mz * step * camLagFactor;
          refs.renderedCursorPos.current.x -= postWalk.mx * step * cursorLagFactor;
          refs.renderedCursorPos.current.y -= postWalk.my * step * cursorLagFactor;
          refs.renderedCursorPos.current.z -= postWalk.mz * step * cursorLagFactor;
        }
        camera.quaternion.copy(targetCamQuat);
        camera.updateMatrixWorld(true);
        group.position.copy(refs.renderedCursorPos.current);
        group.quaternion.copy(cursorQuatTarget);
        group.updateMatrixWorld(true);
      } else {
        const camK = 1 - Math.exp(-CAMERA_LERP_RATE * delta);
        camera.position.lerp(tmpCamTarget.current, camK);
        camera.quaternion.copy(targetCamQuat);

        const leanK = 1 - Math.exp(-LEAN_LERP_RATE * delta);
        refs.renderedCursorPos.current.lerp(cursorPosTarget, leanK);
        group.position.copy(refs.renderedCursorPos.current);
        group.quaternion.slerp(cursorQuatTarget, leanK);
      }

      refs.renderedScale.current += (AVATAR_SCALE - refs.renderedScale.current) * k;
      teleportSnapRef.current = false;
    }
    group.scale.setScalar(refs.renderedScale.current);

    // Publish the final-for-this-frame avatar world pose to the
    // shared singletons. InteractionController reads position next
    // frame as the raycast origin; useMultiplayerSync reads both
    // position + quaternion to send authoritative-server updates.
    // See `cursorWorldPosition.ts`.
    cursorWorldPosition.copy(refs.avatarPos.current);
    cursorWorldQuaternion.copy(group.quaternion);
  }, 2);

  return null;
}
