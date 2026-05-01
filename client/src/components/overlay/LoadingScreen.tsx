/**
 * LoadingScreen — boot-time gate that verifies the page is in a state
 * to render the 3D scene before mounting the real Canvas.
 *
 * Why this exists: a small subset of page loads hand back a "born-lost"
 * WebGL context (Safari GPU process restart, driver hiccup, HMR +
 * r3f-perf contention). When that happens the real Canvas mounts
 * silently broken — state machines run, audio fails, swords appear
 * behind the camera. Catching it here turns an unrecoverable mystery
 * into a clean retry prompt.
 *
 * Boot steps:
 *   1. WebGL probe — create a throwaway canvas, request the same
 *      context profile the real Canvas will use, verify
 *      `getShaderPrecisionFormat()` returns non-null. This is the
 *      exact API call that crashed in the rare bug.
 *   2. Audio preload — fetch + decode every cue so the first click
 *      has no work to do (helps explain the silent-audio symptom of
 *      the bug: a degraded page can stall the first decode).
 *
 * If the WebGL probe fails, we retry up to 3 times with a small backoff
 * before giving up — the underlying browser hiccup is usually transient.
 */
import { useEffect, useRef, useState } from 'react';
import { sfx } from '../audio/SfxManager';

interface LoadingScreenProps {
  /** Called once all boot checks pass and the Canvas can mount. */
  onReady: () => void;
  /** Called when the WebGL probe fails after all retries. The reason
   *  string is a short identifier suitable for an error UI. */
  onFailed: (reason: string) => void;
}

/** Cap probe attempts at 2 — one quick retry catches transient driver
 *  hiccups, but more retries burn through Safari's per-page WebGL
 *  context budget faster than they recover anything. Each probe canvas
 *  consumes a context slot. */
const WEBGL_RETRY_COUNT = 2;
const WEBGL_RETRY_DELAY_MS = 250;

export function LoadingScreen({ onReady, onFailed }: LoadingScreenProps): JSX.Element {
  const [stage, setStage] = useState('Initialising renderer…');
  const startedRef = useRef(false);

  useEffect(() => {
    // Strict-mode + HMR can mount this twice in dev; the boot sequence
    // is idempotent in effect (sfx.preload caches, the probe canvas is
    // throwaway) but skipping the second pass keeps logs clean.
    if (startedRef.current) {
      return;
    }
    startedRef.current = true;

    void runBootSequence(setStage, onReady, onFailed);
  }, [onReady, onFailed]);

  return (
    <div style={styles.overlay} role="status" aria-live="polite">
      <div style={styles.inner}>
        <div style={styles.spinner} />
        <div style={styles.text}>{stage}</div>
      </div>
      <style>{spinnerKeyframes}</style>
    </div>
  );
}

async function runBootSequence(
  setStage: (s: string) => void,
  onReady: () => void,
  onFailed: (reason: string) => void,
): Promise<void> {
  setStage('Verifying GPU context…');
  const webglOk = await probeWebGLWithRetries();
  if (!webglOk) {
    onFailed('webgl-unavailable');
    return;
  }

  setStage('Loading audio…');
  try {
    await sfx.preload();
  } catch (e) {
    // Audio failure is non-fatal — better to render a silent scene
    // than block the whole experience. The scene's `play()` calls
    // will surface their own errors via the manager's logging.
    // eslint-disable-next-line no-console
    console.warn('[boot] audio preload failed (non-fatal):', e);
  }

  setStage('Ready');
  onReady();
}

/** Try up to N times to confirm WebGL is healthy. Failures cluster in
 *  time (driver/browser glitches), so a small delay between attempts
 *  is enough to clear most cases. */
async function probeWebGLWithRetries(): Promise<boolean> {
  for (let i = 0; i < WEBGL_RETRY_COUNT; i++) {
    if (probeWebGL()) {
      return true;
    }
    if (i < WEBGL_RETRY_COUNT - 1) {
      await new Promise<void>((r) => setTimeout(r, WEBGL_RETRY_DELAY_MS));
    }
  }
  return false;
}

/** Synchronous WebGL health check: spin up a 1×1 canvas, request the
 *  same context profile the real Canvas uses, run the precision query
 *  that fails in the bug we're trying to prevent. The probe context
 *  is **explicitly released via `WEBGL_lose_context.loseContext()`**
 *  before this returns — leaving it for GC means the slot stays held
 *  until the browser feels like collecting, which on Safari can be
 *  long enough to push the real Canvas over the per-page WebGL
 *  context budget and reproduce the very bug we were trying to detect. */
function probeWebGL(): boolean {
  let gl: WebGLRenderingContext | WebGL2RenderingContext | null = null;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const attrs: WebGLContextAttributes = {
      antialias: true,
      alpha: false,
      powerPreference: 'default',
      failIfMajorPerformanceCaveat: false,
    };
    gl = canvas.getContext('webgl2', attrs) ?? canvas.getContext('webgl', attrs);
    if (!gl) {
      return false;
    }
    if (gl.isContextLost()) {
      return false;
    }
    const precision = gl.getShaderPrecisionFormat(gl.VERTEX_SHADER, gl.HIGH_FLOAT);
    if (!precision) {
      return false;
    }
    return true;
  } catch {
    return false;
  } finally {
    // Always release the probe slot, even on the success path — we
    // only needed to confirm a context can be created, not hold one.
    if (gl) {
      const ext = gl.getExtension('WEBGL_lose_context');
      ext?.loseContext();
    }
  }
}

const spinnerKeyframes = `
  @keyframes loading-screen-spin {
    to { transform: rotate(360deg); }
  }
`;

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    inset: 0,
    backgroundColor: '#0a0a12',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
  },
  inner: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 20,
  },
  spinner: {
    width: 32,
    height: 32,
    borderRadius: '50%',
    border: '2px solid rgba(0, 255, 204, 0.2)',
    borderTopColor: '#00ffcc',
    animation: 'loading-screen-spin 0.9s linear infinite',
  },
  text: {
    color: '#e0e0e8',
    fontFamily: 'system-ui, sans-serif',
    fontSize: 13,
    letterSpacing: 0.5,
  },
};
