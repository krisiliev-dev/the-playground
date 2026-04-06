/**
 * BoxEnvironment — the cube world with cyberpunk grid walls.
 *
 * Renders as an inverted box (BackSide) using our custom grid shader.
 * The camera is positioned to face one wall directly.
 */

import { GridMaterial } from './GridMaterial';

/** The cube dimensions: width, height, depth */
export const CUBE_SIZE: [number, number, number] = [20, 20, 20];

export function BoxEnvironment(): JSX.Element {
    return (
        <mesh>
            <boxGeometry args={CUBE_SIZE} />
            <GridMaterial />
        </mesh>
    );
}