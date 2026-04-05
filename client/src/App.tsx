/**
 * App — the root component of Portfolio World.
 *
 * Renders an R3F Canvas (the 3D scene) with a DOM overlay (the HUD).
 * The Canvas uses Suspense to show a loading screen while assets load.
 *
 * Architecture:
 * ┌──────────────────────────────────┐
 * │  App                             │
 * │  ├── Canvas (WebGL)              │
 * │  │   └── Suspense                │
 * │  │       └── World (3D scene)    │
 * │  └── HUD (DOM overlay)           │
 * └──────────────────────────────────┘
 */

import { Suspense, useState, useCallback } from 'react';
import { Canvas } from '@react-three/fiber';
import { Preload } from '@react-three/drei';
import { World } from '@/components/scene';
import { HUD, LoadingScreen } from '@/components/ui';

export function App(): JSX.Element {
  const [isLoaded, setIsLoaded] = useState(false);

  const handleCreated = useCallback(() => {
    // Canvas is ready and WebGL context is initialized
    setIsLoaded(true);
  }, []);

  return (
    <div style={styles.root}>
      {/* Loading screen — visible until the Canvas fires onCreated */}
      {!isLoaded && <LoadingScreen progress={0} />}

      {/* The 3D scene */}
      <Canvas
        camera={{
          fov: 60,
          near: 0.1,
          far: 100,
          position: [0, 0, 5],
        }}
        dpr={[1, 2]} // Retina support, capped at 2x for performance
        gl={{
          antialias: true,
          alpha: false,
          powerPreference: 'high-performance',
        }}
        onCreated={handleCreated}
        style={styles.canvas}
      >
        <Suspense fallback={null}>
          <World />
          <Preload all />
        </Suspense>
      </Canvas>

      {/* 2D UI overlay on top of the 3D scene */}
      {isLoaded && <HUD />}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    position: 'fixed',
    inset: 0,
    overflow: 'hidden',
    backgroundColor: '#0a0a1a',
  },
  canvas: {
    width: '100%',
    height: '100%',
    display: 'block',
  },
};
