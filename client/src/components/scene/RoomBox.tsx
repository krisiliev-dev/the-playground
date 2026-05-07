/**
 * RoomBox — a single inverted-cube primitive the avatar can stand
 * inside.
 *
 * Every cube in the world (the main cube, the section rooms, any
 * future sub-region) renders as one of these. Characteristics —
 * color, transparency, bob, clamp, etc. — travel with the box's
 * config; the primitive is responsible for the geometry +
 * material + bob render transform only. Avatar clamping is
 * handled separately by `CursorAvatar`, which reads the same
 * config to know what to clamp to.
 *
 * Position + size are derived from `bounds` (see `boxCenter` /
 * `boxSize` in `content/routes.ts`) — there's no separate
 * `position` prop because the box's bbox IS its position. That
 * keeps URL routing and visible geometry coupled to one source.
 */
import { forwardRef, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { BackSide, type Group, type ShaderMaterial } from 'three';
import { GridMaterial } from './GridMaterial';
import { floatOffset } from './floatBob';
import { boxCenter, boxSize, type RoomBoxConfig } from '@/content/routes';

interface GridUniforms {
  u_time: { value: number };
}

export type RoomBoxProps = RoomBoxConfig & {
  /** Optional ref to the bobbing inner group — for ancestor
   *  components that need to read the live render position
   *  (e.g. for raycaster origin offsets). */
  bobGroupRef?: React.MutableRefObject<Group | null>;
};

export const RoomBox = forwardRef<Group, RoomBoxProps>(function RoomBox(
  {
    bounds,
    color = '#00ffcc',
    bgColor,
    alpha,
    transparent = false,
    bob,
    bobGroupRef,
    // texture / clamp are config-only here — RoomBox renders the
    // wireframe geometry; texture support and clamp enforcement
    // live in their respective consumers.
  },
  ref,
) {
  const center = boxCenter(bounds);
  const size = boxSize(bounds);
  const localFloatRef = useRef<Group>(null);
  const matRef = useRef<ShaderMaterial>(null);

  useFrame((state) => {
    const group = localFloatRef.current;
    if (group) {
      group.position.y = floatOffset(state.clock.elapsedTime, bob);
    }
    // Per-frame u_time update — drives the breathing grid pulse +
    // ripple decay. Every RoomBox needs this; the GridMaterial
    // shader assumes u_time is being written each frame.
    const mat = matRef.current;
    if (mat) {
      const uniforms = mat.uniforms as unknown as GridUniforms;
      uniforms.u_time.value = state.clock.elapsedTime;
    }
  });

  return (
    <group ref={ref}>
      <group
        ref={(node: Group | null) => {
          (localFloatRef as React.MutableRefObject<Group | null>).current = node;
          if (bobGroupRef) {
            bobGroupRef.current = node;
          }
        }}
      >
        <mesh position={center}>
          <boxGeometry args={size} />
          <GridMaterial
            ref={matRef}
            side={BackSide}
            gridColor={color}
            bgColor={bgColor}
            alpha={alpha}
            transparent={transparent}
          />
        </mesh>
      </group>
    </group>
  );
});
