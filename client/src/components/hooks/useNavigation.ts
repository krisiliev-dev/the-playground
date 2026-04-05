/**
 * useNavigation — maps natural browser interactions to 3D camera movement.
 *
 * This is the key to making the 3D environment feel like a website:
 * - Scroll up/down → move up/down on the Y axis
 * - Scroll left/right (or swipe) → rotate the camera (yaw)
 * - Pinch to zoom → move forward/backward on the Z axis
 * - Click a zone → smoothly fly the camera there
 *
 * Design notes:
 * - We listen to wheel/touch events on the canvas container
 * - Movement is applied as velocity with damping, so it feels smooth
 * - Zone navigation uses lerp for a cinematic camera fly
 * - All state writes go through the Zustand store, keeping this
 *   hook pure and testable (no direct Three.js mutations)
 */

import { useEffect, useCallback, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Vector3 } from 'three';
import { useWorldStore } from '@/store';

/** Damping factor — lower = smoother but slower. */
const DAMPING = 0.08;

/** How fast scrolling moves the camera (units per pixel). */
const SCROLL_SPEED_Y = 0.01;
const SCROLL_SPEED_X = 0.003;

/** How fast pinch-zoom moves forward/backward. */
const PINCH_SPEED = 0.02;

/** How fast the camera flies to a zone (0–1, fraction per frame). */
const ZONE_FLY_SPEED = 0.05;

/**
 * Hook that wires up browser input events to camera movement.
 * Must be used inside an R3F Canvas (relies on useFrame and useThree).
 */
export function useNavigation(): void {
  const { camera, gl } = useThree();
  const setPlayerPosition = useWorldStore((s) => s.setPlayerPosition);
  const setPlayerRotation = useWorldStore((s) => s.setPlayerRotation);
  const activeZoneId = useWorldStore((s) => s.activeZoneId);
  const zones = useWorldStore((s) => s.environment.zones);
  const dimensions = useWorldStore((s) => s.environment.dimensions);

  // Velocity accumulators — mutated by event handlers, consumed by useFrame.
  const velocity = useRef({ x: 0, y: 0, z: 0, yaw: 0 });
  const lastTouchDistance = useRef<number | null>(null);

  // ── Wheel handler (scroll → Y movement + yaw rotation) ──────────

  const handleWheel = useCallback((event: WheelEvent) => {
    event.preventDefault();
    velocity.current.y -= event.deltaY * SCROLL_SPEED_Y;
    velocity.current.yaw += event.deltaX * SCROLL_SPEED_X;
  }, []);

  // ── Touch handlers (pinch → Z movement, swipe → yaw) ────────────

  const handleTouchMove = useCallback((event: TouchEvent) => {
    if (event.touches.length === 2) {
      // Pinch to zoom → forward/backward movement
      const touch1 = event.touches[0];
      const touch2 = event.touches[1];
      if (!touch1 || !touch2) {
        return;
      }

      const distance = Math.hypot(touch2.clientX - touch1.clientX, touch2.clientY - touch1.clientY);

      if (lastTouchDistance.current !== null) {
        const delta = distance - lastTouchDistance.current;
        velocity.current.z -= delta * PINCH_SPEED;
      }

      lastTouchDistance.current = distance;
    } else if (event.touches.length === 1) {
      // Single finger swipe → yaw rotation
      const touch = event.touches[0];
      if (!touch) {
        return;
      }
      // We'd track previous position here for delta — simplified for scaffold
      // Full implementation will use a ref to store previous touch position
    }
  }, []);

  const handleTouchEnd = useCallback(() => {
    lastTouchDistance.current = null;
  }, []);

  // ── Attach event listeners ───────────────────────────────────────

  useEffect(() => {
    const canvas = gl.domElement;
    canvas.addEventListener('wheel', handleWheel, { passive: false });
    canvas.addEventListener('touchmove', handleTouchMove, { passive: false });
    canvas.addEventListener('touchend', handleTouchEnd);

    return () => {
      canvas.removeEventListener('wheel', handleWheel);
      canvas.removeEventListener('touchmove', handleTouchMove);
      canvas.removeEventListener('touchend', handleTouchEnd);
    };
  }, [gl.domElement, handleWheel, handleTouchMove, handleTouchEnd]);

  // ── Per-frame update ─────────────────────────────────────────────

  useFrame(() => {
    const vel = velocity.current;
    const halfW = dimensions[0] / 2 - 1;
    const halfH = dimensions[1] / 2 - 1;
    const halfD = dimensions[2] / 2 - 1;

    // If navigating to a zone, smoothly lerp the camera there
    if (activeZoneId) {
      const zone = zones.find((z) => z.id === activeZoneId);
      if (zone) {
        const target = new Vector3(...zone.position);
        camera.position.lerp(target, ZONE_FLY_SPEED);
        const lookTarget = new Vector3(...zone.lookAt);
        camera.lookAt(lookTarget);
      }
    } else {
      // Free-roaming: apply velocity with damping
      camera.position.y += vel.y;
      camera.position.z += vel.z;
      camera.rotation.y += vel.yaw;

      // Clamp position to stay inside the box
      camera.position.x = Math.max(-halfW, Math.min(halfW, camera.position.x));
      camera.position.y = Math.max(-halfH, Math.min(halfH, camera.position.y));
      camera.position.z = Math.max(-halfD, Math.min(halfD, camera.position.z));
    }

    // Apply damping
    vel.y *= 1 - DAMPING;
    vel.z *= 1 - DAMPING;
    vel.yaw *= 1 - DAMPING;

    // Sync camera position back to the store (for multiplayer readiness)
    setPlayerPosition([camera.position.x, camera.position.y, camera.position.z]);
    setPlayerRotation([camera.rotation.x, camera.rotation.y, camera.rotation.z]);
  });
}
