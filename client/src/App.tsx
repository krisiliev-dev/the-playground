import { Suspense, lazy, useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import { World } from '@/components/scene';
import { CursorText } from '@/components/overlay';
import { useWorldStore } from '@/store';

const AdminPanel = lazy(() =>
  import('@/components/admin/AdminPanel').then((m) => ({ default: m.AdminPanel })),
);

function isAdminRoute(): boolean {
  if (typeof window === 'undefined') return false;
  const params = new URLSearchParams(window.location.search);
  return params.get('admin') === '1';
}

/**
 * Activate the Phase 5 cursor avatar once the Phase 4 reveal completes.
 * Reset to inactive if reveal is rolled back to idle (e.g. dev replay).
 */
function useAvatarFollowsReveal(): void {
  const revealState = useWorldStore((s) => s.revealState);
  const setCursorAvatarActive = useWorldStore((s) => s.setCursorAvatarActive);

  useEffect(() => {
    if (revealState === 'revealed') {
      setCursorAvatarActive(true);
    } else if (revealState === 'idle') {
      setCursorAvatarActive(false);
    }
  }, [revealState, setCursorAvatarActive]);
}

/**
 * Dev shortcut: press `C` to toggle the avatar regardless of reveal state.
 * Useful for previewing the avatar without playing the whole sequence.
 * Ignores events from text inputs so admin typing doesn't fire it.
 */
function useAvatarDevHotkey(): void {
  const toggleCursorAvatar = useWorldStore((s) => s.toggleCursorAvatar);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) return;
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
  useAvatarFollowsReveal();
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
        camera={{ fov: 60, near: 0.1, far: 500, position: [0, 0, 0] }}
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
        style={styles.canvas}
      >
        <color attach="background" args={['#0a0a12']} />
        <Suspense fallback={null}>
          <World />
        </Suspense>
      </Canvas>
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
