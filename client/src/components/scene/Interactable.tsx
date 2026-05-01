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
import { Mesh, Raycaster, Vector2 } from 'three';
import { useWorldStore } from '@/store';
import { sfx } from '../audio/SfxManager';

/** Maximum distance (world units) at which an object is considered
 *  interactable. The cube is 800 units across; 60 units puts the
 *  reach at "things in close visual proximity, not the entire room". */
const INTERACT_RANGE = 60;

/** Module-scoped registry: id → click handler. Populated by the
 *  `useInteractable` hook, consumed by `InteractionController` when a
 *  click lands on a hovered interactable. Plain Map (not store state)
 *  because functions don't belong in a serialisable store, and
 *  registration is component-lifecycle bound. */
const interactableHandlers = new Map<string, () => void>();

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
}

export function useInteractable(opts: UseInteractableOpts): UseInteractableResult {
  const { id, onInteract, range = INTERACT_RANGE } = opts;
  const ref = useRef<Mesh>(null);
  const isHovered = useWorldStore((s) => s.hoveredInteractableId === id);

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

  return { ref, isHovered };
}

export function InteractionController(): null {
  const isAvatarActive = useWorldStore((s) => s.controlsDismissed);
  const setHoveredInteractable = useWorldStore((s) => s.setHoveredInteractable);
  const triggerAvatarPunch = useWorldStore((s) => s.triggerAvatarPunch);

  const { camera, scene } = useThree();
  const raycaster = useMemo(() => new Raycaster(), []);
  /** NDC of the crosshair — always (0, 0) since the crosshair is
   *  fixed at screen centre. */
  const screenCentre = useMemo(() => new Vector2(0, 0), []);

  // Per-frame raycast. Skipped while avatar mode is inactive so we
  // don't pay the cost during idle/reveal phases.
  useFrame(() => {
    if (!isAvatarActive) {
      return;
    }
    raycaster.setFromCamera(screenCentre, camera);
    const hits = raycaster.intersectObjects(scene.children, true);
    let hoveredId: string | null = null;
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
      break;
    }
    // Only call setHoveredInteractable if the value actually changed —
    // Zustand bails on equal updates anyway, but skipping the call
    // avoids subscriber re-render churn.
    if (useWorldStore.getState().hoveredInteractableId !== hoveredId) {
      setHoveredInteractable(hoveredId);
    }
  });

  // Click → fire the hovered interactable's handler + avatar punch +
  // heavy interact audio. Listens at window level so any click anywhere
  // is considered (the hovered-state is what gates the interaction).
  useEffect(() => {
    const onClick = (): void => {
      // Read fresh state — the hovered id can change between renders.
      const state = useWorldStore.getState();
      if (!state.controlsDismissed) {
        return;
      }
      const targetId = state.hoveredInteractableId;
      if (!targetId) {
        return;
      }
      const handler = interactableHandlers.get(targetId);
      handler?.();
      triggerAvatarPunch();
      // Layered audio for impact: a heavily-processed click on top of
      // a low-frequency boom. See sfxManifest for the effects chain.
      sfx.unlock();
      void sfx.play('interactClick');
      void sfx.play('interactImpact');
    };
    window.addEventListener('click', onClick);
    return () => {
      window.removeEventListener('click', onClick);
    };
  }, [triggerAvatarPunch]);

  return null;
}

export const INTERACTION_CONSTANTS = {
  INTERACT_RANGE,
} as const;
