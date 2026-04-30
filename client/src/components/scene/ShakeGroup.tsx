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
  useFrame((state) => {
    const obj = ref.current;
    if (!obj) {
      return;
    }
    const [x, y, z] = computeShakeOffset(state.clock.elapsedTime);
    obj.position.set(x, y, z);
  });
  return <group ref={ref}>{children}</group>;
}
