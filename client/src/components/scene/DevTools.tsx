/**
 * DevTools — performance overlay for development.
 *
 * Mounts `r3f-perf` inside the Canvas. Renders nothing in production, and
 * accepts a `?perf=1` query param to opt out in dev (so you can see the
 * scene without the panel covering the corner). The panel reports GPU/CPU
 * frame time, draw calls, triangle count, texture memory — useful for
 * catching the kind of regression that crashed the browser earlier.
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
  if (params.get('perf') === '0') {
    return false;
  }
  return true;
}

export function DevTools(): JSX.Element | null {
  if (!shouldShowPerf()) {
    return null;
  }
  return <Perf position="top-left" minimal={false} />;
}
