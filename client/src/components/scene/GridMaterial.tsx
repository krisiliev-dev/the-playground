import { forwardRef, useMemo } from 'react';
import { DoubleSide, Vector3, type ShaderMaterial, type Side } from 'three';

interface GridMaterialProps {
  side?: Side;
}

const GRID_COLOR = '#00ffcc';
const BG_COLOR = '#12121a';
const LINE_WIDTH = 0.04;
const GRID_SPACING = 2.0;
const GRAB_RADIUS = 10.0;

const vertexShader = /* glsl */ `
  varying vec3 vWorldPosition;

  void main() {
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPos.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 u_gridColor;
  uniform vec3 u_bgColor;
  uniform float u_lineWidth;
  uniform float u_gridSpacing;
  uniform float u_grabRadius;

  uniform float u_time;
  uniform vec3 u_anchor;
  uniform vec3 u_mouse;
  uniform float u_mouseActive;
  uniform float u_pullStrength;

  uniform vec3 u_rippleOrigin;
  uniform float u_rippleTime;

  varying vec3 vWorldPosition;

  // Anti-aliased grid — 1.0 on a grid line, 0.0 elsewhere.
  float gridMask(vec3 worldPos) {
    vec3 coord = worldPos / u_gridSpacing;
    vec3 grid = abs(fract(coord - 0.5) - 0.5);
    vec3 fw = fwidth(coord);
    vec3 line = smoothstep(u_lineWidth + fw, u_lineWidth - fw, grid);
    return max(line.x, max(line.y, line.z));
  }

  void main() {
    vec3 pos = vWorldPosition;

    // --- MOUSE GRAB: warp space near the anchor toward the mouse ---
    vec3 pull = u_mouse - u_anchor;
    float anchorDist = distance(pos, u_anchor);
    float falloff = 1.0 - smoothstep(0.0, u_grabRadius, anchorDist);
    falloff = falloff * falloff; // sharper drop
    pos -= pull * falloff * u_pullStrength * u_mouseActive;

    float line = gridMask(pos);

    // --- RIPPLE: expanding sine wave from the last snap point ---
    float elapsed = u_time - u_rippleTime;
    float rippleIntensity = 0.0;
    if (elapsed > 0.0 && elapsed < 4.0) {
      float rippleDist = distance(vWorldPosition, u_rippleOrigin);
      float front = elapsed * 20.0;
      float frontBand = exp(-abs(rippleDist - front) * 0.25);
      float wave = 0.5 + 0.5 * sin(rippleDist * 1.2 - elapsed * 14.0);
      float decay = exp(-elapsed * 1.1);
      rippleIntensity = wave * frontBand * decay;
    }

    // Ripple brightens existing grid lines (stays on the wireframe, doesn't add new ones)
    float intensity = clamp(line + rippleIntensity * line * 2.0 + rippleIntensity * 0.15, 0.0, 1.0);

    // Glow: add a soft bloom around lines from grab + ripple
    float grabGlow = falloff * u_mouseActive * 0.15;

    vec3 color = mix(u_bgColor, u_gridColor, intensity);
    color += u_gridColor * (grabGlow + rippleIntensity * 0.2);

    // Lines visible, background partially transparent so the sky video shows through
    float alpha = 0.3 + intensity * 0.7;

    gl_FragColor = vec4(color, alpha);
  }
`;

export const GridMaterial = forwardRef<ShaderMaterial, GridMaterialProps>(
  function GridMaterial({ side = DoubleSide }, ref) {
    const uniforms = useMemo(
      () => ({
        u_gridColor: { value: hexToVec3(GRID_COLOR) },
        u_bgColor: { value: hexToVec3(BG_COLOR) },
        u_lineWidth: { value: LINE_WIDTH },
        u_gridSpacing: { value: GRID_SPACING },
        u_grabRadius: { value: GRAB_RADIUS },

        u_time: { value: 0 },
        u_anchor: { value: new Vector3(9999, 9999, 9999) },
        u_mouse: { value: new Vector3(9999, 9999, 9999) },
        u_mouseActive: { value: 0 },
        u_pullStrength: { value: 0.85 },

        u_rippleOrigin: { value: new Vector3(9999, 9999, 9999) },
        u_rippleTime: { value: -1000 },
      }),
      [],
    );

    return (
      <shaderMaterial
        ref={ref}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        uniforms={uniforms}
        side={side}
        transparent
      />
    );
  },
);

export const GRID_MATERIAL_CONSTANTS = {
  GRID_SPACING,
  GRAB_RADIUS,
} as const;

function hexToVec3(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255];
}
