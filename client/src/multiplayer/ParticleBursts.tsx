/**
 * Visual particle burst receiver — renders confetti / sparks /
 * fire / etc on inbound `particle_burst` SceneEvents.
 *
 * Two render modes:
 *
 *   1. **Point mode** (default — `model_url` not set):
 *      A `<points>` mesh with per-vertex colours from the
 *      event's palette. Cheap; supports up to ~500 particles
 *      per burst. Rendered as billboard points sized in pixels.
 *
 *   2. **Model mode** (`model_url` is a glb URL — typically
 *      from `/api/admin/assets`):
 *      An `<instancedMesh>` of the glb's first mesh, one
 *      instance per particle, each with its own per-frame
 *      matrix (position + rotation + scale). Tints the model's
 *      base colour by the per-particle palette pick. Caps at
 *      ~200 instances per burst.
 *
 * In both modes, per-particle state (position, velocity,
 * rotation, color) is initialised once on event arrival and
 * advanced each frame in `useFrame`. After `lifetime_ms`, the
 * burst self-removes from the active list. No wire chatter
 * after the initial broadcast — receivers run their own
 * deterministic-ish simulation.
 *
 * Mounted inside the canvas via `World.tsx`.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import {
  type BufferAttribute,
  type BufferGeometry,
  Color,
  type InstancedMesh as InstancedMeshT,
  type Material,
  type Mesh,
  MeshStandardMaterial,
  Object3D,
  type Points as PointsT,
  type PointsMaterial,
  Quaternion,
  Vector3,
  AdditiveBlending,
} from 'three';
import type { SceneEventOf } from './types';
import { useSceneEvent } from './sceneEvents';

type ParticleBurstEvent = SceneEventOf<'particle_burst'>;

interface ActiveBurst {
  id: number;
  event: ParticleBurstEvent;
  startedAt: number;
}

let nextId = 0;

export function ParticleBursts(): JSX.Element {
  const [active, setActive] = useState<ActiveBurst[]>([]);

  useSceneEvent('particle_burst', (event) => {
    nextId += 1;
    setActive((prev) => [
      ...prev,
      { id: nextId, event, startedAt: performance.now() / 1000 },
    ]);
  });

  // Sweep expired bursts. Each burst lives for `lifetime_ms`
  // seconds; once past, drop it from the active list so React
  // unmounts the rendering subtree.
  useFrame(() => {
    const now = performance.now() / 1000;
    setActive((prev) => {
      const next = prev.filter(
        (b) => now - b.startedAt < b.event.lifetime_ms / 1000,
      );
      return next.length === prev.length ? prev : next;
    });
  });

  return (
    <>
      {active.map((b) =>
        b.event.model_url ? (
          <ModelBurst key={b.id} event={b.event} startedAt={b.startedAt} />
        ) : (
          <PointBurst key={b.id} event={b.event} startedAt={b.startedAt} />
        ),
      )}
    </>
  );
}

interface BurstProps {
  event: ParticleBurstEvent;
  startedAt: number;
}

/** Initial per-particle state shared by both render modes:
 *  random velocity inside a cone (axis = world +Y, half-angle
 *  = `spread * π/2`) at a magnitude in `[0.5×, 1×] * speed`,
 *  plus a colour picked from the palette. Pure — keeps the
 *  rendering components thin. */
function seedParticles(
  event: ParticleBurstEvent,
): {
  positions: Float32Array;
  velocities: Float32Array;
  colors: Color[];
} {
  const positions = new Float32Array(event.count * 3);
  const velocities = new Float32Array(event.count * 3);
  const colors: Color[] = [];
  const palette = event.colors.map((hex) => new Color(hex));
  for (let i = 0; i < event.count; i++) {
    positions[i * 3] = event.position[0];
    positions[i * 3 + 1] = event.position[1];
    positions[i * 3 + 2] = event.position[2];
    // Cone-distributed direction: uniform around the +Y axis,
    // polar angle scaled by `spread`. spread=0 → straight up,
    // spread=1 → full sphere.
    const phi = Math.random() * Math.PI * 2;
    const theta = Math.random() * event.spread * Math.PI;
    const speedMag = event.speed * (0.5 + Math.random() * 0.5);
    velocities[i * 3] = speedMag * Math.sin(theta) * Math.cos(phi);
    velocities[i * 3 + 1] = speedMag * Math.cos(theta);
    velocities[i * 3 + 2] = speedMag * Math.sin(theta) * Math.sin(phi);
    colors.push(palette[Math.floor(Math.random() * palette.length)]!);
  }
  return { positions, velocities, colors };
}

/** Point-mode burst: GPU-rendered as billboard points with
 *  per-vertex colours. Cheapest path; preferred for most
 *  confetti-style bursts. */
function PointBurst({ event, startedAt }: BurstProps): JSX.Element {
  const pointsRef = useRef<PointsT>(null);
  const state = useMemo(() => seedParticles(event), [event]);

  // Pack the colour list into a Float32Array for the
  // bufferAttribute — `useMemo` keeps this stable so the
  // attribute reference doesn't churn each render.
  const colorsArray = useMemo(() => {
    const arr = new Float32Array(event.count * 3);
    for (let i = 0; i < event.count; i++) {
      const c = state.colors[i]!;
      arr[i * 3] = c.r;
      arr[i * 3 + 1] = c.g;
      arr[i * 3 + 2] = c.b;
    }
    return arr;
  }, [event.count, state.colors]);

  useFrame((_, delta) => {
    const points = pointsRef.current;
    if (!points) {
      return;
    }
    // Step every particle: position += velocity * dt; velocity.y -= gravity * dt.
    const pos = state.positions;
    const vel = state.velocities;
    for (let i = 0; i < event.count; i++) {
      const idx = i * 3;
      pos[idx]! += vel[idx]! * delta;
      pos[idx + 1]! += vel[idx + 1]! * delta;
      pos[idx + 2]! += vel[idx + 2]! * delta;
      vel[idx + 1]! -= event.gravity * delta;
    }
    const posAttr = points.geometry.attributes.position as BufferAttribute;
    posAttr.needsUpdate = true;

    // Linear opacity ramp 1 → 0 over the lifetime.
    const elapsed = performance.now() / 1000 - startedAt;
    const t = Math.max(0, Math.min(1, elapsed / (event.lifetime_ms / 1000)));
    const mat = points.material as PointsMaterial;
    mat.opacity = 1 - t;
  });

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          array={state.positions}
          count={event.count}
          itemSize={3}
        />
        <bufferAttribute
          attach="attributes-color"
          array={colorsArray}
          count={event.count}
          itemSize={3}
        />
      </bufferGeometry>
      <pointsMaterial
        size={event.size}
        vertexColors
        transparent
        opacity={1}
        sizeAttenuation={false}
        blending={AdditiveBlending}
        depthWrite={false}
      />
    </points>
  );
}

/** Model-mode burst: instanced glb. Each instance gets a
 *  random initial rotation, tumbles at the event's `spin`
 *  rate, and picks up gravity along world -Y. Tints the
 *  model's base material by the palette pick.
 *
 *  We assume the glb's first encountered mesh is the particle
 *  shape — most "confetti" / "spark" / "leaf" assets have a
 *  single mesh root, and this keeps the asset authoring
 *  surface trivial ("upload a glb of one piece"). */
function ModelBurst({ event, startedAt }: BurstProps): JSX.Element | null {
  // useGLTF requires a non-empty url — we already gated on
  // model_url in the parent, but TypeScript doesn't carry
  // that through, so re-narrow here.
  const url = event.model_url ?? '';
  const gltf = useGLTF(url);
  const meshRef = useRef<InstancedMeshT>(null);
  const state = useMemo(() => seedParticles(event), [event]);

  // Pull the first mesh out of the glb; share its geometry +
  // a cloned material across all instances. Cloning the
  // material is what makes the per-burst tint work without
  // mutating the cached glb's material.
  const { geometry, material } = useMemo(() => {
    let foundMesh: Mesh | null = null;
    gltf.scene.traverse((obj: Object3D) => {
      if (!foundMesh && (obj as Mesh).isMesh) {
        foundMesh = obj as Mesh;
      }
    });
    if (!foundMesh) {
      return { geometry: null, material: null };
    }
    const m = foundMesh as Mesh;
    const geom = m.geometry as BufferGeometry;
    let mat: Material;
    if (Array.isArray(m.material)) {
      mat = (m.material[0] as Material).clone();
    } else {
      mat = (m.material as Material).clone();
    }
    if (mat instanceof MeshStandardMaterial) {
      mat.transparent = true;
    }
    return { geometry: geom, material: mat };
  }, [gltf.scene]);

  // Per-instance rotational state. Each particle gets an
  // initial random orientation, a fixed random spin axis,
  // and animates `currentAngle += spin * dt` each frame.
  const rotState = useMemo(() => {
    const initialQuats: Quaternion[] = [];
    const spinAxes: Vector3[] = [];
    const currentAngles = new Float32Array(event.count);
    for (let i = 0; i < event.count; i++) {
      const q = new Quaternion();
      // Random initial orientation: pick a random axis +
      // angle and bake into the quat.
      const axis = new Vector3(
        Math.random() * 2 - 1,
        Math.random() * 2 - 1,
        Math.random() * 2 - 1,
      ).normalize();
      q.setFromAxisAngle(axis, Math.random() * Math.PI * 2);
      initialQuats.push(q);
      // Fixed spin axis per particle so tumbling reads as
      // coherent rotation, not jitter.
      const spinAxis = new Vector3(
        Math.random() * 2 - 1,
        Math.random() * 2 - 1,
        Math.random() * 2 - 1,
      ).normalize();
      spinAxes.push(spinAxis);
      currentAngles[i] = 0;
    }
    return { initialQuats, spinAxes, currentAngles };
  }, [event.count]);

  // Scratch reused per frame so we don't allocate inside the
  // inner loop.
  const scratch = useMemo(
    () => ({
      pos: new Vector3(),
      quat: new Quaternion(),
      scale: new Vector3(event.size, event.size, event.size),
      spinQ: new Quaternion(),
      tmpObj: new Object3D(),
    }),
    [event.size],
  );

  // Per-instance colour: drive material .color via per-frame
  // setColorAt. We seed colours once at mount.
  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) {
      return;
    }
    for (let i = 0; i < event.count; i++) {
      mesh.setColorAt(i, state.colors[i]!);
    }
    if (mesh.instanceColor) {
      mesh.instanceColor.needsUpdate = true;
    }
  }, [event.count, state.colors]);

  useFrame((_, delta) => {
    const mesh = meshRef.current;
    if (!mesh || !geometry) {
      return;
    }
    const elapsed = performance.now() / 1000 - startedAt;
    const lifeT = Math.max(0, Math.min(1, elapsed / (event.lifetime_ms / 1000)));
    const opacityNow = 1 - lifeT;

    const pos = state.positions;
    const vel = state.velocities;
    for (let i = 0; i < event.count; i++) {
      const idx = i * 3;
      // Step kinematics — same Euler integration as PointBurst.
      pos[idx]! += vel[idx]! * delta;
      pos[idx + 1]! += vel[idx + 1]! * delta;
      pos[idx + 2]! += vel[idx + 2]! * delta;
      vel[idx + 1]! -= event.gravity * delta;

      // Step rotation — initial quat, then add `spin * dt`
      // around a per-particle fixed axis.
      rotState.currentAngles[i]! += event.spin * delta;
      scratch.spinQ.setFromAxisAngle(
        rotState.spinAxes[i]!,
        rotState.currentAngles[i]!,
      );
      scratch.quat.copy(rotState.initialQuats[i]!).multiply(scratch.spinQ);

      scratch.pos.set(pos[idx]!, pos[idx + 1]!, pos[idx + 2]!);
      scratch.tmpObj.position.copy(scratch.pos);
      scratch.tmpObj.quaternion.copy(scratch.quat);
      scratch.tmpObj.scale.copy(scratch.scale);
      scratch.tmpObj.updateMatrix();
      mesh.setMatrixAt(i, scratch.tmpObj.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;

    // Material opacity ramp. Only one shared material, so the
    // ramp affects every instance uniformly — that's intended.
    if (material && 'opacity' in material) {
      (material as MeshStandardMaterial).opacity = opacityNow;
    }
  });

  if (!geometry || !material) {
    return null;
  }
  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, event.count]}
      frustumCulled={false}
    />
  );
}
