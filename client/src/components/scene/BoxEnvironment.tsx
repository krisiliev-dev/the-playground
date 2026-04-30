import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { BackSide, DataTexture, Raycaster, Vector3 } from 'three';
import type { IUniform, Mesh, ShaderMaterial, Vector3Tuple } from 'three';
import { GRID_MATERIAL_CONSTANTS, GridMaterial } from './GridMaterial';
import { useWorldStore, type RevealState } from '@/store';

interface BoxEnvironmentProps {
  dimensions: Vector3Tuple;
}

interface GridUniforms {
  u_time: IUniform<number>;
  u_mouse: IUniform<Vector3>;
  u_caughtCount: IUniform<number>;
  u_releaseT: IUniform<number>;
  u_rippleOrigin: IUniform<Vector3>;
  u_rippleTime: IUniform<number>;
}

interface CaughtMaterialUserData {
  caughtData?: Float32Array;
  caughtTexture?: DataTexture;
}

/** Total duration of the rubber-band release (including wobble). */
const RELEASE_SECONDS = 1.0;

/**
 * Master switch for the cursor-catches-grid-lines effect. When false the
 * raycast/capture path is skipped, no segments are pushed, and the shader's
 * caught-mask loop runs zero iterations — the grid renders as the plain
 * pulsing wireframe. Flip back to true to restore the rubber-band behaviour.
 */
const LINES_CATCH_CURSOR = false;

interface CaughtSegment {
  axis: Vector3;
  along: Vector3;
  /** Outward wall normal at capture time — used by the shader to pin the
   *  segment to a single specific wall (not just "axis-aligned wall"). */
  wallNormal: Vector3;
  coord: number;
  segMin: number;
  segMax: number;
}

/**
 * Damped sinusoidal release. The first peak (`t = π/ω`) overshoots by
 * `e^(-bπ/ω)` past the rest line — i.e. flings the apex to the OPPOSITE
 * side of where the cursor was pulling, so the "snap back" reads clearly
 * even on lines that were only mildly bowed. b=2, ω=8 → ~46% overshoot,
 * ~1 visible oscillation per release window.
 */
function easeOutSpring(t: number): number {
  if (t <= 0) {
    return 0;
  }
  if (t >= 1) {
    return 1;
  }
  return 1 - Math.exp(-2 * t) * Math.cos(t * 8);
}

function inPlaneAxes(normal: Vector3): { u: Vector3; v: Vector3 } {
  const ax = Math.abs(normal.x);
  const ay = Math.abs(normal.y);
  const az = Math.abs(normal.z);
  if (ax > ay && ax > az) {
    return { u: new Vector3(0, 1, 0), v: new Vector3(0, 0, 1) };
  }
  if (ay > ax && ay > az) {
    return { u: new Vector3(1, 0, 0), v: new Vector3(0, 0, 1) };
  }
  return { u: new Vector3(1, 0, 0), v: new Vector3(0, 1, 0) };
}

export function BoxEnvironment({ dimensions }: BoxEnvironmentProps): JSX.Element {
  const meshRef = useRef<Mesh>(null);
  const matRef = useRef<ShaderMaterial>(null);
  const raycaster = useRef(new Raycaster());

  const caught = useRef<CaughtSegment[]>([]);
  const prevHit = useRef<Vector3 | null>(null);

  const releaseAt = useRef<number | null>(null);
  const pendingRelease = useRef(false);

  const { pointer, camera } = useThree();

  const revealState = useWorldStore((s) => s.revealState);
  const grabEnabled = revealState === 'idle';
  const prevReveal = useRef<RevealState>(revealState);

  useEffect(() => {
    // Defer the snap-back release until the sword actually sinks into
    // the wall (impact state) — not at click time.
    if (prevReveal.current !== 'impact' && revealState === 'impact') {
      pendingRelease.current = true;
    }
    prevReveal.current = revealState;
  }, [revealState]);

  useFrame((state) => {
    if (!matRef.current || !meshRef.current) {
      return;
    }
    const uniforms = matRef.current.uniforms as unknown as GridUniforms;
    uniforms.u_time.value = state.clock.elapsedTime;

    const userData = matRef.current.userData as CaughtMaterialUserData;
    const buffer = userData.caughtData;
    const texture = userData.caughtTexture;

    // ── Click happened — queue release ────────────────────────────
    if (pendingRelease.current) {
      pendingRelease.current = false;
      releaseAt.current = state.clock.elapsedTime;
      if (prevHit.current) {
        uniforms.u_rippleOrigin.value.copy(prevHit.current);
        uniforms.u_rippleTime.value = state.clock.elapsedTime;
      }
    }

    // ── Animate release ───────────────────────────────────────────
    if (releaseAt.current !== null) {
      const elapsed = state.clock.elapsedTime - releaseAt.current;
      if (elapsed >= RELEASE_SECONDS) {
        caught.current = [];
        uniforms.u_caughtCount.value = 0;
        uniforms.u_releaseT.value = 0;
        releaseAt.current = null;
      } else {
        uniforms.u_releaseT.value = easeOutSpring(elapsed / RELEASE_SECONDS);
      }
      return;
    }

    if (!grabEnabled) {
      // Reveal sequence is running. Keep the caught lines visible at
      // their last-pulled position (frozen u_mouse) until impact fires
      // pendingRelease above. Don't run the raycast/capture path.
      return;
    }

    if (!LINES_CATCH_CURSOR) {
      // Effect disabled — skip raycast + capture. u_caughtCount stays at
      // 0 so the shader's caught-mask loop is a no-op.
      return;
    }

    // ── Live capture: detect line crossings ───────────────────────
    raycaster.current.setFromCamera(pointer, camera);
    const hits = raycaster.current.intersectObject(meshRef.current);
    const hit = hits[0];
    if (!hit || !hit.face) {
      return;
    }

    // Convert the world-space hit to BOX-LOCAL space so the grid math
    // stays glued to the cube even while the cube bobs up and down.
    // For an axis-aligned, non-rotated cube, world↔local differ only by
    // a translation, so face normal is the same in either space.
    const localHit = meshRef.current.worldToLocal(hit.point.clone());
    const wallNormal = hit.face.normal;
    const { u: uAxis, v: vAxis } = inPlaneAxes(wallNormal);
    const spacing = GRID_MATERIAL_CONSTANTS.GRID_SPACING;

    const cursorU = uAxis.dot(localHit);
    const cursorV = vAxis.dot(localHit);

    if (prevHit.current) {
      // prevHit is already stored in box-local coords (we save localHit).
      const prevU = uAxis.dot(prevHit.current);
      const prevV = vAxis.dot(prevHit.current);
      const prevCellU = Math.floor(prevU / spacing);
      const currCellU = Math.floor(cursorU / spacing);
      const prevCellV = Math.floor(prevV / spacing);
      const currCellV = Math.floor(cursorV / spacing);

      // Only register crossings if the cursor was already on the same wall.
      // Compare in box-local — both prevHit and localHit are in that frame.
      const sameWall = prevHit.current.distanceTo(localHit) < spacing * 4;

      if (sameWall && prevCellU !== currCellU) {
        const dir = Math.sign(currCellU - prevCellU);
        let cell = prevCellU;
        while (cell !== currCellU) {
          const crossingU = (cell + (dir > 0 ? 1 : 0)) * spacing;
          pushCaught(caught.current, {
            axis: uAxis.clone(),
            along: vAxis.clone(),
            wallNormal: wallNormal.clone(),
            coord: crossingU,
            segMin: currCellV * spacing,
            segMax: (currCellV + 1) * spacing,
          });
          cell += dir;
        }
      }
      if (sameWall && prevCellV !== currCellV) {
        const dir = Math.sign(currCellV - prevCellV);
        let cell = prevCellV;
        while (cell !== currCellV) {
          const crossingV = (cell + (dir > 0 ? 1 : 0)) * spacing;
          pushCaught(caught.current, {
            axis: vAxis.clone(),
            along: uAxis.clone(),
            wallNormal: wallNormal.clone(),
            coord: crossingV,
            segMin: currCellU * spacing,
            segMax: (currCellU + 1) * spacing,
          });
          cell += dir;
        }
      }
    }

    prevHit.current = localHit.clone();

    // FIFO eviction at the loop cap.
    while (caught.current.length > GRID_MATERIAL_CONSTANTS.MAX_LOOP) {
      caught.current.shift();
    }

    // ── Write segments into the data texture ──────────────────────
    if (buffer && texture) {
      const list = caught.current;
      for (let i = 0; i < list.length; i++) {
        const seg = list[i];
        if (!seg) {
          continue;
        }
        const o = i * 12; // 3 pixels × 4 floats
        // Pixel 0: axis.xyz, coord
        buffer[o + 0] = seg.axis.x;
        buffer[o + 1] = seg.axis.y;
        buffer[o + 2] = seg.axis.z;
        buffer[o + 3] = seg.coord;
        // Pixel 1: along.xyz, segMin
        buffer[o + 4] = seg.along.x;
        buffer[o + 5] = seg.along.y;
        buffer[o + 6] = seg.along.z;
        buffer[o + 7] = seg.segMin;
        // Pixel 2: wallNormal.xyz, segMax
        buffer[o + 8] = seg.wallNormal.x;
        buffer[o + 9] = seg.wallNormal.y;
        buffer[o + 10] = seg.wallNormal.z;
        buffer[o + 11] = seg.segMax;
      }
      texture.needsUpdate = true;
      uniforms.u_caughtCount.value = list.length;
    }

    // u_mouse must be in BOX-LOCAL space because the shader's grid math
    // is in box-local. The wall mesh's worldToLocal does that conversion.
    uniforms.u_mouse.value.copy(localHit);
  });

  return (
    <mesh ref={meshRef}>
      <boxGeometry args={dimensions} />
      <GridMaterial ref={matRef} side={BackSide} />
    </mesh>
  );
}

/**
 * Add a caught segment to the list. ANY existing segment on the same
 * line (same wall + same axis + same coord) — whether adjacent, overlapping,
 * or with a gap between — gets merged with the new range. The result is
 * one V per grid line that spans from the lowest to the highest catch the
 * cursor has made on that line, with no rest-line ghosts in the gaps.
 */
function pushCaught(list: CaughtSegment[], seg: CaughtSegment): void {
  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    if (!s) {
      continue;
    }
    const sameLine =
      s.coord === seg.coord &&
      s.axis.equals(seg.axis) &&
      s.along.equals(seg.along) &&
      s.wallNormal.equals(seg.wallNormal);
    if (!sameLine) {
      continue;
    }

    s.segMin = Math.min(s.segMin, seg.segMin);
    s.segMax = Math.max(s.segMax, seg.segMax);
    return;
  }
  list.push(seg);
}
