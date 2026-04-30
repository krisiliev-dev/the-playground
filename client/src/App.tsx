import { Suspense, lazy, useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import { World, PostFx, DevTools, ShakeGroup, CursorAvatar } from '@/components/scene';
import { CursorText, Crosshair, ControlsHint } from '@/components/overlay';
import { useWorldStore } from '@/store';

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
  useAvatarDevHotkey();

  if (isAdminRoute()) {
    return (
      <Suspense fallback={null}>
        <AdminPanel />
      </Suspense>
    );
  }

  return (
    <div style={styles.root}>
      <Canvas
        camera={{ fov: 60, near: 0.1, far: 1500, position: [0, 0, -360] }}
        dpr={[1, 2]}
        // No `powerPreference: 'high-performance'` — Safari treats it as
        // a hard demand to switch to the discrete GPU and refuses the
        // WebGL context if it can't, so the whole scene fails to mount
        // (`getShaderPrecisionFormat()` returns null at init). Letting
        // the browser pick the GPU keeps Safari + iOS working; Chrome
        // and Firefox don't notice the difference for a scene this size.
        gl={{ antialias: true, alpha: false, failIfMajorPerformanceCaveat: false }}
        style={styles.canvas}
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
      <Crosshair />
      <ControlsHint />
      <CursorText />
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
};
