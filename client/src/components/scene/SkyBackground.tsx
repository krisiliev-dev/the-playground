/**
 * SkyBackground — what surrounds the cube.
 *
 * Replaces the previous 360° video sphere with a game-style procedural
 * environment: a vertical-gradient inverted sphere (deep purple → near
 * black) plus a sparse drei <Stars /> field for parallax depth. No
 * external video assets, no network calls, no flicker — just renders.
 */
import { useMemo } from 'react';
import { Stars } from '@react-three/drei';
import { BackSide, type IUniform, type Vector3Tuple } from 'three';

interface SkyBackgroundProps {
  dimensions: Vector3Tuple;
}

const TOP_COLOR: [number, number, number] = [0.012, 0.018, 0.06]; // near-black with violet tint
const BOTTOM_COLOR: [number, number, number] = [0.04, 0.03, 0.11]; // dim deep purple at the horizon

interface SkyUniforms {
  u_top: IUniform<[number, number, number]>;
  u_bottom: IUniform<[number, number, number]>;
  [key: string]: IUniform<unknown>;
}

const vertexShader = /* glsl */ `
  varying vec3 vWorldDir;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldDir = normalize(wp.xyz);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 u_top;
  uniform vec3 u_bottom;
  varying vec3 vWorldDir;
  void main() {
    // Map direction.y from [-1, 1] to [0, 1] for a smooth vertical gradient.
    float t = clamp(vWorldDir.y * 0.5 + 0.5, 0.0, 1.0);
    // Slight ease so most of the sky reads as the deep top color.
    t = pow(t, 1.8);
    vec3 color = mix(u_bottom, u_top, t);
    gl_FragColor = vec4(color, 1.0);
  }
`;

export function SkyBackground({ dimensions }: SkyBackgroundProps): JSX.Element {
  const [w, h, d] = dimensions;
  // Multiplier of 4 ensures the sphere comfortably encloses the
  // cube AND the section rooms that protrude outside it (room
  // centres sit ~700 units from origin and span ±200 in each axis,
  // so the cube diagonal × 1.5 was undersized — rooms intersected
  // the sphere). 4× costs nothing visually since the gradient
  // shader is direction-only.
  const radius = (Math.sqrt(w * w + h * h + d * d) / 2) * 4;

  const uniforms = useMemo<SkyUniforms>(
    () => ({
      u_top: { value: [...TOP_COLOR] as [number, number, number] },
      u_bottom: { value: [...BOTTOM_COLOR] as [number, number, number] },
    }),
    [],
  );

  return (
    <>
      <mesh>
        <sphereGeometry args={[radius, 48, 32]} />
        <shaderMaterial
          vertexShader={vertexShader}
          fragmentShader={fragmentShader}
          uniforms={uniforms}
          side={BackSide}
        />
      </mesh>
      {/* Sparse cyberpunk starfield — sits inside the gradient sphere so
          the stars get partially occluded by the cube walls but reappear
          when looking past the cube edges. */}
      <Stars
        radius={radius * 0.85}
        depth={radius * 0.4}
        count={1800}
        factor={3}
        saturation={0}
        fade
        speed={0.4}
      />
    </>
  );
}
