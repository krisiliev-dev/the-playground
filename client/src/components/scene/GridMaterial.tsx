import { forwardRef, useMemo } from 'react';
import {
  DataTexture,
  DoubleSide,
  FloatType,
  NearestFilter,
  RGBAFormat,
  Vector3,
  type ShaderMaterial,
  type Side,
} from 'three';

interface GridMaterialProps {
  side?: Side;
  /** Hex color for the grid lines. Default cyan (cube). Section
   *  rooms pass their own color so each room reads as the same
   *  cyberpunk wireframe texture as the cube, just retinted. */
  gridColor?: string;
  /** Hex color for the dark background between lines. */
  bgColor?: string;
  /** Output alpha. Use < 1 alongside `transparent` for a
   *  see-through wall (the temporary cube transparency). */
  alpha?: number;
  /** Material's `transparent` flag. When true, sets
   *  `depthWrite: false` so the wall doesn't occlude what's
   *  behind it. */
  transparent?: boolean;
}

const DEFAULT_GRID_COLOR = '#00ffcc';
const DEFAULT_BG_COLOR = '#12121a';
/** Line thickness as a fraction of a cell. Smaller = thinner lines. */
const LINE_WIDTH = 0.012;
/** World-units between grid lines. Bigger = larger panels. */
const GRID_SPACING = 5.0;
/** How aggressive the tension-thinning is — at this pull, line is at 50% width. */
const TENSION_FULL = 14.0;

/**
 * Capacity of the caught-segment data texture. Each segment uses 3 RGBA-float
 * pixels, so MAX_SEGMENTS rows × 3 columns. The shader loops up to MAX_LOOP
 * per fragment — set high enough that "unlimited" feels real, but the loop
 * has linear cost per fragment, so going extreme will tank framerate.
 */
const MAX_SEGMENTS = 4096;
const MAX_LOOP = 1024;
/** Maximum perpendicular bow of each V-segment, in world units. */
const SLACK_AMOUNT = 0.9;
/** Pull magnitude at which the bow saturates at SLACK_AMOUNT. */
const SLACK_THRESHOLD = 8.0;

const vertexShader = /* glsl */ `
  varying vec3 vBoxPosition;
  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;

  void main() {
    // Pass the BOX-LOCAL position (geometry vertex, before the float
    // group's translation) so the grid pattern stays glued to the cube
    // even when the cube bobs up and down. Use modelMatrix for gl_Position
    // so rendering still respects the float transform.
    vBoxPosition = position;
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPos.xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const fragmentShader = /* glsl */ `
  #define MAX_LOOP ${MAX_LOOP}
  #define TEX_HEIGHT ${MAX_SEGMENTS}.0
  #define SLACK_AMOUNT ${SLACK_AMOUNT.toFixed(3)}
  #define SLACK_THRESHOLD ${SLACK_THRESHOLD.toFixed(3)}

  uniform vec3 u_gridColor;
  uniform vec3 u_bgColor;
  uniform float u_lineWidth;
  uniform float u_gridSpacing;
  uniform float u_tensionFull;
  uniform float u_alpha;

  uniform float u_time;
  uniform vec3 u_mouse;

  uniform sampler2D u_caughtData;
  uniform int u_caughtCount;
  /** 0 = fully held, 1 = fully released. Animates on click. */
  uniform float u_releaseT;

  uniform vec3 u_rippleOrigin;
  uniform float u_rippleTime;

  varying vec3 vBoxPosition;
  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;

  // Read segment i from the data texture. Texture layout:
  //   col 0 (RGBA): axis.xyz, coord
  //   col 1 (RGBA): along.xyz, segMin
  //   col 2 (RGBA): wallNormal.xyz, segMax
  //
  // We store the wall normal explicitly because cross(axis, along) is
  // the same up to sign for opposite walls (e.g. +Z and −Z both have
  // X/Y as their in-plane axes). Without an explicit normal the wall
  // guard can't tell them apart.
  void readSegment(
    int i,
    out vec3 caughtAxis,
    out vec3 alongDir,
    out vec3 wallNormal,
    out float coord,
    out float segMin,
    out float segMax
  ) {
    float row = (float(i) + 0.5) / TEX_HEIGHT;
    vec4 p0 = texture2D(u_caughtData, vec2(0.5 / 3.0, row));
    vec4 p1 = texture2D(u_caughtData, vec2(1.5 / 3.0, row));
    vec4 p2 = texture2D(u_caughtData, vec2(2.5 / 3.0, row));
    caughtAxis = p0.xyz;
    coord = p0.w;
    alongDir = p1.xyz;
    segMin = p1.w;
    wallNormal = p2.xyz;
    segMax = p2.w;
  }

  // 2D distance from point p to a segment (a → b) with a perpendicular
  // sag of "sag" units. Uses a catenary-like profile that's flatter near
  // the endpoints and steepest at the middle — closer to how a real
  // rubber band pulled at the centre actually curves between two pegs.
  float distToSluggedSegment2D(vec2 p, vec2 a, vec2 b, float sag) {
    vec2 ab = b - a;
    float len2 = max(dot(ab, ab), 0.0001);
    float t = clamp(dot(p - a, ab) / len2, 0.0, 1.0);
    vec2 lin = a + ab * t;
    if (abs(sag) > 0.0001) {
      vec2 perp = normalize(vec2(-ab.y, ab.x));
      // Catenary-like bump: 0 at endpoints, ~1 at midpoint, sharper
      // taper than sin. (1 - (2t-1)^4) gives a flatter peak with
      // steeper sides, closer to how a stretched rubber band looks.
      float k = 2.0 * t - 1.0;
      float bump = 1.0 - k * k * k * k;
      lin += perp * sag * bump;
    }
    return length(p - lin);
  }

  float caughtSegmentMask(
    vec3 worldPos,
    vec3 caughtAxis,
    vec3 alongDir,
    vec3 wallNormal,
    float caughtCoord,
    float segMin,
    float segMax
  ) {
    // Wall guard — must be exact same wall (signed dot, not abs).
    if (dot(wallNormal, vWorldNormal) < 0.95) return 0.0;

    vec2 frag = vec2(dot(worldPos, alongDir), dot(worldPos, caughtAxis));
    vec2 cursor = vec2(dot(u_mouse, alongDir), dot(u_mouse, caughtAxis));

    // Rubber-band release: lerp the cursor's across coord back to caughtCoord.
    cursor.y = mix(cursor.y, caughtCoord, u_releaseT);

    float pullAcross = cursor.y - caughtCoord;
    float pullStrength = clamp(abs(pullAcross) / SLACK_THRESHOLD, 0.0, 1.0);
    float sagSign = pullAcross >= 0.0 ? 1.0 : -1.0;
    float sag = SLACK_AMOUNT * pullStrength * sagSign;

    vec2 a = vec2(segMin, caughtCoord);
    vec2 b = vec2(segMax, caughtCoord);
    float d = min(
      distToSluggedSegment2D(frag, a, cursor, sag),
      distToSluggedSegment2D(frag, cursor, b, sag)
    );

    float thinness = clamp(abs(pullAcross) / u_tensionFull, 0.0, 1.0);
    float effLineWidth = u_lineWidth * (1.0 - 0.5 * thinness) * u_gridSpacing;

    float fw = fwidth(d);
    return 1.0 - smoothstep(effLineWidth - fw, effLineWidth + fw, d);
  }

  // Standard rest grid: every line at its rest position, except segments
  // that are currently caught — those are masked out within their own
  // segment range so the bulged V doesn't ghost behind a straight rest copy.
  float restGridMask(vec3 worldPos, float lineWidth) {
    vec3 coord = worldPos / u_gridSpacing;
    vec3 grid = abs(fract(coord - 0.5) - 0.5);
    vec3 fw = fwidth(coord);
    vec3 line = 1.0 - smoothstep(lineWidth - fw, lineWidth + fw, grid);
    vec3 axisActive = vec3(1.0) - abs(vWorldNormal);
    line *= axisActive;

    for (int i = 0; i < MAX_LOOP; i++) {
      if (i >= u_caughtCount) break;
      vec3 caughtAxis; vec3 alongDir; vec3 wallNormal;
      float coordSeg; float segMin; float segMax;
      readSegment(i, caughtAxis, alongDir, wallNormal, coordSeg, segMin, segMax);

      // Same-wall guard — must agree on direction, not just axis.
      if (dot(wallNormal, vWorldNormal) < 0.95) continue;

      float fragAlong = dot(worldPos, alongDir);
      if (fragAlong < segMin || fragAlong > segMax) continue;

      vec3 nearest = floor(coord + 0.5) * u_gridSpacing;
      vec3 axisMatch = abs(caughtAxis);
      vec3 cellMatch = vec3(1.0) - step(0.5, abs(nearest - vec3(coordSeg)));
      vec3 fadeMask = vec3(1.0) - axisMatch * cellMatch;
      line *= fadeMask;
    }

    return max(line.x, max(line.y, line.z));
  }

  // Soft additive halo around every grid line — exponential falloff so
  // the brightest point is on the line itself and it fades smoothly into
  // the cell. Used together with the sharp line mask to fake a bloom.
  float restGridGlow(vec3 worldPos) {
    vec3 coord = worldPos / u_gridSpacing;
    vec3 grid = abs(fract(coord - 0.5) - 0.5);
    vec3 halo = exp(-grid * 30.0);
    vec3 axisActive = vec3(1.0) - abs(vWorldNormal);
    halo *= axisActive;
    return max(halo.x, max(halo.y, halo.z));
  }

  // Combined V-shape mask across all caught segments.
  float caughtMask(vec3 worldPos) {
    float m = 0.0;
    for (int i = 0; i < MAX_LOOP; i++) {
      if (i >= u_caughtCount) break;
      vec3 caughtAxis; vec3 alongDir; vec3 wallNormal;
      float coord; float segMin; float segMax;
      readSegment(i, caughtAxis, alongDir, wallNormal, coord, segMin, segMax);
      m = max(m, caughtSegmentMask(worldPos, caughtAxis, alongDir, wallNormal, coord, segMin, segMax));
    }
    return m;
  }

  void main() {
    float restMask = restGridMask(vBoxPosition, u_lineWidth);
    float caught = caughtMask(vBoxPosition);
    float line = max(restMask, caught);

    // Glow pulse — same period (6s) and phase as the cube's float bob in
    // World.tsx, so the grid breathes in lockstep with the cube rising
    // and falling. Range [0, 1].
    float glowPulse = 0.5 + 0.5 * sin(u_time * (6.28318 / 6.0));

    // Soft additive halo around the grid lines, scaled by the pulse.
    float halo = restGridGlow(vBoxPosition);

    float elapsed = u_time - u_rippleTime;
    float rippleIntensity = 0.0;
    if (elapsed > 0.0 && elapsed < 4.0) {
      float rippleDist = distance(vBoxPosition, u_rippleOrigin);
      float front = elapsed * 20.0;
      float frontBand = exp(-abs(rippleDist - front) * 0.25);
      float wave = 0.5 + 0.5 * sin(rippleDist * 1.2 - elapsed * 14.0);
      float decay = exp(-elapsed * 1.1);
      rippleIntensity = wave * frontBand * decay;
    }

    // Modulate line brightness with the pulse — never fully dims (60%
    // floor) so the grid stays legible even at the trough.
    float lineBrightness = mix(0.6, 1.0, glowPulse);
    float intensity = clamp(
      line * lineBrightness + rippleIntensity * line * 2.0 + rippleIntensity * 0.15,
      0.0, 1.0
    );
    vec3 color = mix(u_bgColor, u_gridColor, intensity);

    // Additive halo glow — full at peak pulse, fades to zero at trough,
    // creating the "breathing" effect synced to the cube.
    color += u_gridColor * halo * 0.45 * glowPulse;
    color += u_gridColor * rippleIntensity * 0.2;

    gl_FragColor = vec4(color, u_alpha);
  }
`;

/** Build the empty caught-segment data texture. */
function makeCaughtTexture(): {
  texture: DataTexture;
  data: Float32Array;
} {
  const data = new Float32Array(3 * MAX_SEGMENTS * 4); // 3 pixels × N rows × RGBA
  const texture = new DataTexture(data, 3, MAX_SEGMENTS, RGBAFormat, FloatType);
  texture.minFilter = NearestFilter;
  texture.magFilter = NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return { texture, data };
}

export const GridMaterial = forwardRef<ShaderMaterial, GridMaterialProps>(function GridMaterial(
  {
    side = DoubleSide,
    gridColor = DEFAULT_GRID_COLOR,
    bgColor = DEFAULT_BG_COLOR,
    alpha = 1,
    transparent = false,
  },
  ref,
) {
  const { texture, data } = useMemo(() => makeCaughtTexture(), []);

  const uniforms = useMemo(
    () => ({
      u_gridColor: { value: hexToVec3(gridColor) },
      u_bgColor: { value: hexToVec3(bgColor) },
      u_lineWidth: { value: LINE_WIDTH },
      u_gridSpacing: { value: GRID_SPACING },
      u_tensionFull: { value: TENSION_FULL },
      u_alpha: { value: alpha },

      u_time: { value: 0 },
      u_mouse: { value: new Vector3(9999, 9999, 9999) },

      u_caughtData: { value: texture },
      u_caughtCount: { value: 0 },
      u_releaseT: { value: 0 },

      u_rippleOrigin: { value: new Vector3(9999, 9999, 9999) },
      u_rippleTime: { value: -1000 },
    }),
    // Color/alpha props are baked into the uniforms at mount; if a
    // caller wants to retint dynamically we can switch to useEffect
    // later. For now the cube and each room mount with stable values
    // so this is fine.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [texture],
  );

  // Stash the underlying buffer + texture on the ref so BoxEnvironment
  // can mutate them directly each frame (avoids re-rendering on writes).
  return (
    <shaderMaterial
      ref={(mat) => {
        if (mat) {
          const m = mat as ShaderMaterial & {
            userData: {
              caughtData?: Float32Array;
              caughtTexture?: DataTexture;
            };
          };
          // Three.js gives every Object3D/Material a userData object by
          // default; in jsdom test mocks the ref can be a bare element so
          // we initialise defensively.
          m.userData = m.userData ?? {};
          m.userData.caughtData = data;
          m.userData.caughtTexture = texture;
        }
        if (typeof ref === 'function') {
          ref(mat);
        } else if (ref) {
          ref.current = mat;
        }
      }}
      vertexShader={vertexShader}
      fragmentShader={fragmentShader}
      uniforms={uniforms}
      side={side}
      transparent={transparent}
      depthWrite={!transparent}
    />
  );
});

export const GRID_MATERIAL_CONSTANTS = {
  GRID_SPACING,
  MAX_SEGMENTS,
  MAX_LOOP,
} as const;

function hexToVec3(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255];
}
