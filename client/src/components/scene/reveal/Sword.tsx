/**
 * Sword — Phase 4
 *
 * Loads Finn's Grass Sword GLTF and animates it through the reveal beat:
 *
 *   armed     → fades in from invisibility a few units in front of the
 *               portal, hilt-down (vertical), pointing at the wall.
 *   swinging  → arcs from a wind-up pose into the wall along -Z, with
 *               easing so the strike feels weighted.
 *   impact /  → snaps to a buried pose: hilt visible, blade sunk into
 *   revealed    the wall at the portal centre.
 *
 * The model has no animation tracks (verified at load time), so we drive
 * everything manually with `useFrame` + `Object3D` lerps. The GLTF
 * coordinate system is roughly Y-up, blade pointing +Y, so we rotate it
 * to align the blade tip toward -Z and use the hilt offset to keep the
 * tip at the portal plane on impact.
 */
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import { Box3, Group, Vector3 } from 'three';
import type { Object3D } from 'three';
import { useWorldStore } from '@/store';
import { PORTAL_CONSTANTS } from './Portal';

const SWORD_URL = '/models/sword/scene.gltf';

// Tuned offsets relative to the portal centre on the -Z wall.
// Z values: portal sits at -39.6; we approach from +Z toward it.
const POSE = {
  // Hidden: out of view above the portal, fading in.
  hidden: { pos: new Vector3(0, 8, -25), rot: new Vector3(0, 0, 0), opacity: 0 },
  // Wind-up: held high, pointing at portal, building tension.
  windup: { pos: new Vector3(2.5, 6, -22), rot: new Vector3(-0.7, 0.0, -0.8), opacity: 1 },
  // Mid-arc: sword passing through diagonal, blade tip leading toward wall.
  arc: { pos: new Vector3(0.5, 1.5, -32), rot: new Vector3(-1.4, 0.0, -0.3), opacity: 1 },
  // Impact / buried: blade sunk through portal centre, hilt above.
  buried: { pos: new Vector3(0, -2.0, -38.5), rot: new Vector3(-1.55, 0.0, 0.05), opacity: 1 },
} as const;

// How quickly we lerp between poses each frame. Higher = snappier.
const LERP_RATE = 4.5;

// Scale-down factor for the GLTF (it ships at ~80 units tall).
const SWORD_SCALE = 0.07;

interface SwordProps {
  /** Override the default load URL — handy for tests. */
  url?: string;
}

export function Sword({ url = SWORD_URL }: SwordProps): JSX.Element {
  const groupRef = useRef<Group>(null);
  const revealState = useWorldStore((s) => s.revealState);

  const gltf = useGLTF(url);

  // Track the elapsed time the current state has been active so we can
  // decide which target pose to lerp toward (e.g. "swinging" interpolates
  // wind-up → arc, then arc → buried).
  const stateEnteredAt = useRef<number>(0);
  const previousState = useRef(revealState);

  useEffect(() => {
    if (previousState.current !== revealState) {
      stateEnteredAt.current = performance.now() / 1000;
      previousState.current = revealState;
    }
  }, [revealState]);

  // Centre + scale the GLTF once on mount — the model ships off-origin.
  // We mutate the loaded scene directly; useGLTF caches the same scene
  // graph, so two Sword instances would conflict. That's fine here —
  // we mount exactly one.
  useEffect(() => {
    const root = gltf.scene;
    root.scale.setScalar(SWORD_SCALE);
    const box = new Box3().setFromObject(root);
    const center = box.getCenter(new Vector3());
    // The bounding box is already in scaled world units, so we subtract
    // the centre directly to bring the GLTF to the local origin.
    root.position.sub(center);
    // Make every mesh transparent so we can fade-in.
    root.traverse((obj: Object3D) => {
      const mesh = obj as Object3D & {
        material?: { transparent?: boolean; opacity?: number };
      };
      if (mesh.material && typeof mesh.material === 'object') {
        mesh.material.transparent = true;
        mesh.material.opacity = 0;
      }
    });
  }, [gltf.scene]);

  const targetPos = useMemo(() => new Vector3(), []);
  const targetRot = useMemo(() => new Vector3(), []);

  useFrame((state, delta) => {
    if (!groupRef.current) {return;}

    // Pick wind-up vs. arc based on how long we've been in `swinging`.
    let target: (typeof POSE)[keyof typeof POSE];
    const sinceEnter = state.clock.elapsedTime - stateEnteredAt.current;
    switch (revealState) {
      case 'idle':
        target = POSE.hidden;
        break;
      case 'armed':
        target = POSE.windup;
        break;
      case 'swinging':
        target = sinceEnter < 0.35 ? POSE.windup : POSE.arc;
        break;
      case 'impact':
      case 'revealed':
      default:
        target = POSE.buried;
        break;
    }

    targetPos.copy(target.pos);
    targetRot.copy(target.rot);

    const t = 1 - Math.exp(-LERP_RATE * delta);
    groupRef.current.position.lerp(targetPos, t);
    groupRef.current.rotation.x += (targetRot.x - groupRef.current.rotation.x) * t;
    groupRef.current.rotation.y += (targetRot.y - groupRef.current.rotation.y) * t;
    groupRef.current.rotation.z += (targetRot.z - groupRef.current.rotation.z) * t;

    // Fade-in opacity.
    const targetOpacity = target.opacity;
    gltf.scene.traverse((obj: Object3D) => {
      const mesh = obj as Object3D & {
        material?: { opacity?: number };
      };
      if (mesh.material && typeof mesh.material.opacity === 'number') {
        mesh.material.opacity += (targetOpacity - mesh.material.opacity) * t;
      }
    });
  });

  return (
    <group ref={groupRef} position={POSE.hidden.pos.toArray()}>
      <primitive object={gltf.scene} />
    </group>
  );
}

// Preload so the click → swing transition doesn't hitch on first GLTF parse.
useGLTF.preload(SWORD_URL);

export const SWORD_CONSTANTS = {
  IMPACT_POINT: new Vector3(0, 0, PORTAL_CONSTANTS.Z),
  SCALE: SWORD_SCALE,
} as const;
