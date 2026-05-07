/**
 * RemoteCursorAvatar — renders one remote player as the actual
 * cursor GLB (matching the local cursor's silhouette), tinted by
 * the player's `cursor_color` prop, smoothly interpolated from
 * the snapshot buffer.
 *
 * Why it's separate from CursorAvatar:
 *   - CursorAvatar is the LOCAL cursor — it owns input handling,
 *     pointer-lock, audio cues, prediction, animation timelines,
 *     hover/press visual feedback, and a 1600-line render loop.
 *     None of that applies to a passive observer of someone else's
 *     transform.
 *   - This component is purely visual: load → clone → re-skin →
 *     drive position/quaternion from the interpolation buffer in
 *     useFrame. No input, no React state, no audio, no animation.
 *
 * Layers:
 *   - Layer 0 (default) so it renders in main view.
 *   - CASCADE_OVERLAY_LAYER so it ALSO renders through portals
 *     (Phase D of the cascade enables this layer on its vCam).
 *
 * Materials use depthTest=true: remote avatars should be properly
 * occluded by walls (unlike the local cursor, which is a UI
 * affordance always-on-top).
 */
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import {
  BackSide,
  Color,
  type Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  Vector3,
} from 'three';
import type { Entity } from '@/multiplayer/types';
import { INTERP_DELAY_MS, sampleSnapshot } from '@/multiplayer/snapshotInterpolation';
import { CASCADE_OVERLAY_LAYER } from './sceneLayers';

const MODEL_URL = '/models/3d_icon_cursor.glb';

/** Final world-space scale of the remote cursor mesh. Mirrors the
 *  local cursor's `AVATAR_SCALE` so a remote player viewed through
 *  a portal looks the same size as their own local self-view. */
const REMOTE_AVATAR_SCALE = 0.03;

/** Outline shell — mirrors the local cursor's silhouette halo so
 *  remote cursors are recognisable from a distance. */
const OUTLINE_SCALE = 1.06;
const OUTLINE_SHIFT_X_FRACTION = 0.012;
const OUTLINE_SHIFT_Y_FRACTION = 0.012;
const OUTLINE_COLOR_HEX = '#ffffff';

/** Body emissive — same cyan glow as local cursor. */
const EMISSIVE_HEX = '#00ffcc';
const EMISSIVE_INTENSITY = 1.0;

/** Fallback when the entity's `cursor_color` prop is missing. */
const FALLBACK_BODY_COLOR = '#0a1a18';

interface RemoteCursorAvatarProps {
  entity: Entity;
}

export function RemoteCursorAvatar({ entity }: RemoteCursorAvatarProps): JSX.Element {
  const { scene: sourceScene } = useGLTF(MODEL_URL) as unknown as { scene: Object3D };
  const groupRef = useRef<Group>(null);

  const bodyColor = (entity.props as { cursor_color?: string }).cursor_color ?? FALLBACK_BODY_COLOR;

  // Per-entity instance: clone the scene tree (sharing geometry,
  // replacing materials), build outline shells, register the
  // CASCADE_OVERLAY_LAYER. Recomputed only when bodyColor changes
  // — re-cloning on every entity update would churn GPU
  // allocations and tank perf.
  const cloned = useMemo(() => buildCursorTree(sourceScene, bodyColor), [sourceScene, bodyColor]);

  // Dispose the materials we allocated when this instance unmounts
  // or rebuilds. Geometry is shared with the source GLB, so the
  // cloned outline geometry is the only buffer we own and need to
  // dispose.
  useEffect(() => {
    return () => {
      cloned.traverse((obj) => {
        const mesh = obj as Mesh;
        if (mesh.isMesh) {
          disposeMaterial(mesh);
          // Outline meshes get their own (cloned) geometry; the
          // body meshes share the source geometry which the GLB
          // cache owns. Only dispose if this mesh's geometry is
          // marked as owned (we tag outlines below).
          if (mesh.userData.isOutlineShell === true) {
            mesh.geometry.dispose();
          }
        }
      });
    };
  }, [cloned]);

  useFrame(() => {
    const group = groupRef.current;
    if (!group) {
      return;
    }
    const sampled = sampleSnapshot(entity.id, performance.now() - INTERP_DELAY_MS);
    if (sampled) {
      group.position.set(sampled.position[0], sampled.position[1], sampled.position[2]);
      group.quaternion.set(
        sampled.quaternion[0],
        sampled.quaternion[1],
        sampled.quaternion[2],
        sampled.quaternion[3],
      );
    } else {
      const [px, py, pz] = entity.transform.position;
      group.position.set(px, py, pz);
    }
  });

  return (
    <group ref={groupRef} scale={REMOTE_AVATAR_SCALE}>
      <primitive object={cloned} />
    </group>
  );
}

useGLTF.preload(MODEL_URL);

// ─── Helpers (pure-ish) ───────────────────────────────────────

/** Clone the GLB scene, replace mesh materials with our own
 *  body+outline pair, register cascade-overlay layer membership.
 *  Mutates the cloned tree. */
function buildCursorTree(source: Object3D, bodyColor: string): Object3D {
  const root = source.clone(true);

  const bodyMaterial = new MeshStandardMaterial({
    color: new Color(bodyColor),
    emissive: new Color(EMISSIVE_HEX),
    emissiveIntensity: EMISSIVE_INTENSITY,
    metalness: 0.4,
    roughness: 0.35,
    transparent: true,
    // depthWrite off so the cursor doesn't pollute depth values
    // that downstream cascade passes consult; matches local cursor.
    depthWrite: false,
  });

  const meshes: Mesh[] = [];
  root.traverse((obj) => {
    const mesh = obj as Mesh;
    if (mesh.isMesh) {
      meshes.push(mesh);
    }
  });

  for (const mesh of meshes) {
    mesh.material = bodyMaterial;
    // Both main view (layer 0, default) and cascade through-views
    // (CASCADE_OVERLAY_LAYER) include this mesh.
    mesh.layers.enable(CASCADE_OVERLAY_LAYER);
    mesh.frustumCulled = false;

    // Outline shell — back-side enlarged copy. Same trick the local
    // cursor uses to produce a silhouette halo.
    const outlineGeom = mesh.geometry.clone();
    outlineGeom.computeBoundingBox();
    const center = new Vector3();
    const size = new Vector3();
    outlineGeom.boundingBox?.getCenter(center);
    outlineGeom.boundingBox?.getSize(size);
    outlineGeom.center();

    const outlineMat = new MeshBasicMaterial({
      color: new Color(OUTLINE_COLOR_HEX),
      side: BackSide,
      transparent: true,
      depthWrite: false,
    });
    const outline = new Mesh(outlineGeom, outlineMat);
    outline.position
      .copy(center)
      .add(new Vector3(size.x * OUTLINE_SHIFT_X_FRACTION, size.y * OUTLINE_SHIFT_Y_FRACTION, 0));
    outline.scale.setScalar(OUTLINE_SCALE);
    outline.layers.enable(CASCADE_OVERLAY_LAYER);
    outline.frustumCulled = false;
    outline.userData.isOutlineShell = true;
    mesh.add(outline);
  }

  return root;
}

function disposeMaterial(mesh: Mesh): void {
  const m = mesh.material;
  if (Array.isArray(m)) {
    for (const mat of m) {
      mat.dispose();
    }
  } else if (m) {
    m.dispose();
  }
}
