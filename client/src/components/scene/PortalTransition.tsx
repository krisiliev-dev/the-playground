/**
 * PortalTransition — drives the click-through camera animation when
 * the user activates a section portal.
 *
 * While `portalTransit` is non-null in the store this component
 * owns the camera: AvatarCursor's useFrame yields, the camera
 * dollies toward the disc hub (the wall point where the formation
 * impacted) over a fixed duration, and a sibling DOM overlay
 * (`PortalTransitionOverlay`, in App.tsx) fades the portal's color
 * over the canvas in lockstep.
 *
 * On animation completion the component writes
 * `pendingNavigation = path` (NavigationConsumer dispatches it to
 * react-router) and clears `portalTransit` (which removes the
 * overlay and returns camera control to AvatarCursor).
 *
 * The dolly target is the disc hub (clickHit.point + small inward
 * normal offset) rather than the specific clicked pie's centroid:
 * all four pies meet at the hub, the math is simpler, and the fade
 * overlay hides the visual difference.
 */
import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Quaternion, Vector3 } from 'three';
import { useWorldStore } from '@/store';

/** Total dolly duration in seconds. Long enough to feel cinematic
 *  without making the user wait. */
export const PORTAL_TRANSIT_DURATION = 1.5;
/** Distance from the wall to position the camera at completion.
 *  Large enough to keep the camera inside the cube (no clipping
 *  through the wall geometry); small enough that the fade overlay
 *  has filled the screen by the time we stop. */
const STOP_DISTANCE_FROM_WALL = 1.5;

/** Smoothstep ease — accelerates in, decelerates out. The dolly
 *  feels like it's being pulled into the portal rather than moving
 *  at constant speed. */
function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export function PortalTransition(): null {
  const { camera } = useThree();
  // Capture initial camera state on first frame of transit. We
  // can't pre-compute these in the click handler because at that
  // moment AvatarCursor is still driving the camera; whatever it
  // wrote on the previous frame is the starting point.
  const startedAt = useRef<number>(-1);
  const initialPos = useRef(new Vector3());
  const initialQuat = useRef(new Quaternion());
  const targetPos = useRef(new Vector3());
  const targetQuat = useRef(new Quaternion());

  useFrame((state) => {
    const transit = useWorldStore.getState().portalTransit;
    const clickHit = useWorldStore.getState().clickHit;

    // Idle path — reset the per-transit refs so the next click
    // captures fresh state, and yield without touching the camera.
    if (!transit || !clickHit) {
      startedAt.current = -1;
      return;
    }

    if (startedAt.current < 0) {
      startedAt.current = state.clock.elapsedTime;
      initialPos.current.copy(camera.position);
      initialQuat.current.copy(camera.quaternion);

      // Target: stop just shy of the wall along the inward normal
      // direction, looking *into* the wall. The fade overlay will
      // be at full opacity by the time we arrive, so the user
      // doesn't see the abrupt halt.
      const hitPoint = new Vector3(...clickHit.point);
      const normal = new Vector3(...clickHit.normal);
      // STOP_DISTANCE_FROM_WALL is along -normal (back from the
      // wall, toward the cube interior). camera.position ends up
      // hovering just in front of the disc hub.
      targetPos.current.copy(hitPoint).addScaledVector(normal, STOP_DISTANCE_FROM_WALL);

      // Aim the camera at the hub. We compute a target quaternion
      // by setting the camera's matrix lookAt at the hub, reading
      // back the resulting quaternion, then restoring camera state
      // for the lerp on subsequent frames.
      const savedPos = camera.position.clone();
      camera.position.copy(targetPos.current);
      camera.lookAt(hitPoint);
      targetQuat.current.copy(camera.quaternion);
      // Restore — the actual lerp handles position/quat below.
      camera.position.copy(savedPos);
      camera.quaternion.copy(initialQuat.current);
    }

    const elapsed = state.clock.elapsedTime - startedAt.current;
    const t = Math.min(elapsed / PORTAL_TRANSIT_DURATION, 1);
    const eased = easeInOutCubic(t);

    camera.position.lerpVectors(initialPos.current, targetPos.current, eased);
    camera.quaternion.slerpQuaternions(initialQuat.current, targetQuat.current, eased);

    if (t >= 1) {
      // Animation complete — push the route and tear down. Order
      // matters: write pendingNavigation FIRST so NavigationConsumer
      // sees the path on the same React commit that clears
      // portalTransit (avoids a frame where neither is set and the
      // camera snaps back from a stray AvatarCursor tick).
      const { path } = transit;
      const { setPendingNavigation, setPortalTransit } = useWorldStore.getState();
      setPendingNavigation(path);
      setPortalTransit(null);
      startedAt.current = -1;
    }
  });

  return null;
}
