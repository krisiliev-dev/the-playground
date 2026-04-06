/**
 * GridMaterial — a custom shader that renders a cyberpunk wireframe grid
 * with thin glowing lines and transparent space between.
 */

import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';

const vertexShader = /* glsl */ `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform float uTime;
  uniform float uGridScale;
  uniform vec3 uLineColor;
  uniform vec3 uBaseColor;

  varying vec2 vUv;

  void main() {
    // --- WAVE DISTORTION ---
    // Scale UVs first so the wave frequency relates to the grid size
    vec2 scaledUv = vUv * uGridScale;

    // Three overlapping waves for organic movement.
    // Each has different frequency (the multiplier on scaledUv)
    // and different speed/direction (the multiplier on uTime).
    
    // Wave offset for the Y axis — makes horizontal lines wavy
    float waveY = sin(scaledUv.x * 0.8 + uTime * 0.15) * 0.08;

    // Wave offset for the X axis — makes vertical lines wavy
    float waveX = sin(scaledUv.y * 0.8 - uTime * 0.15) * 0.08;

    // Apply the distortion to the scaled UVs before creating the grid
    vec2 distortedUv = scaledUv + vec2(waveX, waveY);

    // --- GRID CELLS (same logic as before, but on distorted coordinates) ---
    vec2 cell = fract(distortedUv);

    float distFromEdgeX = 1.0 - abs(cell.x - 0.5) * 2.0;
    float distFromEdgeY = 1.0 - abs(cell.y - 0.5) * 2.0;

    float lineX = smoothstep(0.96, 1.0, distFromEdgeX);
    float lineY = smoothstep(0.96, 1.0, distFromEdgeY);

    float line = max(lineX, lineY);

    // --- ANIMATION ---
    float pulse = 0.85 + 0.15 * sin(uTime * 0.8);
    float wave = 0.9 + 0.1 * sin(vUv.x * 20.0 + uTime * 0.3) *
                              sin(vUv.y * 20.0 - uTime * 0.2);

    // --- FINAL COLOUR ---
    vec3 color = uBaseColor;
    color = mix(color, uLineColor * pulse * wave, line * 0.7);
    color += uLineColor * 0.02;

    float alpha = line * 0.6 + 0.03;

    gl_FragColor = vec4(color, alpha);
  }
`;

/**
 * Component that renders the grid material.
 * Uses a raw ShaderMaterial instead of drei's shaderMaterial helper
 * so we can update uniforms reliably each frame.
 */
export function GridMaterial(): JSX.Element {
    const materialRef = useRef<THREE.ShaderMaterial>(null);

    // useMemo creates the uniforms object once and reuses it.
    // Without this, React would create new objects every render,
    // which would reset the shader's state.
    const uniforms = useMemo(
        () => ({
            uTime: { value: 0 },
            uGridScale: { value: 8.0 },
            uLineColor: { value: new THREE.Color('#00ffcc') },
            uBaseColor: { value: new THREE.Color('#12121a') },
        }),
        [],
    );

    // Update the time uniform every frame so animations run
    useFrame((state) => {
        if (materialRef.current) {
            materialRef.current.uniforms.uTime!.value = state.clock.elapsedTime;
        }
    });

    return (
        <shaderMaterial
            ref={materialRef}
            vertexShader={vertexShader}
            fragmentShader={fragmentShader}
            uniforms={uniforms}
            side={THREE.BackSide}
            transparent={true}
        />
    );
}