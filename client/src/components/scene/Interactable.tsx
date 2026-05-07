/**
 * Interactable — crosshair-driven object interaction.
 *
 * Two pieces ship from this file:
 *
 *   useInteractable({ id, onInteract, range }) → { ref, isHovered }
 *     A hook for any mesh that wants to respond to crosshair hits.
 *     Caller attaches the returned `ref` to a mesh; the hook handles
 *     registration with the central controller, and exposes
 *     `isHovered` so the caller can drive its own highlight visual
 *     (emissive boost, scale up, outline, whatever fits).
 *
 *   InteractionController
 *     A central per-frame raycaster that mounts once inside the
 *     `<Canvas>`. While the avatar is active, it shoots a ray from
 *     the camera through screen-centre (NDC 0,0 — the crosshair
 *     position) and finds the nearest mesh tagged with userData
 *     `.interactable`. Updates `hoveredInteractableId` in the world
 *     store, and listens for click events to fire the matching
 *     interact handler + avatar-punch animation + heavy click cue.
 *
 * Why a custom raycaster instead of R3F's pointer events: R3F's
 * events read the live pointer position. With pointer-lock active the
 * cursor is hidden and `clientX/Y` freeze at the lock point — which
 * isn't necessarily screen-centre. Driving NDC=(0,0) directly each
 * frame is independent of the pointer-lock state.
 */
import { useEffect, useMemo, useRef, type MutableRefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Mesh, type Object3D, Raycaster, Vector2, Vector3 } from 'three';
import { useWorldStore } from '@/store';
import { sfx } from '../audio/SfxManager';
import { cursorWorldPosition } from './cursorWorldPosition';

/** Maximum distance (world units) at which an object is considered
 *  interactable. The cube is 800 units across; 60 units puts the
 *  reach at "things in close visual proximity, not the entire room". */
const INTERACT_RANGE = 60;
/** Minimum visible duration for a press, in ms. Without this, a fast
 *  mousedown-mouseup pair can release the press before the next
 *  animation frame even renders, so the lean animation never plays —
 *  the cursor appears not to move at all. We delay `endInteractPress`
 *  until at least this much time has elapsed since `beginInteractPress`,
 *  so even instant clicks still produce a visible peck animation. */
export const MIN_PRESS_HOLD_MS = 130;

export interface ReleasePlan {
  /** Release the press synchronously — the user held long enough that
   *  the lean animation has had time to play. */
  immediate: boolean;
  /** When `immediate === false`, schedule the release this many ms in
   *  the future so the animation has time to read. 0 when `immediate`. */
  delayMs: number;
}

/**
 * Decide whether to release a press immediately or defer. A press
 * shorter than `minPressMs` defers; longer presses release at once.
 *
 * Pure so the timing semantics can be unit-tested without standing up
 * an InteractionController + R3F scene.
 */
export function planRelease(heldMs: number, minPressMs: number): ReleasePlan {
  if (heldMs >= minPressMs) {
    return { immediate: true, delayMs: 0 };
  }
  return { immediate: false, delayMs: minPressMs - heldMs };
}

/** Module-scoped registry: id → click handler. Populated by the
 *  `useInteractable` hook, consumed by `InteractionController` when a
 *  click lands on a hovered interactable. Plain Map (not store state)
 *  because functions don't belong in a serialisable store, and
 *  registration is component-lifecycle bound. */
/** Module-scoped registry of interactable id → click handler. Exported
 *  so the mobile touch path in `CursorAvatar` can fire the matching
 *  handler directly when a touch lands on an interactable, without
 *  going through the InteractionController's crosshair-driven
 *  mousedown logic (which is the right pipeline for desktop but
 *  wrong for touch where the finger position — not screen centre —
 *  determines the press target). */
export const interactableHandlers = new Map<string, () => void>();

/** Synthetic-mouse-event suppression for iOS Safari's touch-to-mouse
 *  compatibility layer. iOS fires mousedown/mouseup/click after every
 *  touchend; without this gate, the InteractionController's
 *  crosshair-driven mouse handlers + the global App.tsx audio
 *  listeners would re-fire on those synthetic events, double-firing
 *  what the touch path already handled.
 *
 *  Two pieces:
 *    - A boolean "touch in progress" flag — true from the first
 *      finger landing to the last finger lifting. Suppression is
 *      active for the entire duration of any touch, no matter how
 *      long the hold.
 *    - A timestamp buffer set on touchend so the synthetic events
 *      that fire *after* the last touch lifts are also suppressed.
 *
 *  An earlier duration-only API (`suppressInteractionSynth(ms)`)
 *  worked for short taps but a long press would let the suppression
 *  expire mid-hold, so the synthetic events at the end of the press
 *  reached the controller anyway. */
let touchInProgress = false;
let suppressUntil = 0;

/** How long after a touchend to keep ignoring synthetic mouse
 *  events. iOS's compatibility burst (mousedown/mouseup/click)
 *  fires within a few ms, but the spec doesn't pin a maximum, so
 *  we buffer 400ms to be safe across older devices and slow
 *  frame budgets. */
const SYNTHETIC_EVENT_BUFFER_MS = 400;

export function setTouchInProgress(active: boolean): void {
  touchInProgress = active;
  if (!active) {
    suppressUntil = performance.now() + SYNTHETIC_EVENT_BUFFER_MS;
  }
}

export function isInteractionSynthSuppressed(): boolean {
  return touchInProgress || performance.now() < suppressUntil;
}

/** Scale factor applied to the interactable's visual on hover.
 *  Tuned to be noticeable but not jarring — 6% growth reads as "I
 *  see you aiming at me" without disrupting layout. */
const INTERACTABLE_HOVER_SCALE = 1.06;
/** Scale factor applied while the user is mouse-down'd on the
 *  interactable. Slightly under 1.0 makes the object feel like
 *  it's being "pressed" — same affordance as a button click. */
const INTERACTABLE_PRESS_SCALE = 0.94;
/** Lerp rate for the hover/press scale animation. High enough to
 *  feel responsive (full transition in ~100ms) without being
 *  instant (which would defeat the purpose of an animation). */
const INTERACTABLE_SCALE_LERP_RATE = 18;

interface UseInteractableOpts {
  /** Stable identifier — used as the key both in the registry and in
   *  the world store's `hoveredInteractableId`. Must be unique across
   *  all interactables in the scene. */
  id: string;
  onInteract: () => void;
  /** Override the default INTERACT_RANGE for this object. Useful for
   *  large objects you want to allow interaction with from further
   *  away than usual. */
  range?: number;
  /** Optional external mesh ref. The hook tags THIS mesh's userData
   *  for the central raycaster. If omitted, the hook creates its
   *  own ref (returned in the result) — pass that ref to your
   *  primary mesh.
   *
   *  Use the external form when the same mesh ref is also consumed
   *  elsewhere (e.g. the portal cascade's stencil pass uses the
   *  surface plane mesh ref it allocated), so you don't end up with
   *  two refs on the same mesh. */
  ref?: MutableRefObject<Mesh | null>;
  /** Optional ref to apply visual feedback (scale animation) to. If
   *  omitted, defaults to the interactable mesh (`ref`). Pass a
   *  separate ref when the visual affordance is on a different
   *  object than the click target — e.g. a portal whose surface
   *  plane is invisible (clicked via stencil) but whose VISIBLE
   *  rim should be the thing that pops on hover. */
  visualRef?: MutableRefObject<Object3D | null>;
}

interface UseInteractableResult {
  /** The ref to attach to your interactable mesh. Same as the one
   *  passed in via `opts.ref`, or a freshly-created one if omitted. */
  ref: MutableRefObject<Mesh | null>;
  /** True when the crosshair is currently aimed at this object.
   *  Already wired to drive automatic scale feedback on `visualRef`,
   *  but exposed for callers that want additional custom visuals
   *  (emissive boost, outline, color shift). */
  isHovered: boolean;
  /** True when the user has mouse-down'd on this object and hasn't
   *  released yet. Decoupled from `isHovered` so a press that started
   *  here remains "pressed" even if the cursor wanders off. */
  isPressed: boolean;
}

/**
 * Crosshair-driven interaction hook.
 *
 * Wiring an interactable now requires only this single hook call —
 * no manual userData tagging, no separate visual-affordance rig.
 * The hook handles, in this order:
 *
 *   1. Registers the click handler so `InteractionController`
 *      can fire it on mouseup.
 *   2. Tags `userData.interactable` + id + range on the mesh, which
 *      is what the per-frame crosshair raycast looks for.
 *   3. Animates the visual mesh's scale on hover and press, so
 *      every interactable has a consistent "I'm clickable" affordance
 *      without each consumer reimplementing it.
 *
 * Intent: a caller who just wants "this mesh is clickable from
 * `range` units away, fire `onInteract` on click" needs zero other
 * code. Hovers, scale animations, presses, ranges all flow from
 * the single hook configuration.
 */
export function useInteractable(opts: UseInteractableOpts): UseInteractableResult {
  const {
    id,
    onInteract,
    range = INTERACT_RANGE,
    ref: externalRef,
    visualRef: externalVisualRef,
  } = opts;
  const internalRef = useRef<Mesh>(null);
  const ref = externalRef ?? internalRef;
  const isHovered = useWorldStore((s) => s.hoveredInteractableId === id);
  const isPressed = useWorldStore((s) => s.pressedInteractableId === id);

  // Register the click handler. Re-registers if `onInteract` identity
  // changes — callers should `useCallback` if they want stability,
  // but it's not required.
  useEffect(() => {
    interactableHandlers.set(id, onInteract);
    return () => {
      interactableHandlers.delete(id);
    };
  }, [id, onInteract]);

  // Tag the mesh's userData so the central raycaster knows which hits
  // count + can read back the id. Re-applies whenever the ref settles
  // on a new mesh (rare, but cheap).
  useEffect(() => {
    const mesh = ref.current;
    if (!mesh) {
      return;
    }
    mesh.userData.interactable = true;
    mesh.userData.interactableId = id;
    mesh.userData.interactableRange = range;
    return () => {
      // Clear so the raycaster doesn't hold a stale reference if the
      // mesh outlives the hook.
      delete mesh.userData.interactable;
      delete mesh.userData.interactableId;
      delete mesh.userData.interactableRange;
    };
  }, [id, range, ref]);

  // Animate visual scale on hover/press. Scales lerp toward the
  // target each frame, so changes read as smooth animation rather
  // than instant snaps. Default visual target is the interactable
  // mesh itself; consumers with separate visual + click meshes
  // (e.g. portals) pass an explicit `visualRef`.
  useFrame((_state, delta) => {
    const target = (externalVisualRef ?? ref).current;
    if (!target) {
      return;
    }
    const targetScale = isPressed
      ? INTERACTABLE_PRESS_SCALE
      : isHovered
        ? INTERACTABLE_HOVER_SCALE
        : 1.0;
    const k = 1 - Math.exp(-INTERACTABLE_SCALE_LERP_RATE * delta);
    const cur = target.scale.x;
    const next = cur + (targetScale - cur) * k;
    target.scale.setScalar(next);
  });

  return { ref, isHovered, isPressed };
}

export function InteractionController(): null {
  const isAvatarActive = useWorldStore((s) => s.controlsDismissed);
  const setHoveredInteractable = useWorldStore((s) => s.setHoveredInteractable);
  const beginInteractPress = useWorldStore((s) => s.beginInteractPress);
  const endInteractPress = useWorldStore((s) => s.endInteractPress);

  const { camera, scene } = useThree();
  const raycaster = useMemo(() => {
    const r = new Raycaster();
    // Enable every layer on the raycaster so meshes parked on
    // non-default layers (e.g. portal surface planes on
    // PORTAL_SURFACE_LAYER) still register hits. Layers are a
    // *rendering* filter, not an interaction filter — what's
    // interactable is gated by `userData.interactable` below.
    // Without this, default raycaster.layers (only layer 0) rejects
    // any non-zero-layer mesh before the userData check runs, so
    // portals never light up as hovered and click-through never
    // fires.
    r.layers.enableAll();
    return r;
  }, []);
  /** NDC of the crosshair — always (0, 0) since the crosshair is
   *  fixed at screen centre. */
  const screenCentre = useMemo(() => new Vector2(0, 0), []);

  // Per-frame raycast. Skipped while avatar mode is inactive so we
  // don't pay the cost during idle/reveal phases. Hover state is
  // written to the store (id + world hit point) so click handlers +
  // tests can read the same value the raycaster wrote.
  useFrame(() => {
    if (!isAvatarActive) {
      if (useWorldStore.getState().hoveredInteractableId !== null) {
        setHoveredInteractable(null, null);
      }
      return;
    }
    // Direction from camera through screen-centre, then move the
    // origin to the cursor's current world position. The result: a
    // ray that starts AT the cursor and travels in the camera's
    // view direction. Anything between the camera and the cursor
    // (closer to camera than the cursor itself) doesn't intercept
    // this ray, so a portal positioned behind the cursor in view
    // direction can't be accidentally clicked. Pre-reveal /
    // pointer-mode the function early-returns above, so the
    // singleton's default (origin) value never reaches this code.
    raycaster.setFromCamera(screenCentre, camera);
    raycaster.ray.origin.copy(cursorWorldPosition);
    const hits = raycaster.intersectObjects(scene.children, true);
    let hoveredId: string | null = null;
    let hitPoint: Vector3 | null = null;
    for (const hit of hits) {
      const data = hit.object.userData;
      if (!data.interactable) {
        continue;
      }
      const range = (data.interactableRange as number | undefined) ?? INTERACT_RANGE;
      if (hit.distance > range) {
        // Out of range — stop walking, nothing closer is interactable.
        // (Hits are sorted by distance.)
        break;
      }
      hoveredId = (data.interactableId as string | undefined) ?? null;
      hitPoint = hit.point;
      break;
    }
    // Only call setHoveredInteractable if the id actually changed —
    // Zustand bails on equal updates anyway, but skipping the call
    // avoids subscriber re-render churn. Note: we *don't* skip when
    // only the point changed within the same id; the per-frame point
    // freshness matters less than the id-change render coalescing.
    if (useWorldStore.getState().hoveredInteractableId !== hoveredId) {
      const pointTuple: [number, number, number] | null =
        hoveredId && hitPoint ? [hitPoint.x, hitPoint.y, hitPoint.z] : null;
      setHoveredInteractable(hoveredId, pointTuple);
    } else if (hoveredId && hitPoint) {
      // Same id, fresh point — write the new point so press handlers
      // see the latest hit position. This is a direct setState (not
      // through the action) to avoid the id-change render path.
      useWorldStore.setState({
        hoveredInteractablePoint: [hitPoint.x, hitPoint.y, hitPoint.z],
      });
    }
  });

  // mousedown → begin a press over whatever's hovered (cursor leans
  // forward to touch). mouseup → if we ended on the same target,
  // commit the interaction (handler + heavy audio). Always release
  // the press so the cursor lerps back. Splitting the click into
  // press/release this way also gives future draggable objects a
  // hold signal to subscribe to.
  useEffect(() => {
    /** Time of the most recent `beginInteractPress`, used to enforce
     *  MIN_PRESS_HOLD_MS so fast clicks still produce a visible lean
     *  animation. */
    let pressStartTime = 0;
    let pendingReleaseTimer: ReturnType<typeof setTimeout> | null = null;

    const onMouseDown = (): void => {
      // Mobile's touch path already fired the press logic by the
      // time iOS dispatches its synthetic mousedown — bail so we
      // don't fire a second crosshair-driven press on top.
      if (isInteractionSynthSuppressed()) {
        return;
      }
      const state = useWorldStore.getState();
      if (!state.controlsDismissed) {
        return;
      }
      // Pause-menu open: clicks belong to the menu, not the 3D
      // crosshair pipeline. Without this gate, clicking the menu
      // backdrop (which closes the menu) would also fire a
      // crosshair-driven press on whatever happens to be under
      // screen-centre, leading to the "menu closed but I'm still
      // controlling the avatar" symptom.
      if (state.menuOpen) {
        return;
      }
      // Pointer-lock not active: this click is a "re-engage
      // controls" gesture (the canvas onClick will request
      // pointer-lock on the same click). Don't *also* fire an
      // interactable press — the user wants their controls back,
      // not to grab the first thing their crosshair was over.
      // Once pointer-lock is active, subsequent clicks fire
      // presses normally.
      if (
        typeof document !== 'undefined' &&
        document.pointerLockElement === null &&
        state.controlsDismissed
      ) {
        return;
      }
      const hoveredId = state.hoveredInteractableId;
      const hoveredPoint = state.hoveredInteractablePoint;
      if (!hoveredId || !hoveredPoint) {
        return;
      }
      // If a previous release was still pending its minimum hold,
      // cancel it — this new mousedown supersedes that animation
      // window and starts a fresh one.
      if (pendingReleaseTimer !== null) {
        clearTimeout(pendingReleaseTimer);
        pendingReleaseTimer = null;
      }
      pressStartTime = performance.now();
      beginInteractPress(hoveredId, hoveredPoint);
    };
    const onMouseUp = (): void => {
      // Same gate as mousedown — skip if a touch interaction just
      // committed. Without this, the synthetic mouseup would fire
      // the handler a second time.
      if (isInteractionSynthSuppressed()) {
        return;
      }
      const state = useWorldStore.getState();
      if (state.menuOpen) {
        return;
      }
      const pressedId = state.pressedInteractableId;
      // Commit: fire the handler for whichever interactable the
      // press TARGETED (mousedown), regardless of where the cursor
      // ended up at release. The press already established intent;
      // dragging out of range / panning the camera away mid-hold
      // shouldn't cancel a deliberate click. This matches the way
      // every native button handles "press, drag away, release" —
      // commit the press's original target.
      //
      // The earlier rule (`pressedId === hoveredId`) was native-
      // click semantics, but it didn't fit this 3D crosshair UI
      // where the camera moves while you hold and intent should
      // be honored once mousedown captures a target.
      if (pressedId) {
        const handler = interactableHandlers.get(pressedId);
        handler?.();
        sfx.unlock();
        void sfx.play('interactClick');
        void sfx.play('interactImpact');
      } else {
        return;
      }
      // Enforce minimum visible press duration. See `planRelease` —
      // fast clicks defer the release so the lean animation has time
      // to read; long presses release synchronously. Audio has already
      // fired above, so the user hears the click at the right moment;
      // the visual just lingers a few extra ms when needed.
      const heldMs = performance.now() - pressStartTime;
      const plan = planRelease(heldMs, MIN_PRESS_HOLD_MS);
      if (plan.immediate) {
        endInteractPress();
        return;
      }
      pendingReleaseTimer = setTimeout(() => {
        endInteractPress();
        pendingReleaseTimer = null;
      }, plan.delayMs);
    };
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mouseup', onMouseUp);
      if (pendingReleaseTimer !== null) {
        clearTimeout(pendingReleaseTimer);
      }
    };
  }, [beginInteractPress, endInteractPress]);

  return null;
}

export const INTERACTION_CONSTANTS = {
  INTERACT_RANGE,
} as const;
