/**
 * World — the root 3D scene, stripped back to just the cube.
 * Phase 1: clean environment with grid walls and camera facing a wall.
 */

import { BoxEnvironment } from './BoxEnvironment';
import { WorldLighting } from './WorldLighting';

export function World(): JSX.Element {
    return (
        <>
            <WorldLighting />
            <BoxEnvironment />
        </>
    );
}