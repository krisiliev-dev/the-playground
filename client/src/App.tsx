import { Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { World } from '@/components/scene';

export function App(): JSX.Element {
  return (
    <div style={styles.root}>
      <Canvas
        camera={{ fov: 60, near: 0.1, far: 100, position: [0, 0, 0] }}
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
        style={styles.canvas}
      >
        <Suspense fallback={null}>
          <World />
        </Suspense>
      </Canvas>
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
