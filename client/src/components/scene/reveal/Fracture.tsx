/**
 * Fracture — Phase 4
 *
 * A thin plane sat just in front of the -Z wall, rendering procedural
 * cracks that radiate outward from the impact point once the sword
 * lands. Drawn on top of the existing GridMaterial so we don't have to
 * fight the cube's shader — it's an additive overlay.
 *
 * The crack field is a worley/voronoi-noise mask, gated by an animated
 * radius so it "spreads" outward. Bright cyan at the seam, dark interior.
 */
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { AdditiveBlending, type IUniform, type ShaderMaterial } from 'three';
import { useWorldStore } from '@/store';
import { PORTAL_CONSTANTS } from './Portal';

const FRACTURE_COLOR: [number, number, number] = [0.0, 1.0, 0.8];
const FRACTURE_SIZE = 36; // covers roughly the central wall area

interface FractureUniforms {
  u_time: IUniform<number>;
  u_progress: IUniform<number>;
  u_color: IUniform<[number, number, number]>;
  [key: string]: IUniform<unknown>;
}

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform float u_time;
  uniform float u_progress;  // 0..1, how far the fracture has spread
  uniform vec3 u_color;
  varying vec2 vUv;

  // Hash + 2D worley adapted from common GLSL snippets.
  vec2 hash22(vec2 p) {
    p = vec2(dot(p, vec2(127.1, 311.7)),
             dot(p, vec2(269.5, 183.3)));
    return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
  }

  float worleyEdges(vec2 p) {
    vec2 ip = floor(p);
    vec2 fp = fract(p);
    float d1 = 8.0;
    float d2 = 8.0;
    for (int j = -1; j <= 1; j++) {
      for (int i = -1; i <= 1; i++) {
        vec2 g = vec2(float(i), float(j));
        vec2 o = 0.5 + 0.5 * hash22(ip + g);
        float d = length(g + o - fp);
        if (d < d1) { d2 = d1; d1 = d; }
        else if (d < d2) { d2 = d; }
      }
    }
    return d2 - d1; // edges are where d1 ≈ d2
  }

  void main() {
    // Center the UVs around the impact point (which is the centre of the
    // plane).
    vec2 c = vUv - 0.5;
    float r = length(c) * 2.0;

    // Cracks: thin where the worley edge value is small.
    float edges = worleyEdges(vUv * 9.0);
    float crackMask = 1.0 - smoothstep(0.0, 0.06, edges);

    // Spread gate: only show cracks within an animated radius. As u_progress
    // grows, the spread radius increases. Soft feathered edge.
    float spread = u_progress * 1.2;
    float reveal = 1.0 - smoothstep(spread - 0.15, spread, r);

    // A radial bias so the centre is brightest.
    float radialPunch = exp(-r * 1.4);

    float intensity = crackMask * reveal * (0.6 + 0.6 * radialPunch);
    if (intensity < 0.001) discard;

    // Subtle pulsing flicker to suggest energy beneath the cracks.
    float flicker = 0.85 + 0.15 * sin(u_time * 6.0 + vUv.x * 30.0);

    gl_FragColor = vec4(u_color * flicker, intensity);
  }
`;

interface FractureProps {
  /** World-space center of the fracture plane on the back wall. */
  position?: [number, number, number];
  /** Plane edge length. */
  size?: number;
}

export function Fracture({
  position = [0, 0, PORTAL_CONSTANTS.Z + 0.1],
  size = FRACTURE_SIZE,
}: FractureProps): JSX.Element | null {
  const matRef = useRef<ShaderMaterial>(null);
  const revealState = useWorldStore((s) => s.revealState);

  const uniforms = useMemo<FractureUniforms>(
    () => ({
      u_time: { value: 0 },
      u_progress: { value: 0 },
      u_color: { value: [...FRACTURE_COLOR] as [number, number, number] },
    }),
    [],
  );

  // Restart the spread animation each time we land in `impact`.
  const startedAt = useRef<number | null>(null);
  useEffect(() => {
    if (revealState === 'impact' || revealState === 'revealed') {
      if (startedAt.current === null) {
        startedAt.current = performance.now() / 1000;
      }
    } else {
      startedAt.current = null;
      uniforms.u_progress.value = 0;
    }
  }, [revealState, uniforms]);

  useFrame((state) => {
    uniforms.u_time.value = state.clock.elapsedTime;
    if (startedAt.current !== null) {
      const dt = state.clock.elapsedTime - startedAt.current;
      // ~1.4s to fully spread. Clamp at 1.0.
      uniforms.u_progress.value = Math.min(1, dt / 1.4);
    }
  });

  // No-op before impact — keep the wall clean.
  if (revealState === 'idle' || revealState === 'armed' || revealState === 'swinging') {
    return null;
  }

  return (
    <mesh position={position}>
      <planeGeometry args={[size, size]} />
      <shaderMaterial
        ref={matRef}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        blending={AdditiveBlending}
      />
    </mesh>
  );
}

export const FRACTURE_CONSTANTS = {
  SIZE: FRACTURE_SIZE,
  COLOR: '#00ffcc',
} as const;
