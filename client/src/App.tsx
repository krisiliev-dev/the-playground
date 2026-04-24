import { Suspense, lazy, useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import { World } from '@/components/scene';
import { CursorText } from '@/components/overlay';
import { useWorldStore } from '@/store';

const AdminPanel = lazy(() =>
  import('@/components/admin/AdminPanel').then((m) => ({ default: m.AdminPanel })),
);

function isAdminRoute(): boolean {
  if (typeof window === 'undefined') {return false;}
  const params = new URLSearchParams(window.location.search);
  return params.get('admin') === '1';
}

/**
 * Temporary keyboard trigger for the 3D cursor avatar (Phase 5).
 *
 * Press `C` to toggle. Ignores key events that originate from text inputs
 * so admins typing in the AdminPanel don't accidentally fire it.
 *
 * TODO(phase-4-merge): Replace this hook entirely. Once `feature/sword-portal`
 * lands, the avatar should activate when `revealState === 'revealed'` —
 * subscribe to that store slice here (or, better, drive `cursorAvatarActive`
 * directly from the sword-reveal completion side effect) and delete this
 * keyboard listener. Tracked at: src/App.tsx (this hook).
 */
function useTemporaryCursorAvatarHotkey(): void {
  const toggleCursorAvatar = useWorldStore((s) => s.toggleCursorAvatar);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      // Ignore typing in inputs / textareas / contenteditable — admins use
      // the AdminPanel at `?admin=1` and shouldn't toggle while typing.
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
  // TODO(phase-4-merge): see useTemporaryCursorAvatarHotkey above.
  useTemporaryCursorAvatarHotkey();

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
