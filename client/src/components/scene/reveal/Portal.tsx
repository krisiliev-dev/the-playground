/**
 * Portal — Phase 4
 *
 * The portal lives BEHIND the camera (+Z wall), so the user doesn't see it
 * in their default forward view. It only opens once the sword reveal
 * completes — that's when the cursor avatar "emerges" through it. After a
 * short hold, the portal closes again. If the user rotates with
 * OrbitControls, they may catch a glimpse of the open + close moment.
 *
 * Visual: a glowing cyan ring with a translucent swirling disc. Both fade
 * smoothly via a shared `u_intensity` uniform driven by an open/close
 * envelope.
 */
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { AdditiveBlending, type IUniform, type Mesh, type ShaderMaterial } from 'three';
import { useWorldStore } from '@/store';

const PORTAL_COLOR: [number, number, number] = [0.0, 1.0, 0.8]; // #00ffcc
const PORTAL_RADIUS = 4.5;
const PORTAL_INNER_RADIUS = 3.6;
/** Behind the user (camera at origin looks down -Z by default). */
const PORTAL_Z = 39.6;
/** Seconds after the reveal completes that the portal stays fully open. */
const HOLD_SECONDS = 0.9;
/** Seconds for the open ramp + close ramp. */
const RAMP_SECONDS = 0.5;

interface PortalUniforms {
  u_time: IUniform<number>;
  u_color: IUniform<[number, number, number]>;
  u_intensity: IUniform<number>;
  [key: string]: IUniform<unknown>;
}

const ringVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const ringFragment = /* glsl */ `
  uniform float u_time;
  uniform vec3 u_color;
  uniform float u_intensity;
  varying vec2 vUv;

  void main() {
    float breath = 0.7 + 0.3 * sin(u_time * 1.4);
    float rim = smoothstep(0.0, 0.5, vUv.y) * smoothstep(1.0, 0.5, vUv.y);
    float a = breath * rim * u_intensity;
    gl_FragColor = vec4(u_color, a);
  }
`;

const discFragment = /* glsl */ `
  uniform float u_time;
  uniform vec3 u_color;
  uniform float u_intensity;
  varying vec2 vUv;

  void main() {
    vec2 c = vUv - 0.5;
    float r = length(c) * 2.0;
    float angle = atan(c.y, c.x);
    float swirl = 0.5 + 0.5 * sin(angle * 4.0 + u_time * 0.6 + r * 6.0);
    float vignette = smoothstep(1.0, 0.2, r);
    float breath = 0.5 + 0.5 * sin(u_time * 1.4 - 1.0);
    float a = swirl * vignette * breath * 0.35 * u_intensity;
    gl_FragColor = vec4(u_color, a);
  }
`;

interface PortalProps {
  /** World-space center on the wall behind the camera. */
  position?: [number, number, number];
}

export function Portal({ position = [0, 0, PORTAL_Z] }: PortalProps): JSX.Element {
  const ringRef = useRef<Mesh>(null);
  const discRef = useRef<Mesh>(null);
  const ringMatRef = useRef<ShaderMaterial>(null);
  const discMatRef = useRef<ShaderMaterial>(null);

  const revealState = useWorldStore((s) => s.revealState);
  /** When the reveal first hit `revealed` — set once, drives the envelope. */
  const openedAt = useRef<number | null>(null);

  const ringUniforms = useMemo<PortalUniforms>(
    () => ({
      u_time: { value: 0 },
      u_color: { value: [...PORTAL_COLOR] as [number, number, number] },
      u_intensity: { value: 0 },
    }),
    [],
  );
  const discUniforms = useMemo<PortalUniforms>(
    () => ({
      u_time: { value: 0 },
      u_color: { value: [...PORTAL_COLOR] as [number, number, number] },
      u_intensity: { value: 0 },
    }),
    [],
  );

  // The wall is at z=+40 (back wall of the inverted cube). Rotate the
  // ring so its face points toward the camera at the origin.
  // Default circle/ring geometries face +Z; we want them to face -Z.
  const groupRotation: [number, number, number] = [0, Math.PI, 0];

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    ringUniforms.u_time.value = t;
    discUniforms.u_time.value = t;

    // Stamp the open time exactly once when the reveal completes.
    if (revealState === 'revealed' && openedAt.current === null) {
      openedAt.current = t;
    }
    // Rolling back to idle resets the portal so it can open again on replay.
    if (revealState === 'idle') {
      openedAt.current = null;
    }

    let target = 0;
    if (openedAt.current !== null) {
      const elapsed = t - openedAt.current;
      if (elapsed < RAMP_SECONDS) {
        target = elapsed / RAMP_SECONDS;
      } else if (elapsed < RAMP_SECONDS + HOLD_SECONDS) {
        target = 1;
      } else if (elapsed < RAMP_SECONDS * 2 + HOLD_SECONDS) {
        target = 1 - (elapsed - RAMP_SECONDS - HOLD_SECONDS) / RAMP_SECONDS;
      } else {
        target = 0;
      }
    }

    // Smooth toward target (avoids snapping if the state changes mid-frame).
    ringUniforms.u_intensity.value += (target - ringUniforms.u_intensity.value) * 0.15;
    discUniforms.u_intensity.value += (target - discUniforms.u_intensity.value) * 0.15;
  });

  return (
    <group position={position} rotation={groupRotation}>
      <mesh ref={discRef}>
        <circleGeometry args={[PORTAL_INNER_RADIUS, 64]} />
        <shaderMaterial
          ref={discMatRef}
          vertexShader={ringVertex}
          fragmentShader={discFragment}
          uniforms={discUniforms}
          transparent
          depthWrite={false}
          blending={AdditiveBlending}
        />
      </mesh>
      <mesh ref={ringRef}>
        <ringGeometry args={[PORTAL_INNER_RADIUS, PORTAL_RADIUS, 96]} />
        <shaderMaterial
          ref={ringMatRef}
          vertexShader={ringVertex}
          fragmentShader={ringFragment}
          uniforms={ringUniforms}
          transparent
          depthWrite={false}
          blending={AdditiveBlending}
        />
      </mesh>
    </group>
  );
}

export const PORTAL_CONSTANTS = {
  Z: PORTAL_Z,
  RADIUS: PORTAL_RADIUS,
  INNER_RADIUS: PORTAL_INNER_RADIUS,
  COLOR: '#00ffcc',
} as const;
