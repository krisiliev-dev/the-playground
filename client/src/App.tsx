/**
 * App — root component. Phase 1: just the cube environment.
 * The camera faces one wall directly.
 */

import { Suspense, useState, useCallback } from 'react';
import { Canvas } from '@react-three/fiber';
import { Preload } from '@react-three/drei';
import { World } from '@/components/scene';
import { LoadingScreen } from '@/components/ui';

export function App(): JSX.Element {
    const [isLoaded, setIsLoaded] = useState(false);

    const handleCreated = useCallback(() => {
        setIsLoaded(true);
    }, []);

    return (
        <div style={styles.root}>
            {!isLoaded && <LoadingScreen progress={0} />}

            <Canvas
                camera={{
                    fov: 60,
                    near: 0.1,
                    far: 100,
                    // Position inside the cube, looking at the front wall (negative Z)
                    position: [0, 0, 5],
                    rotation: [0, 0, 0],
                }}
                dpr={[1, 2]}
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