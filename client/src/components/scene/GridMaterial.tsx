/**
 * GridMaterial — custom GLSL ShaderMaterial for the cyberpunk wireframe grid.
 *
 * The vertex shader passes world-space position to the fragment shader,
 * which draws anti-aliased grid lines using fract() and smoothstep().
 */
import { useMemo } from 'react';
import { DoubleSide, type Side } from 'three';

interface GridMaterialProps {
  side?: Side;
}

const GRID_COLOR = '#00ffcc';
const BG_COLOR = '#12121a';
const LINE_WIDTH = 0.03;
const GRID_SPACING = 2.0;

/** Vertex shader — passes world position to fragment shader via varying. */
const vertexShader = /* glsl */ `
  varying vec3 vWorldPosition;

  void main() {
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPos.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

/**
 * Fragment shader — draws anti-aliased grid lines.
 *
 * TODO(human): Implement the grid line logic below.
 * The uniforms and varying are already wired up.
 * Your job: use vWorldPosition, u_gridSpacing, u_lineWidth,
 * u_gridColor, and u_bgColor to draw the wireframe grid.
 */
const fragmentShader = /* glsl */ `
  uniform vec3 u_gridColor;
  uniform vec3 u_bgColor;
  uniform float u_lineWidth;
  uniform float u_gridSpacing;

  varying vec3 vWorldPosition;

  void main() {
    // TODO(human): Replace this with grid line logic.
    // Hint: use fract() on vWorldPosition / u_gridSpacing to get
    // repeating coordinates, then smoothstep() for anti-aliased lines.
    gl_FragColor = vec4(u_bgColor, 1.0);
  }
`;

export function GridMaterial({ side = DoubleSide }: GridMaterialProps): JSX.Element {
  const uniforms = useMemo(
    () => ({
      u_gridColor: { value: hexToVec3(GRID_COLOR) },
      u_bgColor: { value: hexToVec3(BG_COLOR) },
      u_lineWidth: { value: LINE_WIDTH },
      u_gridSpacing: { value: GRID_SPACING },
    }),
    [],
  );

  return (
    <shaderMaterial
      vertexShader={vertexShader}
      fragmentShader={fragmentShader}
      uniforms={uniforms}
      side={side}
    />
  );
}

/** Convert a hex color string to a [r, g, b] array normalised to 0–1. */
function hexToVec3(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255];
}
