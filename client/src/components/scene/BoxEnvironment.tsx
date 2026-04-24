import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { BackSide, Raycaster, Vector3 } from 'three';
import type { IUniform, Mesh, ShaderMaterial, Vector3Tuple } from 'three';
import { GRID_MATERIAL_CONSTANTS, GridMaterial } from './GridMaterial';

interface BoxEnvironmentProps {
  dimensions: Vector3Tuple;
}

interface GridUniforms {
  u_time: IUniform<number>;
  u_anchor: IUniform<Vector3>;
  u_mouse: IUniform<Vector3>;
  u_mouseActive: IUniform<number>;
  u_rippleOrigin: IUniform<Vector3>;
  u_rippleTime: IUniform<number>;
}

const GRAB_THRESHOLD = 6.0;

export function BoxEnvironment({ dimensions }: BoxEnvironmentProps): JSX.Element {
  const meshRef = useRef<Mesh>(null);
  const matRef = useRef<ShaderMaterial>(null);
  const raycaster = useRef(new Raycaster());
  const anchor = useRef<Vector3 | null>(null);

  const { pointer, camera } = useThree();

  useFrame((state) => {
    if (!matRef.current || !meshRef.current) return;
    const uniforms = matRef.current.uniforms as unknown as GridUniforms;
    uniforms.u_time.value = state.clock.elapsedTime;

    raycaster.current.setFromCamera(pointer, camera);
    const hits = raycaster.current.intersectObject(meshRef.current);
    const hit = hits[0]?.point;

    if (!hit) {
      uniforms.u_mouseActive.value = 0;
      anchor.current = null;
      return;
    }

    if (!anchor.current) {
      anchor.current = snapToGrid(hit, GRID_MATERIAL_CONSTANTS.GRID_SPACING);
    }

    const pullDist = hit.distanceTo(anchor.current);

    if (pullDist > GRAB_THRESHOLD) {
      uniforms.u_rippleOrigin.value.copy(anchor.current);
      uniforms.u_rippleTime.value = state.clock.elapsedTime;
      uniforms.u_mouseActive.value = 0;
      anchor.current = null;
      return;
    }

    uniforms.u_anchor.value.copy(anchor.current);
    uniforms.u_mouse.value.copy(hit);
    uniforms.u_mouseActive.value = 1;
  });

  return (
    <mesh ref={meshRef}>
      <boxGeometry args={dimensions} />
      <GridMaterial ref={matRef} side={BackSide} />
    </mesh>
  );
}

function snapToGrid(point: Vector3, spacing: number): Vector3 {
  return new Vector3(
    Math.round(point.x / spacing) * spacing,
    Math.round(point.y / spacing) * spacing,
    Math.round(point.z / spacing) * spacing,
  );
}
