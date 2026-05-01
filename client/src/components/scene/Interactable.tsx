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
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Mesh, Raycaster, Vector2, Vector3 } from 'three';
import { useWorldStore } from '@/store';
import { sfx } from '../audio/SfxManager';

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

export function setTouchInProgress(active: boolean): void {
  touchInProgress = active;
  if (!active) {
    // Touch just ended — buffer the post-touchend synthetic event
    // burst (typically a few ms, but give it 400 to be safe).
    suppressUntil = performance.now() + 400;
  }
}

export function isInteractionSynthSuppressed(): boolean {
  return touchInProgress || performance.now() < suppressUntil;
}

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
}

interface UseInteractableResult {
  ref: React.RefObject<Mesh>;
  /** True when the crosshair is currently aimed at this object. Drive
   *  any highlight visual (emissive, scale, outline) from this. */
  isHovered: boolean;
  /** True when the user has mouse-down'd on this object and hasn't
   *  released yet. Decoupled from `isHovered` so a press that started
   *  here remains "pressed" even if the cursor wanders off (useful for
   *  future drag-with-cursor interactions). */
  isPressed: boolean;
}

export function useInteractable(opts: UseInteractableOpts): UseInteractableResult {
  const { id, onInteract, range = INTERACT_RANGE } = opts;
  const ref = useRef<Mesh>(null);
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
  }, [id, range]);

  return { ref, isHovered, isPressed };
}

export function InteractionController(): null {
  const isAvatarActive = useWorldStore((s) => s.controlsDismissed);
  const setHoveredInteractable = useWorldStore((s) => s.setHoveredInteractable);
  const beginInteractPress = useWorldStore((s) => s.beginInteractPress);
  const endInteractPress = useWorldStore((s) => s.endInteractPress);

  const { camera, scene } = useThree();
  const raycaster = useMemo(() => new Raycaster(), []);
  /** NDC of the crosshair — always (0, 0) since the crosshair is
   *  fixed at screen centre. */
  const screenCentre = useMemo(() => new Vector2(0, 0), []);
  /** Cached hit point of the most recent crosshair-on-interactable
   *  raycast — captured each frame so mousedown can read it without
   *  re-raycasting. */
  const latestHit = useRef<{ id: string; point: Vector3 } | null>(null);

  // Per-frame raycast. Skipped while avatar mode is inactive so we
  // don't pay the cost during idle/reveal phases.
  useFrame(() => {
    if (!isAvatarActive) {
      latestHit.current = null;
      return;
    }
    raycaster.setFromCamera(screenCentre, camera);
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
    latestHit.current = hoveredId && hitPoint ? { id: hoveredId, point: hitPoint } : null;
    // Only call setHoveredInteractable if the value actually changed —
    // Zustand bails on equal updates anyway, but skipping the call
    // avoids subscriber re-render churn.
    if (useWorldStore.getState().hoveredInteractableId !== hoveredId) {
      setHoveredInteractable(hoveredId);
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
      const hit = latestHit.current;
      if (!hit) {
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
      beginInteractPress(hit.id, [hit.point.x, hit.point.y, hit.point.z]);
    };
    const onMouseUp = (): void => {
      // Same gate as mousedown — skip if a touch interaction just
      // committed. Without this, the synthetic mouseup would fire
      // the handler a second time.
      if (isInteractionSynthSuppressed()) {
        return;
      }
      const state = useWorldStore.getState();
      const pressedId = state.pressedInteractableId;
      // Commit: only if the press still targets the currently-hovered
      // interactable (i.e. mouse-down and mouse-up landed on the same
      // object). A press that wandered off doesn't fire — same
      // semantics as a native click. Audio + handler fire on commit
      // (mouseup), regardless of any visual hold delay below.
      if (pressedId && pressedId === state.hoveredInteractableId) {
        const handler = interactableHandlers.get(pressedId);
        handler?.();
        sfx.unlock();
        void sfx.play('interactClick');
        void sfx.play('interactImpact');
      }
      if (!pressedId) {
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
