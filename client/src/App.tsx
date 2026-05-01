import { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { Canvas, type RootState } from '@react-three/fiber';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { World, PostFx, DevTools, ShakeGroup, CursorAvatar } from '@/components/scene';
import {
  CursorText,
  Crosshair,
  ControlsHint,
  LoadingScreen,
  PauseMenu,
} from '@/components/overlay';
import { sfx } from '@/components/audio/SfxManager';
import { isInteractionSynthSuppressed } from '@/components/scene/Interactable';
import { About, Home, Projects, Writing } from '@/routes';
import { DocumentShell } from '@/components/document';
import { useWorldStore } from '@/store';
import { acquirePointerLock } from '@/utils';

type BootState = 'loading' | 'ready' | 'failed';

const AdminPanel = lazy(() =>
  import('@/components/admin/AdminPanel').then((m) => ({ default: m.AdminPanel })),
);

function isAdminRoute(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  const params = new URLSearchParams(window.location.search);
  return params.get('admin') === '1';
}

/**
 * Global mouse-feedback audio. Mousedown fires the `mouseDown` cue
 * (also serves as the audio-unlock gesture for Safari — must be the
 * first synchronous action on the click event), mouseup fires
 * `mouseUp`. Together they form a two-part click sound played on
 * every press anywhere on the page.
 *
 * On touch devices, also unlock on the *real* touchstart event —
 * iOS Safari's synthetic mouse events from a tap can vary in their
 * gesture-stack treatment, but a literal touchstart handler runs on
 * the actual tap, on the same call stack as the user gesture. This
 * is the most reliable point to call `sfx.unlock()` for mobile.
 */
function useGlobalMouseFeedback(): void {
  useEffect(() => {
    const onMouseDown = (): void => {
      // Unlock first — Safari requires the AudioContext +
      // resume() to happen on the synchronous gesture path. Then
      // play the mousedown cue.
      sfx.unlock();
      // On mobile, iOS Safari fires synthetic mousedown after a
      // touchend that our touch path already handled. Skip the
      // audio cue if we're inside the suppression window so the
      // mouseDown/Up sounds don't double up.
      if (isInteractionSynthSuppressed()) {
        return;
      }
      void sfx.play('mouseDown');
    };
    const onMouseUp = (): void => {
      if (isInteractionSynthSuppressed()) {
        return;
      }
      void sfx.play('mouseUp');
    };
    const onTouchStart = (): void => {
      // First touch on mobile is the canonical user gesture — unlock
      // the AudioContext synchronously inside this handler so iOS
      // Safari sees the unlock pattern on the gesture stack. The
      // touch path in CursorAvatar plays the mouseDown cue directly
      // when appropriate; we don't fire it here to avoid duplication.
      sfx.unlock();
    };
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('touchstart', onTouchStart, { passive: true });
    return () => {
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('touchstart', onTouchStart);
    };
  }, []);
}

/**
 * Dev shortcut: press `C` to toggle the cursor avatar visibility.
 * Useful for stepping into the small/large states without playing the
 * whole reveal sequence. Ignores events from text inputs so admin typing
 * doesn't fire it.
 */
function useAvatarDevHotkey(): void {
  const toggleCursorAvatar = useWorldStore((s) => s.toggleCursorAvatar);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) {
          return;
        }
      }
      if (e.key === 'c' || e.key === 'C') {
        toggleCursorAvatar();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [toggleCursorAvatar]);
}

export function App(): JSX.Element {
  useGlobalMouseFeedback();
  useAvatarDevHotkey();
  // Simple Experience document mode. When true, the 3D scene
  // (Canvas + cursor + animations) is *paused and hidden* rather
  // than torn down: `frameloop="never"` stops the GPU work, and a
  // wrapping div with visibility:hidden + pointer-events:none takes
  // it visually + interactively offline. That preserves every
  // ref, every Three.js object, every animation timer across the
  // toggle, so flipping back is a one-frame redraw of the exact
  // scene the user left — no respawn, no fly-in, no rehydration
  // logic. The trade is ~tens of MB of held WebGL memory; an
  // explicit "free 3D resources" mode can be added later for
  // genuinely memory-constrained devices.
  const documentMode = useWorldStore((s) => s.documentMode);
  // Boot gate: LoadingScreen probes WebGL + preloads audio before we
  // mount the real Canvas. Once `bootState === 'ready'` the Canvas
  // is *permanent* for the rest of the session — document mode
  // toggles only affect its visibility + frameloop, never its
  // mount status.
  const [bootState, setBootState] = useState<BootState>('loading');
  // Runtime WebGL context loss recovery — once the scene is live, the
  // real Canvas's onCreated handler attaches a webglcontextlost listener
  // that flips this flag if the GPU process dies under us mid-session.
  const [contextLost, setContextLost] = useState(false);

  // Reclaim pointer-lock when returning from document mode while in
  // avatar mode. DocumentShell sets `pendingPointerLock = true`
  // synchronously inside its "Switch to 3D experience" click
  // handler. We can't request the lock until the Canvas is actually
  // in the DOM, so the effect fires when *either* documentMode goes
  // false (Canvas was already mounted from a prior 3D session) or
  // bootState becomes 'ready' (first-time 3D entry from a fresh
  // doc-mode load — LoadingScreen ran in between).
  useEffect(() => {
    if (documentMode || bootState !== 'ready') {
      return;
    }
    const { pendingPointerLock, setPendingPointerLock } = useWorldStore.getState();
    if (pendingPointerLock) {
      setPendingPointerLock(false);
      acquirePointerLock();
    }
  }, [documentMode, bootState]);

  const handleBootReady = useCallback(() => setBootState('ready'), []);
  const handleBootFailed = useCallback(() => setBootState('failed'), []);

  const handleCreated = useCallback((state: RootState): void => {
    const canvas = state.gl.domElement;
    const glContext = state.gl.getContext() as
      | (WebGLRenderingContext & { isContextLost?: () => boolean })
      | (WebGL2RenderingContext & { isContextLost?: () => boolean });

    // Born-lost: the renderer initialised against a context that's
    // already in CONTEXT_LOST state. No frame will ever render.
    if (glContext.isContextLost?.()) {
      // eslint-disable-next-line no-console
      console.error('[webgl] context already lost at Canvas creation');
      setContextLost(true);
      return;
    }

    const onLost = (e: Event): void => {
      // preventDefault is what enables the browser to dispatch
      // webglcontextrestored later — without it, the context is
      // permanently gone.
      e.preventDefault();
      // eslint-disable-next-line no-console
      console.error('[webgl] context lost during runtime');
      setContextLost(true);
    };
    const onRestored = (): void => {
      // eslint-disable-next-line no-console
      console.log('[webgl] context restored — full reload still recommended');
    };
    canvas.addEventListener('webglcontextlost', onLost);
    canvas.addEventListener('webglcontextrestored', onRestored);
  }, []);

  if (isAdminRoute()) {
    return (
      <Suspense fallback={null}>
        <AdminPanel />
      </Suspense>
    );
  }

  // First-load Simple Experience path. Until the user explicitly
  // opts into 3D, we never mount the Canvas — saving the WebGL
  // probe, preload, and persistent memory cost for visitors who
  // came in via Simple Experience and may never leave.
  if (documentMode && bootState === 'loading') {
    return (
      <BrowserRouter>
        <DocumentShell>
          <SectionRoutes />
        </DocumentShell>
      </BrowserRouter>
    );
  }

  // Active boot probe — only runs in 3D mode, since document mode
  // bypasses the Canvas entirely on first load.
  if (bootState === 'loading') {
    return (
      <div style={styles.root}>
        <LoadingScreen onReady={handleBootReady} onFailed={handleBootFailed} />
      </div>
    );
  }

  // Boot probe failed in 3D mode — show the unavailable overlay.
  // (Document mode has no Canvas to fail, so this branch is 3D-only.)
  if (bootState === 'failed' && !documentMode) {
    return (
      <div style={styles.root}>
        <ContextLostOverlay
          title="Display unavailable"
          body="Your browser couldn't initialise a 3D context. This is usually a transient driver hiccup — reloading often resolves it."
        />
      </div>
    );
  }

  // Past this point, bootState is 'ready' (or 'failed' but in
  // document mode where it doesn't matter). The Canvas is
  // permanent; documentMode flips its visibility + frameloop.
  return (
    <BrowserRouter>
      <div
        style={{
          ...styles.root,
          // visibility (not display:none) keeps R3F's resize observer
          // happy — display:none reports 0×0 and the renderer would
          // resize the framebuffer down, then back up on toggle.
          // visibility:hidden preserves layout dimensions; the canvas
          // pixels stay valid and reappear instantly when toggled.
          visibility: documentMode ? 'hidden' : 'visible',
          pointerEvents: documentMode ? 'none' : 'auto',
        }}
        aria-hidden={documentMode ? true : undefined}
      >
        <Canvas
          camera={{ fov: 60, near: 0.1, far: 1500, position: [0, 0, -360] }}
          dpr={[1, 2]}
          // `frameloop="never"` halts the render loop entirely while
          // in document mode — no useFrame ticks, no GPU draw calls,
          // CPU and GPU drop to idle. Animations resume from exactly
          // their pre-pause state when we flip back to 'always'.
          frameloop={documentMode ? 'never' : 'always'}
          // Explicitly set `powerPreference: 'default'` — R3F's default
          // `WebGLRenderer` constructor passes 'high-performance' itself
          // unless we override here, and Safari treats that as a hard
          // demand to switch to the discrete GPU. If it can't honor the
          // request, the WebGL context is created and immediately lost,
          // so `getShaderPrecisionFormat()` returns null and Three.js
          // bails before any scene mounts (blank page).
          // `failIfMajorPerformanceCaveat: false` lets the browser fall
          // back to a software/low-power renderer rather than refusing
          // the context outright.
          gl={{
            antialias: true,
            alpha: false,
            powerPreference: 'default',
            failIfMajorPerformanceCaveat: false,
          }}
          style={styles.canvas}
          onCreated={handleCreated}
        >
          <color attach="background" args={['#0a0a12']} />
          <Suspense fallback={null}>
            <ShakeGroup>
              <World />
            </ShakeGroup>
          </Suspense>
          {/* Cursor lives outside ShakeGroup so it doesn't jitter with the
              camera-shake on sword impacts. */}
          <CursorAvatar />
          <PostFx />
          <DevTools />
        </Canvas>
      </div>
      {/* Mode-specific UI layered on top of the (possibly hidden)
          Canvas. DocumentShell takes over the viewport in doc mode;
          the 3D-only overlays (Crosshair, ControlsHint, CursorText,
          PauseMenu) are conditionally mounted so their listeners
          aren't running in document mode. */}
      {documentMode ? (
        <DocumentShell>
          <SectionRoutes />
        </DocumentShell>
      ) : (
        <>
          <Crosshair />
          <ControlsHint />
          <CursorText />
          <PauseMenu />
          <SectionRoutes />
        </>
      )}
      {contextLost && !documentMode && (
        <ContextLostOverlay
          title="Display crashed"
          body="The 3D renderer lost its GPU context. This is rare; reloading restores the scene."
        />
      )}
    </BrowserRouter>
  );
}

/**
 * Section routes shared between the 3D shell (where matches render
 * as fixed-overlay cards above the Canvas) and the document shell
 * (where matches render inside DocumentShell's main slot). Each
 * route component branches on `documentMode` internally to pick
 * its own visual variant — Routes is identical between the two
 * because the *route table* doesn't change, only the components'
 * presentation does.
 */
function SectionRoutes(): JSX.Element {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/about" element={<About />} />
      <Route path="/projects" element={<Projects />} />
      <Route path="/projects/:slug" element={<Projects />} />
      <Route path="/writing" element={<Writing />} />
      <Route path="/writing/:slug" element={<Writing />} />
      <Route path="*" element={<Home />} />
    </Routes>
  );
}

interface ContextLostOverlayProps {
  title: string;
  body: string;
}

function ContextLostOverlay({ title, body }: ContextLostOverlayProps): JSX.Element {
  return (
    <div style={styles.contextLostOverlay} role="alertdialog" aria-modal="true">
      <div style={styles.contextLostInner}>
        <h2 style={styles.contextLostTitle}>{title}</h2>
        <p style={styles.contextLostBody}>{body}</p>
        <button
          type="button"
          style={styles.contextLostButton}
          onClick={() => window.location.reload()}
        >
          Reload
        </button>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    position: 'fixed',
    inset: 0,
    overflow: 'hidden',
    backgroundColor: '#0a0a12',
  },
  canvas: {
    width: '100%',
    height: '100%',
    display: 'block',
  },
  contextLostOverlay: {
    position: 'fixed',
    inset: 0,
    backgroundColor: 'rgba(10, 10, 18, 0.9)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
  },
  contextLostInner: {
    maxWidth: 380,
    padding: '24px 28px',
    borderRadius: 8,
    border: '1px solid #00ffcc',
    backgroundColor: '#12121a',
    color: '#e0e0e8',
    fontFamily: 'system-ui, sans-serif',
    textAlign: 'center',
  },
  contextLostTitle: {
    margin: '0 0 12px',
    fontSize: 20,
    color: '#00ffcc',
    letterSpacing: 0.5,
  },
  contextLostBody: {
    margin: '0 0 20px',
    fontSize: 14,
    lineHeight: 1.5,
  },
  contextLostButton: {
    padding: '8px 24px',
    fontSize: 14,
    fontWeight: 600,
    letterSpacing: 0.5,
    color: '#0a0a12',
    backgroundColor: '#00ffcc',
    border: 'none',
    borderRadius: 4,
    cursor: 'pointer',
  },
};
