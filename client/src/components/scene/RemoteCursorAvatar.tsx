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
import { RemotePresenceIndicator } from '@/multiplayer/RemotePresenceIndicator';
import { CASCADE_OVERLAY_LAYER } from './sceneLayers';
import { RENDER_ORDER_CURSOR_BODY, RENDER_ORDER_CURSOR_OUTLINE } from './renderOrder';

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

/** Body emissive — defaults to the cyan glow when no
 *  `cursor_color` prop is set. When the prop is set, the
 *  emissive *is* the cursor color so the visible glow changes
 *  alongside the dark base tint (otherwise a recoloured cursor
 *  still reads as cyan because the emissive dominates the
 *  perceived hue). */
const EMISSIVE_HEX = '#00ffcc';
const EMISSIVE_INTENSITY = 1.0;

/** Fallback when the entity's `cursor_color` prop is missing. */
const FALLBACK_BODY_COLOR = '#0a1a18';

interface RemoteCursorAvatarProps {
  entity: Entity;
}

export function RemoteCursorAvatar({ entity }: RemoteCursorAvatarProps): JSX.Element {
  // Per-player cursor swap (per ADR-009). When the admin sets
  // `cursor_model_url` on a player's props, that URL becomes the
  // glb the cursor renders with. Falls back to the built-in
  // model when unset, missing, or empty.
  const props = entity.props as {
    cursor_color?: string;
    cursor_model_url?: string;
  };
  const modelUrl =
    props.cursor_model_url && props.cursor_model_url.length > 0
      ? props.cursor_model_url
      : MODEL_URL;
  const { scene: sourceScene } = useGLTF(modelUrl) as unknown as { scene: Object3D };
  const groupRef = useRef<Group>(null);

  // The presence of an explicit `cursor_color` is the signal
  // we should *also* tint the emissive — that's what makes a
  // recoloured cursor actually look recoloured (vs the visible
  // cyan glow always winning). Default cursors keep the cyan
  // glow + dark teal base.
  const explicitColor = props.cursor_color;
  const bodyColor = explicitColor ?? FALLBACK_BODY_COLOR;
  const emissiveColor = explicitColor ?? '#00ffcc';

  // Per-entity instance: clone the scene tree (sharing geometry,
  // replacing materials), build outline shells, register the
  // CASCADE_OVERLAY_LAYER. Recomputed only when bodyColor changes
  // — re-cloning on every entity update would churn GPU
  // allocations and tank perf.
  const cloned = useMemo(
    () => buildCursorTree(sourceScene, bodyColor, emissiveColor),
    [sourceScene, bodyColor, emissiveColor],
  );

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

  // Two groups, both following the same interpolated position:
  //   - cursorGroupRef: gets position AND quaternion (and the
  //     0.03 scale chain), so the cursor mesh rotates with
  //     mouselook as expected.
  //   - presenceGroupRef: gets position only — no quaternion,
  //     no scale chain. The presence indicator (menu panel) is
  //     parented here so it stays at a stable world orientation
  //     while still travelling with the cursor as the player
  //     walks. Without this split, the indicator inherits the
  //     cursor's mouselook rotation and visibly jitters as the
  //     remote player turns their head.
  const presenceGroupRef = useRef<Group>(null);

  useFrame(() => {
    const group = groupRef.current;
    const presence = presenceGroupRef.current;
    const sampled = sampleSnapshot(entity.id, performance.now() - INTERP_DELAY_MS);
    if (sampled) {
      group?.position.set(sampled.position[0], sampled.position[1], sampled.position[2]);
      group?.quaternion.set(
        sampled.quaternion[0],
        sampled.quaternion[1],
        sampled.quaternion[2],
        sampled.quaternion[3],
      );
      presence?.position.set(sampled.position[0], sampled.position[1], sampled.position[2]);
      // Deliberately no quaternion on presence — that's the whole
      // point of the split.
    } else if (group) {
      const [px, py, pz] = entity.transform.position;
      group.position.set(px, py, pz);
      presence?.position.set(px, py, pz);
    }
  });

  return (
    <>
      <group ref={groupRef} scale={REMOTE_AVATAR_SCALE}>
        <primitive object={cloned} />
      </group>
      {/* Position-only group for third-person presence indicators
          (menu panel, etc.). Stays world-aligned while the cursor
          rotates with mouselook. No scale chain — child layouts
          author in world units rather than the cursor's pre-scale
          frame. */}
      <group ref={presenceGroupRef}>
        <RemotePresenceIndicator entity={entity} />
      </group>
    </>
  );
}

useGLTF.preload(MODEL_URL);

// ─── Helpers (pure-ish) ───────────────────────────────────────

/** Clone the GLB scene, replace mesh materials with our own
 *  body+outline pair, register cascade-overlay layer membership.
 *  Mutates the cloned tree.
 *
 *  Critical detail: the *local* `CursorAvatar` mutates the shared
 *  `useGLTF` cache on mount — it attaches its own outline shell
 *  and a 5×-scaled `inSceneBody` (cascade-overlay copy) as
 *  children of the source meshes. When we `clone(true)` the
 *  cached scene those children come along, so we end up with a
 *  giant white silhouette next to each remote cursor. We strip
 *  them by walking only the GLB's original first-level meshes
 *  (parent is NOT a Mesh) and removing any child Meshes from
 *  them before re-skinning. The local cursor isn't affected
 *  because it operates on the cached scene directly, not on
 *  this clone. */
export function buildCursorTree(
  source: Object3D,
  bodyColor: string,
  emissiveColor: string = EMISSIVE_HEX,
): Object3D {
  const root = source.clone(true);

  const bodyMaterial = new MeshStandardMaterial({
    color: new Color(bodyColor),
    emissive: new Color(emissiveColor),
    emissiveIntensity: EMISSIVE_INTENSITY,
    metalness: 0.4,
    roughness: 0.35,
    transparent: true,
    // depthWrite ON: remote cursors are world avatars, not UI
    // affordances — the depth buffer needs to know they exist
    // so Phase A of the portal cascade doesn't stencil-mark over
    // them. Without this, portals correctly occluded by the
    // cursor in world depth still draw their through-view *over*
    // the cursor in screen space, because Phase A consults wall
    // depth (the cursor never wrote its own).
    //
    // The local cursor uses depthWrite=false because it lives on
    // CURSOR_LAYER + CASCADE_OVERLAY_LAYER — both excluded from
    // Phase D pass 1 — so its missing depth never matters. Remote
    // cursors live on layer 0 (visible in main view via Phase 1)
    // and need the depth presence.
    depthWrite: true,
  });

  // Collect ONLY first-level GLB meshes — i.e. meshes whose
  // parent is not itself a Mesh. Anything deeper is something
  // CursorAvatar attached to the cached scene; we don't want it.
  const meshes: Mesh[] = [];
  root.traverse((obj) => {
    const mesh = obj as Mesh;
    if (!mesh.isMesh) {
      return;
    }
    const parent = mesh.parent;
    if (parent && (parent as Mesh).isMesh) {
      return;
    }
    meshes.push(mesh);
  });

  for (const mesh of meshes) {
    // Strip CursorAvatar's attached child meshes from the clone.
    // Iterate over a copy of `children` because `remove()` mutates
    // the array.
    const childMeshes = [...mesh.children].filter((c) => (c as Mesh).isMesh);
    for (const child of childMeshes) {
      mesh.remove(child);
    }

    mesh.material = bodyMaterial;
    mesh.renderOrder = RENDER_ORDER_CURSOR_BODY;
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
      // depthWrite ON for the same reason as the body: the
      // outline's halo pixels need to claim their depth so Phase A's
      // stencil mark doesn't fire over them and Phase D's through-
      // view doesn't paint over the silhouette. Halo depth is the
      // back-of-shell depth (slightly further than body, still well
      // in front of any wall), so the stencil mark correctly stays
      // out wherever the cursor occupies screen space. Body covers
      // the outline's interior anyway via render-order, so this
      // doesn't introduce visible artifacts.
      depthWrite: true,
    });
    const outline = new Mesh(outlineGeom, outlineMat);
    outline.position
      .copy(center)
      .add(new Vector3(size.x * OUTLINE_SHIFT_X_FRACTION, size.y * OUTLINE_SHIFT_Y_FRACTION, 0));
    outline.scale.setScalar(OUTLINE_SCALE);
    outline.renderOrder = RENDER_ORDER_CURSOR_OUTLINE;
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
