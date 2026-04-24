/**
 * Portal — Phase 4
 *
 * A glowing cyan ring centered on the -Z wall (z = -40 inside the 80×80×80
 * cube). Visible but subtle before the click — a soft pulse the user
 * notices but doesn't quite parse. After the sword impacts, it pulls back
 * (alpha fades) so the cracks + VIBE take over.
 *
 * Design choices:
 *   - A `RingGeometry` for the rim and a near-transparent disc behind it,
 *     both with custom shader materials. Keeps it close to the existing
 *     wireframe-grid aesthetic — same `#00ffcc` colour, additive glow.
 *   - The shader animates breathing (alpha pulse) + a slow swirl in the disc.
 *   - We sit a small offset off the wall (z = -39.6) so the ring beats
 *     z-fighting against the cube interior.
 */
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { AdditiveBlending, type IUniform, type Mesh, type ShaderMaterial } from 'three';
import { useWorldStore } from '@/store';

const PORTAL_COLOR: [number, number, number] = [0.0, 1.0, 0.8]; // #00ffcc
const PORTAL_RADIUS = 4.5;
const PORTAL_INNER_RADIUS = 3.6;
const PORTAL_Z = -39.6;

interface PortalUniforms {
  u_time: IUniform<number>;
  u_color: IUniform<[number, number, number]>;
  u_intensity: IUniform<number>;
  // Three.js typings for `shaderMaterial.uniforms` use an index signature.
  // Add one so a typed object is assignable.
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
    // Breath: soft 0.45 -> 1.0 sine
    float breath = 0.7 + 0.3 * sin(u_time * 1.4);
    // Slight rim band — falls off toward inner/outer edges of the ring.
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
    // Distance-from-center on a 0..1 quad UV.
    vec2 c = vUv - 0.5;
    float r = length(c) * 2.0;
    float angle = atan(c.y, c.x);

    // Soft swirl: alternating bands rotating slowly.
    float swirl = 0.5 + 0.5 * sin(angle * 4.0 + u_time * 0.6 + r * 6.0);

    // Vignette outward — fades to 0 at the rim.
    float vignette = smoothstep(1.0, 0.2, r);

    // Pulse the whole disc.
    float breath = 0.5 + 0.5 * sin(u_time * 1.4 - 1.0);

    float a = swirl * vignette * breath * 0.35 * u_intensity;
    gl_FragColor = vec4(u_color, a);
  }
`;

interface PortalProps {
  /** World-space center on the back wall. */
  position?: [number, number, number];
}

export function Portal({ position = [0, 0, PORTAL_Z] }: PortalProps): JSX.Element {
  const ringRef = useRef<Mesh>(null);
  const discRef = useRef<Mesh>(null);
  const ringMatRef = useRef<ShaderMaterial>(null);
  const discMatRef = useRef<ShaderMaterial>(null);

  const revealState = useWorldStore((s) => s.revealState);

  const ringUniforms = useMemo<PortalUniforms>(
    () => ({
      u_time: { value: 0 },
      u_color: { value: [...PORTAL_COLOR] as [number, number, number] },
      u_intensity: { value: 1.0 },
    }),
    [],
  );
  const discUniforms = useMemo<PortalUniforms>(
    () => ({
      u_time: { value: 0 },
      u_color: { value: [...PORTAL_COLOR] as [number, number, number] },
      u_intensity: { value: 1.0 },
    }),
    [],
  );

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    ringUniforms.u_time.value = t;
    discUniforms.u_time.value = t;

    // After impact the cracks / VIBE take centre stage — fade the portal
    // out gently rather than yanking it.
    const targetIntensity =
      revealState === 'idle' || revealState === 'armed' || revealState === 'swinging' ? 1.0 : 0.0;

    ringUniforms.u_intensity.value +=
      (targetIntensity - ringUniforms.u_intensity.value) * 0.04;
    discUniforms.u_intensity.value +=
      (targetIntensity - discUniforms.u_intensity.value) * 0.04;
  });

  return (
    <group position={position}>
      {/* The translucent inner disc */}
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
      {/* The bright ring */}
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
