import { Suspense, lazy } from 'react';
import { Canvas } from '@react-three/fiber';
import { World } from '@/components/scene';
import { CursorText } from '@/components/overlay';

const AdminPanel = lazy(() =>
  import('@/components/admin/AdminPanel').then((m) => ({ default: m.AdminPanel })),
);

function isAdminRoute(): boolean {
  if (typeof window === 'undefined') return false;
  const params = new URLSearchParams(window.location.search);
  return params.get('admin') === '1';
}

export function App(): JSX.Element {
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
