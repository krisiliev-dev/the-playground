/**
 * DevTools — performance overlay for development.
 *
 * Renders a custom DOM-only overlay that reads `WebGLRenderer.info`
 * each frame and surfaces FPS plus the live render-pipeline counters
 * (draw calls, triangles, geometries, textures, programs). Opt-in via
 * `?perf=1` (or the bare `?perf` flag) and dev-mode-only.
 *
 * Why a custom overlay instead of `r3f-perf` or drei's `Stats`:
 *
 *   - `r3f-perf` mounts its own WebGL canvas (the `ChartUI` graph)
 *     inside the page, contributing to Safari's per-page WebGL
 *     context budget (typically 8–16). Combined with our real Canvas
 *     and LoadingScreen's transient probe Canvas, the budget is
 *     exhausted; the next Canvas is born in CONTEXT_LOST state and
 *     the precision query throws. User-visible symptom: overlay
 *     flashes once and disappears, console shows
 *     `WebGL: context lost` and `null is not an object`.
 *
 *   - drei's `Stats` is DOM-only (good) but only exposes FPS / MS /
 *     MB. For a portal cascade where draw-call count and triangle
 *     count matter, that's not enough info.
 *
 *   - `gl.info` is the same data source `r3f-perf` reads from. Pulled
 *     into a `position: fixed` div via direct DOM updates (no React
 *     reconciliation per frame), it gives the same readouts r3f-perf
 *     does without ever creating a second WebGL context.
 *
 * Caching is load-bearing: `RouteSync` strips the `?perf=1` query
 * string off the URL on the first avatar-driven navigation. Reading
 * the flag once at module import time means the gate's answer is
 * stable for the lifetime of the page, regardless of subsequent URL
 * rewrites.
 */
import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';

const PERF_ENABLED: boolean = (() => {
  if (import.meta.env.PROD) {
    return false;
  }
  if (typeof window === 'undefined') {
    return false;
  }
  const params = new URLSearchParams(window.location.search);
  return params.has('perf') && params.get('perf') !== '0';
})();

if (PERF_ENABLED) {
  // eslint-disable-next-line no-console
  console.log('[DevTools] perf overlay enabled (top-left)');
}

/** UI refresh rate. The overlay polls `gl.info` every frame but only
 *  updates the DOM at this cadence so the text doesn't jitter
 *  unreadably and we don't pay for `textContent` writes 60×/sec. */
const PERF_UI_HZ = 8;
const PERF_UI_INTERVAL_MS = 1000 / PERF_UI_HZ;

function PerfOverlay(): null {
  const gl = useThree((s) => s.gl);
  const containerRef = useRef<HTMLDivElement | null>(null);
  /** Sliding window of frame timestamps within the last 1000 ms. The
   *  length of this array is the live FPS (frames-per-second). */
  const frameTimesRef = useRef<number[]>([]);
  const lastUiUpdateRef = useRef(0);

  useEffect(() => {
    const div = document.createElement('div');
    Object.assign(div.style, {
      position: 'fixed',
      top: '8px',
      left: '8px',
      padding: '6px 10px',
      backgroundColor: 'rgba(0, 0, 0, 0.72)',
      color: '#00ffcc',
      font: '11px / 14px ui-monospace, "JetBrains Mono", monospace',
      whiteSpace: 'pre',
      pointerEvents: 'none',
      borderRadius: '4px',
      zIndex: '99999',
      letterSpacing: '0.02em',
    });
    div.textContent = 'perf: …';
    document.body.appendChild(div);
    containerRef.current = div;
    return () => {
      div.remove();
      containerRef.current = null;
    };
  }, []);

  useFrame(() => {
    const div = containerRef.current;
    if (!div) {
      return;
    }
    const now = performance.now();
    const frames = frameTimesRef.current;
    frames.push(now);
    // Trim out timestamps older than 1 second — what's left is the
    // count of frames rendered in the last second, i.e. the FPS.
    while (frames.length > 0 && frames[0]! < now - 1000) {
      frames.shift();
    }
    if (now - lastUiUpdateRef.current < PERF_UI_INTERVAL_MS) {
      return;
    }
    lastUiUpdateRef.current = now;

    const info = gl.info;
    const fps = frames.length;
    const ms =
      frames.length >= 2
        ? ((frames[frames.length - 1]! - frames[0]!) / Math.max(1, frames.length - 1)).toFixed(1)
        : '–';
    const programs = info.programs?.length ?? 0;
    div.textContent = [
      `FPS  ${fps.toString().padStart(3)}   ${ms} ms/frame`,
      `Calls    ${info.render.calls}`,
      `Tris     ${info.render.triangles.toLocaleString()}`,
      `Lines    ${info.render.lines}`,
      `Points   ${info.render.points}`,
      `Geoms    ${info.memory.geometries}`,
      `Texs     ${info.memory.textures}`,
      `Programs ${programs}`,
    ].join('\n');
  });

  return null;
}

export function DevTools(): JSX.Element | null {
  if (!PERF_ENABLED) {
    return null;
  }
  return <PerfOverlay />;
}
