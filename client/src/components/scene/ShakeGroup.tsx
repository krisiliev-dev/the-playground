/**
 * ShakeGroup — wraps scene content and applies a per-frame position
 * offset driven by `cameraShake`. Shaking the world from inside is
 * visually equivalent to shaking the camera from outside, and avoids
 * fighting whatever else (e.g. CursorAvatar) is mutating the camera.
 */
import { useRef, type ReactNode } from 'react';
import { useFrame } from '@react-three/fiber';
import type { Group } from 'three';
import { computeShakeOffset } from './cameraShake';

export function ShakeGroup({ children }: { children: ReactNode }): JSX.Element {
  const ref = useRef<Group>(null);
  useFrame(() => {
    const obj = ref.current;
    if (!obj) {
      return;
    }
    // performance.now()/1000 (not state.clock.elapsedTime) so the
    // multiplayer receiver — which has no useFrame context — can
    // push impulses on the same time axis. R3F's clock starts at 0
    // when the canvas mounts, so impulses on different clocks would
    // fall outside the SHAKE_DURATION read window.
    const [x, y, z] = computeShakeOffset(performance.now() / 1000);
    obj.position.set(x, y, z);
  });
  return <group ref={ref}>{children}</group>;
}
