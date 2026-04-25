/**
 * CursorAvatar — a 3D object that replaces the OS cursor and "sticks" to
 * whichever cube wall the user's pointer is currently over.
 *
 * Behaviour (when `cursorAvatarActive` is true):
 *  1. Hides the system cursor via `document.body.style.cursor = 'none'`.
 *  2. Each frame, raycasts from the camera through the pointer's screen
 *     position; the first cube wall it hits is where the avatar lives.
 *  3. The avatar sits at the hit point, offset slightly toward the camera
 *     along the surface normal (~0.3u) to avoid z-fighting with the wall.
 *  4. Its local +Y aligns with the surface normal, so it visually "sticks"
 *     to the wall.
 *  5. Idle anim: subtle scale pulse + slow rotation around the up axis.
 *  6. Emissive cyan tint matches the rest of the cyberpunk-grid scene.
 *
 * When inactive, renders nothing and restores the system cursor.
 */
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import {
  Color,
  Group,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  Raycaster,
  Vector3,
} from 'three';
import { useWorldStore } from '@/store';

const MODEL_URL = '/models/cursor.glb';

/** Cube dimensions match the BoxEnvironment defaults — 80×80×80 inverted. */
const HALF_EXTENTS = new Vector3(40, 40, 40);

/** Push the avatar this far off the wall along the surface normal. */
const SURFACE_OFFSET = 0.3;

/** Idle pulse + spin tuning. */
const PULSE_AMPLITUDE = 0.08;
const PULSE_SPEED = 2.4;
const SPIN_SPEED = 0.6;
const BASE_SCALE = 0.6;

/** Cyan glow to match the grid + cursor-text. */
const EMISSIVE_HEX = '#00ffcc';
const EMISSIVE_INTENSITY = 1.2;

// Preload so the GLB is in cache by the time the user toggles the avatar.
useGLTF.preload(MODEL_URL);

export function CursorAvatar(): JSX.Element | null {
  const active = useWorldStore((s) => s.cursorAvatarActive);

  // While inactive, render nothing AND ensure the system cursor stays visible.
  // (The effect that toggles `body.style.cursor` is mounted with the component,
  //  so we let the host effect below handle that — see hideSystemCursor.)
  if (!active) {
    // Sibling effect needed even when inactive on first render — handled by
    // the always-mounted toggle below via a tiny inner component split.
    return <CursorVisibilityToggle active={false} />;
  }

  return (
    <>
      <CursorVisibilityToggle active={true} />
      <ActiveCursor />
    </>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────

/**
 * Tiny effect-only component so we can keep the system-cursor toggle
 * mounted regardless of `active`. Mounting/unmounting effects with the
 * outer component would still work, but splitting it makes the intent
 * clearer and avoids re-running the cleanup on every active flip.
 */
function CursorVisibilityToggle({ active }: { active: boolean }): null {
  useEffect(() => {
    if (!active) {return;}
    const previous = document.body.style.cursor;
    document.body.style.cursor = 'none';
    return () => {
      document.body.style.cursor = previous;
    };
  }, [active]);
  return null;
}

/**
 * The actual 3D avatar. Lives in its own component so that hooks like
 * `useGLTF` are only evaluated when the cursor is active.
 */
function ActiveCursor(): JSX.Element {
  const groupRef = useRef<Group>(null);
  const raycaster = useMemo(() => new Raycaster(), []);
  const tmpQuat = useMemo(() => new Quaternion(), []);
  const tmpUp = useMemo(() => new Vector3(0, 1, 0), []);
  const targetPos = useMemo(() => new Vector3(), []);
  const targetNormal = useMemo(() => new Vector3(0, 0, -1), []);

  const { scene: gltfScene } = useGLTF(MODEL_URL);

  // Clone the loaded scene so the cached gltf isn't mutated across renders.
  // For static (non-skinned) GLBs, three's recursive clone gives us a fresh
  // object hierarchy without sharing materials with the cached source.
  const cloned = useMemo<Object3D>(() => gltfScene.clone(true), [gltfScene]);

  // Swap each mesh's material for a cyan-emissive MeshStandardMaterial.
  useEffect(() => {
    cloned.traverse((child) => {
      if ((child as Mesh).isMesh) {
        const mesh = child as Mesh;
        const mat = new MeshStandardMaterial({
          color: new Color('#0a1a18'),
          emissive: new Color(EMISSIVE_HEX),
          emissiveIntensity: EMISSIVE_INTENSITY,
          metalness: 0.4,
          roughness: 0.35,
        });
        mesh.material = mat;
        mesh.castShadow = false;
        mesh.receiveShadow = false;
      }
    });
  }, [cloned]);

  const { pointer, camera } = useThree();

  useFrame((state) => {
    if (!groupRef.current) {return;}

    raycaster.setFromCamera(pointer, camera);

    // We're inside an inverted cube. Rather than depending on the mesh ref
    // (BoxEnvironment doesn't expose its mesh and may have its own raycast
    // overrides), intersect the camera ray against an axis-aligned cube
    // analytically. This is cheap and stable.
    const hit = intersectInsideCube(raycaster.ray.origin, raycaster.ray.direction, HALF_EXTENTS);
    if (!hit) {return;}

    targetPos.copy(hit.point).addScaledVector(hit.normal, SURFACE_OFFSET);
    targetNormal.copy(hit.normal);

    groupRef.current.position.copy(targetPos);

    // Align local +Y with the surface normal so the cursor "sticks" upward
    // out of the wall. Then add a slow yaw spin around that local up axis.
    tmpQuat.setFromUnitVectors(tmpUp, targetNormal);
    groupRef.current.quaternion.copy(tmpQuat);

    const t = state.clock.elapsedTime;
    groupRef.current.rotateOnAxis(tmpUp, (t * SPIN_SPEED) % (Math.PI * 2));

    // Idle scale pulse.
    const pulse = BASE_SCALE + Math.sin(t * PULSE_SPEED) * PULSE_AMPLITUDE;
    groupRef.current.scale.setScalar(pulse);
  });

  return (
    <group ref={groupRef}>
      <primitive object={cloned} />
    </group>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────

interface CubeHit {
  point: Vector3;
  normal: Vector3;
}

/**
 * Intersect a ray with the inside of an axis-aligned cube centered at the
 * origin with the given half-extents. Returns the first wall the ray exits
 * through, with a normal pointing inward (toward the origin / the camera).
 *
 * This avoids depending on BoxEnvironment's mesh ref and works even when
 * the camera is exactly at [0, 0, 0].
 */
function intersectInsideCube(
  origin: Vector3,
  direction: Vector3,
  half: Vector3,
): CubeHit | null {
  // Slab method: for each axis, compute t at which the ray crosses ±half.
  // The smallest positive t across all axes is the exit point.
  let bestT = Infinity;
  let axis: 0 | 1 | 2 = 0;
  let sign: 1 | -1 = 1;

  const o: [number, number, number] = [origin.x, origin.y, origin.z];
  const d: [number, number, number] = [direction.x, direction.y, direction.z];
  const h: [number, number, number] = [half.x, half.y, half.z];

  for (let i = 0 as 0 | 1 | 2; i < 3; i = (i + 1) as 0 | 1 | 2) {
    const oi = o[i] ?? 0;
    const di = d[i] ?? 0;
    const hi = h[i] ?? 0;
    if (Math.abs(di) < 1e-8) {continue;}
    const t1 = (hi - oi) / di;
    const t2 = (-hi - oi) / di;
    if (t1 > 0 && t1 < bestT) {
      bestT = t1;
      axis = i;
      sign = 1;
    }
    if (t2 > 0 && t2 < bestT) {
      bestT = t2;
      axis = i;
      sign = -1;
    }
  }

  if (!Number.isFinite(bestT)) {return null;}

  const point = new Vector3(
    origin.x + direction.x * bestT,
    origin.y + direction.y * bestT,
    origin.z + direction.z * bestT,
  );

  // Inward-facing normal: opposite of the wall's outward normal.
  const normal = new Vector3(0, 0, 0);
  if (axis === 0) {normal.x = -sign;}
  else if (axis === 1) {normal.y = -sign;}
  else {normal.z = -sign;}

  return { point, normal };
}
