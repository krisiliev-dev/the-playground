import { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { Canvas, useFrame, useThree, type RootState } from '@react-three/fiber';
import { BrowserRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { World, PostFx, DevTools, ShakeGroup, CursorAvatar } from '@/components/scene';
import {
  CursorText,
  Crosshair,
  ControlsHint,
  LoadingScreen,
  PauseMenu,
} from '@/components/overlay';
import { RouteSync } from '@/components/RouteSync';
import { sfx } from '@/components/audio/SfxManager';
import { isInteractionSynthSuppressed } from '@/components/scene/Interactable';
import { SectionPage } from '@/routes/SectionPage';
import { DocumentShell } from '@/components/document';
import { useWorldStore } from '@/store';
import { useMultiplayerSync } from '@/multiplayer/useMultiplayerSync';
import { MultiplayerDebugHud } from '@/multiplayer/MultiplayerDebugHud';
import { MultiplayerEffectsReceiver } from '@/multiplayer/MultiplayerEffectsReceiver';
import { acquirePointerLock } from '@/utils';
import { CubeScene } from '@/scenes/CubeScene';
import { SceneHost } from '@/scenes/SceneHost';
import { AboutRoom } from '@/scenes/rooms/AboutRoom';

type BootState = 'loading' | 'ready' | 'failed';

const AdminPanel = lazy(() =>
  import('@/admin/AdminPanel').then((m) => ({ default: m.AdminPanel })),
);

// Module-level Canvas configuration. R3F applies the `camera` /
// `gl` / `dpr` props to its internal state when their references
// change — so passing fresh object literals from JSX would cause
// `camera.position` to be re-applied (reset to spawn) on every
// re-render, including the doc → 3D toggle. Stable references mean
// these are applied exactly once on mount.
const CANVAS_CAMERA = {
  fov: 60,
  near: 0.1,
  far: 1500,
  position: [0, 0, -360] as [number, number, number],
};
const CANVAS_DPR = [1, 2] as [number, number];
// `powerPreference: 'default'` keeps Safari from forcing a discrete
// GPU switch (which would create-then-immediately-lose the context
// on machines that can't honor it). `failIfMajorPerformanceCaveat:
// false` lets the browser fall back to a software/low-power
// renderer rather than refusing to create the context outright.
const CANVAS_GL = {
  antialias: true,
  alpha: false,
  // `stencil: true` requests a framebuffer with stencil bits.
  // Required by PortalCascade's stencil-based recursive portal
  // renderer — each recursion level marks the portal's screen region
  // in the stencil buffer, then renders the through-view scene
  // restricted to that region. 8 bits = 255 nesting levels available.
  stencil: true,
  powerPreference: 'default',
  failIfMajorPerformanceCaveat: false,
} as const;

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

/**
 * Audio mute coordination. The render-loop pause stops useFrame
 * but the AudioContext is independent — a wallAmbient loop that
 * was playing when the user flipped into Simple Experience would
 * keep playing over the document. We therefore drive the live
 * master volume from `(documentMode || muted)`, with documentMode
 * acting as a transient mute layered on top of PauseMenu's
 * explicit user preference. Returning to 3D restores audio to the
 * user's chosen level.
 */
function useAudioMute(): void {
  const documentMode = useWorldStore((s) => s.documentMode);
  const muted = useWorldStore((s) => s.muted);
  useEffect(() => {
    sfx.setMasterVolume(documentMode || muted ? 0 : 1);
  }, [documentMode, muted]);
}

/**
 * Pause/resume the R3F render loop without triggering `setFrameloop`.
 *
 * R3F's `setFrameloop` zeroes `state.clock.elapsedTime` on every
 * prop transition (see `setFrameloop` in @react-three/fiber's
 * createStore). Toggling `frameloop` between "always" and "never"
 * therefore wipes the time-axis that AvatarCursor's intro pan,
 * Haze3D's fade-out, and other ref timestamps depend on — the user
 * symptom was the entire intro pan replaying on every doc → 3D
 * return, with the cursor collapsing to POINTER_SCALE for ~1.5s
 * while it lerped back up.
 *
 * The fix avoids `setFrameloop` entirely:
 *   - The Canvas is mounted with a constant `frameloop="demand"`.
 *     R3F never calls setFrameloop after the initial mount because
 *     the prop never changes; the clock therefore never gets reset.
 *   - In 3D mode, we keep the loop alive by calling `invalidate()`
 *     once per useFrame tick. R3F renders, our useFrame schedules
 *     the next, and so on.
 *   - In document mode, useFrame stops calling `invalidate()`. The
 *     loop runs out its current frame and naturally stops (R3F
 *     cancels its rAF when `repeat === 0`).
 *   - On the doc → 3D transition, a useEffect kicks `invalidate()`
 *     to restart the loop.
 *
 * When the loop pauses, the Three.js clock pauses with it (no
 * getDelta calls). When it resumes, getDelta computes the full
 * pause duration as a single delta, so `clock.elapsedTime` jumps
 * forward by however long the user spent in document mode. That's
 * exactly what we want: every timestamp ref is now well past its
 * animation duration, so panProgress=1 and the steady-state holds.
 */
/**
 * Generic one-shot navigation bridge. Any in-Canvas code that wants
 * react-router navigation writes a path to the store; this consumer
 * (mounted inside BrowserRouter where `useNavigate` works) picks it
 * up and dispatches. Currently unused by default — `RouteSync` is
 * the primary URL driver — but kept for explicit programmatic nav.
 */
function NavigationConsumer(): null {
  const pendingNavigation = useWorldStore((s) => s.pendingNavigation);
  const setPendingNavigation = useWorldStore((s) => s.setPendingNavigation);
  const navigate = useNavigate();
  useEffect(() => {
    if (pendingNavigation === null) {
      return;
    }
    setPendingNavigation(null);
    void navigate(pendingNavigation);
  }, [pendingNavigation, navigate, setPendingNavigation]);
  return null;
}

function FrameLoopController(): null {
  const documentMode = useWorldStore((s) => s.documentMode);
  const invalidate = useThree((state) => state.invalidate);

  useFrame(() => {
    // Demand-mode loop kicker: every tick, request the next tick
    // unless we've moved into document mode. Reading from
    // `useWorldStore.getState()` (rather than the closure) ensures
    // we see the latest value even on the boundary frame.
    if (!useWorldStore.getState().documentMode) {
      invalidate();
    }
  });

  useEffect(() => {
    // Restart the loop on entry to 3D — useFrame can't self-restart
    // once the loop has stopped, so we kick it from a React effect
    // when documentMode flips false.
    if (!documentMode) {
      invalidate();
    }
  }, [documentMode, invalidate]);

  return null;
}

/** Multiplayer WS URL — `VITE_MULTIPLAYER_URL` at build time, e.g.
 *  `ws://localhost:8080/ws` in dev. Empty string disables the
 *  hook so the app still runs single-player when the server isn't
 *  reachable (CI builds, offline deploys, etc.). */
const MULTIPLAYER_URL: string = (
  (import.meta.env as { VITE_MULTIPLAYER_URL?: string }).VITE_MULTIPLAYER_URL ?? ''
).trim();

export function App(): JSX.Element {
  useGlobalMouseFeedback();
  useAvatarDevHotkey();
  useAudioMute();
  const multiplayerEnabled = MULTIPLAYER_URL.length > 0;
  useMultiplayerSync({
    url: MULTIPLAYER_URL,
    enabled: multiplayerEnabled,
  });
  // Simple Experience document mode. When true, the 3D scene
  // (Canvas + cursor + animations) is *paused and hidden* rather
  // than torn down: FrameLoopController stops calling invalidate so
  // R3F's render loop drains naturally, and a wrapping div with
  // visibility:hidden + pointer-events:none takes the scene
  // visually + interactively offline. Every ref, every Three.js
  // object, every animation timer is preserved across the toggle,
  // so flipping back is a one-frame redraw of the exact scene the
  // user left — no respawn, no fly-in, no rehydration logic. The
  // trade is ~tens of MB of held WebGL memory; an explicit "free
  // 3D resources" mode can be added later for genuinely memory-
  // constrained devices.
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

  // Pointer-lock + entry/exit choreography around document mode.
  //
  //   Entering doc mode: release pointer-lock so the browser hands
  //   the OS cursor back to the user. Without this, the SE portal
  //   click flips documentMode but the canvas still owns the cursor,
  //   and the user is stuck with no cursor over the document.
  //   Mouselook also remains live (the mousemove handler gates on
  //   pointerLockElement === canvas), so an explicit exit doubles
  //   as the kill-switch for in-doc input bleed.
  //
  //   Returning to 3D in avatar mode: reclaim pointer-lock if
  //   DocumentShell set the `pendingPointerLock` signal in its
  //   "Switch to 3D experience" click handler. Effect fires when
  //   *either* documentMode goes false (Canvas already mounted) or
  //   bootState becomes 'ready' (first-time 3D entry from a fresh
  //   doc-mode load — LoadingScreen ran in between).
  useEffect(() => {
    if (documentMode) {
      if (typeof document !== 'undefined' && document.pointerLockElement) {
        document.exitPointerLock?.();
      }
      return;
    }
    if (bootState !== 'ready') {
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

  // Single, stable render tree. Every interactive state — initial
  // doc mode, first-time 3D boot, subsequent toggles — flows through
  // this same JSX shape, so React reconciles in place rather than
  // unmounting and remounting on each transition. The Canvas wrapper
  // renders unconditionally (mounts once on the very first render),
  // and the boot probe runs in the background even in document mode
  // — by the time the user clicks "Switch to 3D experience",
  // `bootState === 'ready'` and the toggle is a pure visibility flip.
  // Cost: doc-mode-only users pay the ~500ms WebGL probe + persistent
  // context memory; gain: zero-frame toggle, no replay of any intro
  // animation, no respawn.
  const hide3DShell = documentMode || bootState !== 'ready';
  return (
    <BrowserRouter>
      <NavigationConsumer />
      <RouteSync />
      <div
        style={{
          ...styles.root,
          // visibility (not display:none) keeps R3F's resize observer
          // happy — display:none reports 0×0 and the renderer would
          // resize the framebuffer down, then back up on toggle.
          // visibility:hidden preserves layout dimensions; the canvas
          // pixels stay valid and reappear instantly when toggled.
          visibility: hide3DShell ? 'hidden' : 'visible',
          pointerEvents: hide3DShell ? 'none' : 'auto',
        }}
        aria-hidden={hide3DShell || undefined}
      >
        {bootState === 'loading' && (
          <LoadingScreen onReady={handleBootReady} onFailed={handleBootFailed} />
        )}
        {bootState === 'ready' && (
          <Canvas
            camera={CANVAS_CAMERA}
            dpr={CANVAS_DPR}
            gl={CANVAS_GL}
            // Constant "demand" — toggling between "always"/"never"
            // would call setFrameloop on every transition, which
            // wipes state.clock.elapsedTime and makes every
            // timestamp-based animation replay. FrameLoopController
            // gates the loop via invalidate() instead.
            frameloop="demand"
            style={styles.canvas}
            onCreated={handleCreated}
          >
            <FrameLoopController />
            <color attach="background" args={['#0a0a12']} />
            {/* SceneHost swaps `state.scene` to whichever scene
                `currentRoom` selects (null = cube). Every scene's
                content is mounted via R3F createPortal into its
                own THREE.Scene; only the active one renders. */}
            <SceneHost />
            <CubeScene>
              <Suspense fallback={null}>
                <ShakeGroup>
                  <World />
                </ShakeGroup>
              </Suspense>
            </CubeScene>
            {/* CursorAvatar lives at the *root* R3F context (NOT
                inside CubeScene's createPortal subtree). R3F
                createPortal sub-stores have their own `pointer`
                state that isn't updated by the canvas's event
                handlers — anything inside a createPortal that
                reads `pointer` (PointerCursor does, via useThree)
                gets stale `(0, 0)` and the cursor freezes at
                screen center. CursorAvatar internally re-parents
                its Three.js group to the active scene each
                currentRoom change, so it still appears in
                whichever scene the player is in. */}
            <CursorAvatar />
            {/* Per-scene rooms — sibling of CubeScene, NOT child,
                so each scene's createPortal targets its own
                THREE.Scene without parent interference. */}
            <AboutRoom />
            <PostFx />
            <DevTools />
          </Canvas>
        )}
        {bootState === 'failed' && !documentMode && (
          <ContextLostOverlay
            title="Display unavailable"
            body="Your browser couldn't initialise a 3D context. This is usually a transient driver hiccup — reloading often resolves it."
          />
        )}
        {/* 3D-only overlays. Mounted only when actively in 3D so
            their listeners (M-key, click handlers) don't fire in
            document mode. Local state in these is acceptable to
            reset on toggle — they don't hold scene state. */}
        {bootState === 'ready' && !documentMode && (
          <>
            <Crosshair />
            <ControlsHint />
            <CursorText />
            <PauseMenu />
            <SectionRoutes />
            {multiplayerEnabled && (
              <>
                <MultiplayerDebugHud />
                <MultiplayerEffectsReceiver />
              </>
            )}
          </>
        )}
      </div>
      {/* DocumentShell — sibling of the 3D wrapper, only rendered in
          doc mode. Has its own SectionRoutes since it lays the matched
          route into its main slot rather than as a fixed-overlay card. */}
      {documentMode && (
        <DocumentShell>
          <SectionRoutes />
        </DocumentShell>
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
  // One dynamic page handles every route. SectionPage reads
  // useLocation().pathname and looks up the matching route's
  // content from `routes.ts`. New sections need a route entry,
  // not a new component file.
  return (
    <Routes>
      <Route path="*" element={<SectionPage />} />
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
