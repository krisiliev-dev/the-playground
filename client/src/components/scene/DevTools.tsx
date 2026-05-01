/**
 * DevTools — performance overlay for development.
 *
 * Mounts `r3f-perf` inside the Canvas, but only when explicitly opted
 * in via `?perf=1`. Default-off because `r3f-perf` mounts its own
 * WebGL canvas alongside the real one, contributing to Safari's
 * per-page WebGL context budget (typically 8–16 contexts). Hitting that
 * budget shows up as the rare "born-lost" context bug — the real Canvas
 * is created in CONTEXT_LOST state, the renderer fails its
 * `getShaderPrecisionFormat()` call, and the scene mounts visually
 * broken. Keeping the perf overlay opt-in avoids that contribution.
 */
import { Perf } from 'r3f-perf';

function shouldShowPerf(): boolean {
  if (import.meta.env.PROD) {
    return false;
  }
  if (typeof window === 'undefined') {
    return false;
  }
  const params = new URLSearchParams(window.location.search);
  return params.get('perf') === '1';
}

export function DevTools(): JSX.Element | null {
  if (!shouldShowPerf()) {
    return null;
  }
  return <Perf position="top-left" minimal={false} />;
}
