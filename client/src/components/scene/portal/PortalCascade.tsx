/**
 * PortalCascade — stencil-based recursive portal renderer.
 *
 * Replaces the previous FBO+clip-UV cascade. The stencil approach
 * draws each recursion level's geometry **with that level's vCam
 * projection at its actual world position**, so perspective shrinks
 * nested portals naturally — the iconic Portal-game tunnel that
 * FBO+clip-UV couldn't produce because of the screen-space sampling
 * collapse.
 *
 * Per-frame algorithm (priority-3 useFrame, runs after avatar-controller
 * camera updates and takes over from R3F's default render):
 *
 *   1. Clear color + depth + stencil.
 *   2. Render the full scene from mainCam, **excluding portal surface
 *      planes**. (Cube, cursor, portal rims all render normally here.)
 *   3. For each portal at depth 0, recursively:
 *      a. Stencil-mark the portal's region: write `stencilRef+1` to
 *         the stencil buffer where the portal's surface plane covers
 *         pixels that currently have `stencilRef`.
 *      b. Compute vCam from the chain math (same `virtualCameraPose`
 *         used by the old FBO cascade).
 *      c. Apply Lengyel oblique near-plane to vCam.
 *      d. Clear depth in the stencil region (otherwise existing
 *         depth from the parent level interferes with the through-
 *         view's z-test).
 *      e. Render scene from vCam, restricted to pixels where stencil
 *         equals `stencilRef+1`. Excludes portal surfaces (rims +
 *         cube + cursor render).
 *      f. Recurse into deeper levels with `stencilRef+1`.
 *      g. Decrement stencil to restore parent level.
 *
 * Portal surface plane = stencil mask only (never writes color/depth).
 * Portal rim cylinders = ordinary opaque geometry, drawn naturally
 * with vCam perspective at each recursion level.
 *
 * Bob compensation: portal endpoint coords are in cube-local frame;
 * we add the cube's bob offset to source/dest positions each frame
 * before computing virtual cameras and apply the same offset to the
 * surface mesh's `position.y`.
 */
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  AlwaysDepth,
  Color,
  DecrementStencilOp,
  DoubleSide,
  EqualStencilFunc,
  IncrementStencilOp,
  type InstancedMesh,
  KeepStencilOp,
  type Material,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  PerspectiveCamera,
  PlaneGeometry,
  Quaternion,
  Scene,
  ShaderMaterial,
  type StencilFunc,
  type StencilOp,
  Vector3,
  type Vector3Tuple,
  type WebGLRenderer,
} from 'three';
import {
  MAX_PORTAL_RECURSION,
  PORTAL_ENDPOINTS,
  getPaired,
  type PortalEndpoint,
} from '@/content/portals';
import { MAIN_CUBE_BOB } from '@/content/routes';
import { useWorldStore } from '@/store';
import { interactableHandlers } from '../Interactable';
import { floatOffset } from '../floatBob';
import {
  CASCADE_OVERLAY_LAYER,
  CURSOR_LAYER,
  PORTAL_LAYER,
  PORTAL_SURFACE_LAYER,
} from '../sceneLayers';
import { bobbedEndpoint, isOnActiveSide, virtualCameraPose } from './portalMath';
import {
  buildRimPalette,
  RIM_PARTICLE_BASE_SIZE,
  type RimParticle,
  respawnRimParticle,
} from './rimParticle';

interface PortalState {
  readonly endpoint: PortalEndpoint;
  /** Live ref to the stencil-only surface plane mesh, populated by
   *  the React render via callback. `null` until the mesh mounts. */
  meshRef: { current: Mesh | null };
  /** The stencil-only material for the surface plane. Stencil props
   *  are reconfigured per render pass in the cascade loop. */
  readonly surfaceMaterial: MeshBasicMaterial;
  /** Reused PerspectiveCamera, repointed each render with the
   *  appropriate (depth, portal) chain pose. */
  readonly vCam: PerspectiveCamera;
}

export function PortalCascade(): JSX.Element {
  const camera = useThree((s) => s.camera);

  // Per-portal state. Allocated once on mount; the surface materials
  // and vCams are reused across frames.
  const portalStates = useMemo<PortalState[]>(() => {
    const states: PortalState[] = [];
    for (const ep of PORTAL_ENDPOINTS) {
      const paired = getPaired(ep.id);
      if (!paired) {
        continue;
      }
      // The surface material is configured for stencil-only writes.
      // Stencil func/ref/op are mutated per pass during the cascade;
      // colorWrite + depthWrite stay false so the surface plane
      // never produces visible pixels or interferes with depth.
      //
      // `depthTest: false` is load-bearing for deep cascade levels.
      // The stencil mark is supposed to be a *screen-region selector*
      // — "where does this portal project on the framebuffer?" — not
      // a depth-occlusion query. With depthTest=true, scene geometry
      // closer to the cascade's parentCam (e.g. the *other* portal's
      // rim particles, which become foreground objects relative to
      // the surface plane at deep recursion levels) blocks surface_A
      // by depth-LESS and the stencil never gets marked. The
      // through-view then renders nothing where the rim was, which
      // visually looks like "interior of the nested portal goes
      // black." The mark pass writes no color or depth either way
      // (`colorWrite: false`, `depthWrite: false`), so disabling
      // depth-test here is safe — depth-occlusion semantics for the
      // through-view itself belong to Phase D's scene render, which
      // continues to depth-test scene geometry normally.
      const surfaceMaterial = new MeshBasicMaterial({
        side: DoubleSide,
        colorWrite: false,
        depthWrite: false,
        depthTest: false,
        stencilWrite: true,
        stencilFunc: EqualStencilFunc,
        stencilRef: 0,
        stencilFuncMask: 0xff,
        stencilWriteMask: 0xff,
        stencilFail: KeepStencilOp,
        stencilZFail: KeepStencilOp,
        stencilZPass: IncrementStencilOp,
      });
      states.push({
        endpoint: ep,
        meshRef: { current: null },
        surfaceMaterial,
        vCam: new PerspectiveCamera(),
      });
    }
    return states;
  }, []);

  // Dispose surface materials on unmount.
  useEffect(() => {
    return () => {
      for (const state of portalStates) {
        state.surfaceMaterial.dispose();
      }
    };
  }, [portalStates]);

  // Main camera needs PORTAL_LAYER (for rims), CURSOR_LAYER (for the
  // cursor), and PORTAL_SURFACE_LAYER (for stencil marking) enabled.
  useEffect(() => {
    if (camera.layers && typeof camera.layers.enable === 'function') {
      camera.layers.enable(PORTAL_LAYER);
      camera.layers.enable(CURSOR_LAYER);
      camera.layers.enable(PORTAL_SURFACE_LAYER);
    }
  }, [camera]);

  // The cascade — runs at priority 3 to take over from R3F's default
  // render loop AND run after AvatarCursor's camera update (priority
  // 2). Without the priority-3 placement, AvatarCursor's mid-frame
  // camera changes (e.g. portal-walk teleport) wouldn't reach the
  // cascade's render pass until the *next* frame, producing a one-
  // frame rubber-band visible on every teleport.
  useFrame((state) => {
    const gl = state.gl;
    const mainCam = state.camera as PerspectiveCamera;
    const sceneRef = state.scene;
    const time = state.clock.elapsedTime;

    if (portalStates.length === 0) {
      // No portals — fall back to a default render.
      gl.setRenderTarget(null);
      gl.render(sceneRef, mainCam);
      return;
    }

    const bobY = floatOffset(time, MAIN_CUBE_BOB);

    // Bob-compensate surface meshes (the rims are bob-compensated as
    // children of the portal mesh, so updating the parent suffices).
    for (const ps of portalStates) {
      const mesh = ps.meshRef.current;
      if (mesh) {
        mesh.position.y = ps.endpoint.position[1] + bobY;
      }
    }

    // Take manual control of clearing and rendering.
    const prevAutoClear = gl.autoClear;
    gl.autoClear = false;
    gl.setRenderTarget(null);

    // Clear all three buffers to known state. Three.js's
    // WebGLRenderer.setClearColor sets the clear value; the actual
    // clear happens in `gl.clear(...)`. clearStencil/clearDepth aren't
    // exposed on the renderer wrapper, so we set them via the
    // underlying gl context.
    const ctx = gl.getContext();
    gl.setClearColor(0x0a0a12, 1.0);
    ctx.clearStencil(0);
    ctx.clearDepth(1.0);
    gl.clear(true, true, true);

    // Collect the set of portal-surface materials so the scene
    // traversal helpers can skip them (those materials have specific
    // stencil ops set by the cascade phases below; the helpers should
    // not overwrite them).
    const portalSurfaceMats = new Set<Material>();
    for (const ps of portalStates) {
      portalSurfaceMats.add(ps.surfaceMaterial);
    }

    // ===== Phase 1: render scene without portal surfaces =====
    // Disable stencil on all (non-portal-surface) materials so they
    // render normally without any stencil masking.
    setSceneStencilDisabled(sceneRef, portalSurfaceMats);
    mainCam.layers.disable(PORTAL_SURFACE_LAYER);
    gl.render(sceneRef, mainCam);
    mainCam.layers.enable(PORTAL_SURFACE_LAYER);

    // ===== Phase 2: recursive stencil portal rendering =====
    for (const ps of portalStates) {
      drawPortalRecursive(
        gl,
        sceneRef,
        mainCam,
        ps,
        portalStates,
        /* depth */ 0,
        /* stencilRef */ 0,
        bobY,
        portalSurfaceMats,
      );
    }

    // Restore stencil-disabled state on all scene materials so the
    // upcoming cursor pass renders unmasked.
    setSceneStencilDisabled(sceneRef, portalSurfaceMats);

    // ===== Phase 3: render cursor on top, ignoring portal stencil =====
    // The cursor avatar uses `depthTest: false` and high renderOrder
    // because it's a foreground UI affordance — it should always be
    // visible to the player regardless of scene composition. Phase 2
    // overwrote color in portal stencil regions, so the original
    // cursor pixels at mainCam projection are gone wherever they
    // intersect a portal frame. Re-rendering only CURSOR_LAYER from
    // mainCam restores the cursor on top of everything (the
    // through-view's own internal cursor stays inside its portal
    // frame, drawn during Phase 2).
    mainCam.layers.set(CURSOR_LAYER);
    gl.render(sceneRef, mainCam);
    // Restore mainCam's full layer set for the next frame's Phase 1.
    mainCam.layers.set(0);
    mainCam.layers.enable(CURSOR_LAYER);
    mainCam.layers.enable(PORTAL_LAYER);
    mainCam.layers.enable(PORTAL_SURFACE_LAYER);

    gl.autoClear = prevAutoClear;
  }, 3);

  return (
    <>
      {portalStates.map((state) => (
        <PortalMesh
          key={state.endpoint.id}
          endpoint={state.endpoint}
          material={state.surfaceMaterial}
          meshRef={state.meshRef}
        />
      ))}
    </>
  );
}

/**
 * Draw one portal at one recursion level. Marks the portal's stencil
 * region, renders the through-view inside it, recurses for nested
 * portals, then decrements stencil to restore the parent level.
 */
function drawPortalRecursive(
  gl: WebGLRenderer,
  scene: Scene,
  parentCam: PerspectiveCamera,
  ps: PortalState,
  allPortals: ReadonlyArray<PortalState>,
  depth: number,
  stencilRef: number,
  bobY: number,
  portalSurfaceMats: Set<Material>,
): void {
  if (depth >= MAX_PORTAL_RECURSION) {
    return;
  }

  const mesh = ps.meshRef.current;
  if (!mesh) {
    return;
  }

  // Sidedness gate (top-level only): a single-sided portal viewed
  // from its inactive side has no through-view — looking through the
  // back of the portal should reveal whatever's behind it in the
  // main scene (the cube interior), not the back-zone leak that
  // unclipped through-view rendering produces. Skipping all phases
  // here leaves Phase 1's main-scene render intact at the portal's
  // screen extent (the cube interior shows through where the portal
  // surface plane is excluded from rendering anyway).
  //
  // We only check at depth 0 because deeper recursion levels' vCams
  // are constructed by `virtualCameraPose` to look at their dest
  // portal — the source portal is *behind* the vCam at that point,
  // making the inactive-side check meaningless. Plus the through-
  // view from a nested level intentionally reflects the source's
  // active-side view regardless of mainCam's facing.
  if (depth === 0 && ps.endpoint.sidedness === 'single') {
    // Bob compensation: portal endpoints are authored in cube-local
    // coords; the cube bobs ±bobY in world Y each frame. Compare the
    // camera's world position against a bob-shifted endpoint by
    // un-shifting the camera's Y instead — equivalent and avoids
    // allocating a synthesized endpoint every frame.
    const camPos = {
      x: parentCam.position.x,
      y: parentCam.position.y - bobY,
      z: parentCam.position.z,
    };
    if (!isOnActiveSide(camPos, ps.endpoint)) {
      return;
    }
  }

  // CRITICAL: snapshot `parentCam`'s pose+projection at function
  // ENTRY — before Phase B mutates `ps.vCam`. At depth ≥ 1, Phase E
  // passed `ps.vCam` as the recursive call's `parentCam`, so
  // `parentCam === ps.vCam` at this level. Phase B's
  // `computeChainPose(ps, ...)` rewrites `ps.vCam.position` /
  // `.quaternion` / `.projectionMatrix` in place — which (because
  // they alias) also rewrites `parentCam`. Without this snapshot,
  // Phase F (which uses `parentCam`) would render the stencil
  // decrement using vCam_N's view of surface_A, not vCam_{N-1}'s —
  // a different screen rectangle than Phase A incremented. Result:
  // stencil residue (Phase F never decrements R_N in the right
  // place, so deep recursion levels accumulate wrong stencil values
  // and downstream Phase D's mask the wrong pixels — manifesting as
  // intermediate cascade levels rendering black while only the
  // deepest level (which has no Phase E sub-recursion to corrupt
  // state) still renders correctly).
  // At depth 0, parentCam is mainCam (a different object than
  // ps.vCam), so the snapshot is a no-op — backupPos === current
  // mainCam.position, restore copies it back unchanged.
  const backupPos = parentCam.position.clone();
  const backupQuat = parentCam.quaternion.clone();
  const backupProj = parentCam.projectionMatrix.clone();
  const backupProjInv = parentCam.projectionMatrixInverse.clone();

  // ===== Phase A: stencil-mark this portal's region =====
  // Write stencilRef+1 where stencil equals stencilRef AND the
  // surface plane covers a pixel. Other portals' surfaces are hidden
  // so only this one contributes. `needsUpdate = true` is required —
  // removing it (an attempted optimisation) broke Phase A's stencil
  // write entirely and produced empty cutouts at every level.
  ps.surfaceMaterial.stencilFunc = EqualStencilFunc;
  ps.surfaceMaterial.stencilRef = stencilRef;
  ps.surfaceMaterial.stencilZPass = IncrementStencilOp;
  ps.surfaceMaterial.needsUpdate = true;

  for (const other of allPortals) {
    if (other === ps) {
      continue;
    }
    const m = other.meshRef.current;
    if (m) {
      m.visible = false;
    }
  }
  parentCam.layers.set(PORTAL_SURFACE_LAYER);
  gl.render(scene, parentCam);
  // Restore camera layers + visibility.
  parentCam.layers.set(0);
  parentCam.layers.enable(CURSOR_LAYER);
  parentCam.layers.enable(PORTAL_LAYER);
  parentCam.layers.enable(PORTAL_SURFACE_LAYER);
  for (const other of allPortals) {
    const m = other.meshRef.current;
    if (m) {
      m.visible = true;
    }
  }

  // ===== Phase B: compute vCam for this portal at this depth =====
  computeChainPose(ps, parentCam, bobY);

  // ===== Phase C: clear depth in stencil region =====
  // Without this, depth values from the parent level (which are in
  // mainCam's eye space, not vCam's) would interfere with the
  // through-view's z-test. We render a fullscreen quad at far depth,
  // depth-write enabled, color-write disabled, only where stencil
  // equals stencilRef+1.
  clearDepthInStencilRegion(gl, stencilRef + 1);

  // ===== Phase D: render through-view from vCam =====
  // Configure all (non-portal-surface) materials in the scene with
  // stencil test EQUAL (stencilRef+1), op KEEP. Three.js's
  // setMaterial DISABLES the stencil test for materials with
  // stencilWrite=false, so directly setting gl state isn't enough —
  // we have to set stencilWrite=true on every material we want
  // masked, with the right func/ref/op.
  setSceneStencilTest(scene, EqualStencilFunc, stencilRef + 1, KeepStencilOp, portalSurfaceMats);

  ps.vCam.layers.set(0);
  ps.vCam.layers.enable(PORTAL_LAYER);
  // CASCADE_OVERLAY_LAYER excluded from this pass — objects on it
  // (the in-scene cursor copy + route-content text) need to render
  // AFTER Phase E so they survive the inner recursion's overwrite of
  // R_{N+1}. See Phase D2 below for the post-recursion render.
  // PORTAL_SURFACE_LAYER excluded — surfaces would draw stencil-only
  // here, polluting the recursion. We render them explicitly per
  // portal in the recursive call.
  // CURSOR_LAYER (main-view always-on-top cursor) excluded too — it
  // would draw over closer geometry like the pink rim and break the
  // through-view's depth ordering. Phase 3 renders the main-view
  // cursor separately on top of the whole frame.

  gl.render(scene, ps.vCam);

  // ===== Phase E: recurse into the paired portal at next depth =====
  // We only recurse into ps.endpoint.pairedWith — the portal whose
  // mesh is centered in vCam's view by construction (vCam looks
  // straight at it). Recursing into all portals would be exponential
  // in cycle length and also redundant: in the through-view, the
  // OTHER portals (non-paired) are at the periphery, not what the
  // nested tunnel level focuses on.
  //
  // The parentCam snapshot was taken at function entry (above) so
  // it captured the original parentCam pose before Phase B mutated
  // it via the ps.vCam alias. After recursion, the restore (below)
  // returns parentCam to that original pose so Phase F renders the
  // stencil decrement at the same screen region Phase A incremented.

  // Recurse with the SAME `ps`, not the paired one. This is the key
  // structural detail that produces the iconic "look through portal A
  // and see portal A nested inside, smaller, repeating" tunnel for
  // face-to-face paired portals.
  //
  // Why same-`ps`: at level N+1 we want to render the through-view
  // through portal A *again* (since portal A is visible inside
  // vCam_N's view at a smaller screen extent). vCam_{N+1} =
  // T_AB(vCam_N) — same transform applied repeatedly — strictly
  // increases distance from the cube each level (Δx = 300 per level
  // along the A-B axis), so each successive vCam sees the cube and
  // both portals at progressively further distance. That distance
  // accumulation is what perspective-shrinks the nested portal in
  // the rendered image, producing the visible tunnel.
  //
  // The earlier "recurse into paired" behaviour gave
  // `T_BA(T_AB(x)) = x` (paired transforms are inverses of each
  // other), so the chain alternated between exactly two camera poses
  // with no perspective accumulation — no tunnel.
  //
  // Sidedness gate handled at depth 0 in `drawPortalRecursive`'s
  // entry; deeper recursion levels assume the gate already passed.
  drawPortalRecursive(
    gl,
    scene,
    ps.vCam,
    ps,
    allPortals,
    depth + 1,
    stencilRef + 1,
    bobY,
    portalSurfaceMats,
  );

  // Restore parentCam to its pre-recursion state.
  parentCam.position.copy(backupPos);
  parentCam.quaternion.copy(backupQuat);
  parentCam.projectionMatrix.copy(backupProj);
  parentCam.projectionMatrixInverse.copy(backupProjInv);
  parentCam.updateMatrixWorld();

  // ===== Phase D2: render CASCADE_OVERLAY_LAYER from this level =====
  // After the inner recursion overwrote R_{N+1} ⊂ R_N with deeper
  // levels' content, re-render anything on CASCADE_OVERLAY_LAYER
  // (the in-scene cursor copy, route-content text) from THIS level's
  // vCam. This is what makes the cursor + centered text visible at
  // every cascade level instead of only the deepest — see
  // sceneLayers.ts for the geometric rationale. The recursion runs
  // depth-first (innermost completes first, outermost last), so for
  // objects whose screen projection overlaps R_{N+1}, the OUTER
  // level's perspective wins — that's the "I see my cursor through
  // the portal" semantics.
  //
  // Inner levels' Phase D pass 1 may have mutated scene materials'
  // stencilFunc to deeper values (stencilRef+2, +3, …). Re-call
  // setSceneStencilTest so materials test against THIS level's
  // stencil mask (stencilRef+1 = R_N).
  setSceneStencilTest(scene, EqualStencilFunc, stencilRef + 1, KeepStencilOp, portalSurfaceMats);
  ps.vCam.layers.set(CASCADE_OVERLAY_LAYER);
  // Mutating the depth-clear material's stencilRef here would be
  // wrong — depth IS the depth left by the inner recursion's Phase D
  // (cube wall depth from vCam_{N+1}'s render). The overlay objects
  // depth-test against that. The cursor's in-scene material has
  // depthTest=true, depthWrite=false; troika text similarly tolerates
  // existing depth.
  gl.render(scene, ps.vCam);

  // ===== Phase F: decrement stencil to restore parent level =====
  ps.surfaceMaterial.stencilFunc = EqualStencilFunc;
  ps.surfaceMaterial.stencilRef = stencilRef + 1;
  ps.surfaceMaterial.stencilZPass = DecrementStencilOp;
  ps.surfaceMaterial.needsUpdate = true;

  for (const other of allPortals) {
    if (other === ps) {
      continue;
    }
    const m = other.meshRef.current;
    if (m) {
      m.visible = false;
    }
  }
  parentCam.layers.set(PORTAL_SURFACE_LAYER);
  gl.render(scene, parentCam);
  parentCam.layers.set(0);
  parentCam.layers.enable(CURSOR_LAYER);
  parentCam.layers.enable(PORTAL_LAYER);
  parentCam.layers.enable(PORTAL_SURFACE_LAYER);
  for (const other of allPortals) {
    const m = other.meshRef.current;
    if (m) {
      m.visible = true;
    }
  }
}

/**
 * Compute the virtual camera pose for portal `ps` at recursion
 * `depth` by applying the source→dest portal transform to
 * parentCam. paired-portal R₁₈₀_Y math; same as `teleportPose`
 * but for the full pose (preserving pitch/roll).
 *
 * For the cascade to produce a visible tunnel from face-to-face
 * paired portals, the recursion in Phase E must keep the same
 * `ps` at each level (not switch to the paired portal). With
 * same-`ps` recursion, the chain becomes `T_AB(T_AB(T_AB(...)))`
 * — repeated application of one transform — which strictly
 * increases distance along the source-dest axis each level. The
 * old behavior of "recurse with paired" gave `T_BA(T_AB(x)) = x`
 * (inverse-pair cancellation), collapsing recursion to 2-pose
 * alternation.
 */
function computeChainPose(ps: PortalState, parentCam: PerspectiveCamera, bobY: number): void {
  const endpoint = ps.endpoint;
  const paired = getPaired(endpoint.id);
  if (!paired) {
    return;
  }

  const source = bobbedEndpoint(endpoint, bobY);
  const dest = bobbedEndpoint(paired, bobY);

  const stepped = virtualCameraPose(
    {
      x: parentCam.position.x,
      y: parentCam.position.y,
      z: parentCam.position.z,
    },
    {
      x: parentCam.quaternion.x,
      y: parentCam.quaternion.y,
      z: parentCam.quaternion.z,
      w: parentCam.quaternion.w,
    },
    source,
    dest,
  );

  ps.vCam.position.set(stepped.position.x, stepped.position.y, stepped.position.z);
  ps.vCam.quaternion.set(
    stepped.quaternion.x,
    stepped.quaternion.y,
    stepped.quaternion.z,
    stepped.quaternion.w,
  );

  // No back-zone clipping: copy parentCam's projection unchanged.
  //
  // Multiple attempts at clipping (Lengyel oblique near-plane and
  // direct m[10] / m[14] near-plane shift) consistently broke the
  // through-view rendering for one of the two paired portals. The
  // cube's GridMaterial shader interacts poorly with a non-default
  // projection matrix in stencil-masked render passes.
  //
  // For our test scene this is acceptable because the back-zone —
  // the volume between vCam and the dest plane — is empty for both
  // portal directions, so there's nothing to clip. If a future scene
  // adds geometry between paired portals, reintroduce clipping via
  // Three.js's `material.clippingPlanes` (which uses gl_ClipDistance
  // and doesn't disturb the projection matrix). `dest` is unused
  // today; the parameter is retained on the signature for symmetry
  // with `source` and so a future clipping path doesn't have to
  // re-thread it.
  void dest;

  // Inherit fov/aspect/near from the main camera, but extend the far
  // plane far enough that deep recursion levels can still see the
  // cube. The cascade chain `T_AB^N(mainCam)` moves the vCam another
  // (B − A) units along the A-B axis at each level — for our config
  // (300 unit separation) that's 300 units per level. With the
  // default far plane of 2000, vCam at level ~5 is far enough that
  // the cube's back wall sits beyond `far` and gets clipped, so the
  // through-view renders empty (the GL clear color shows through and
  // the user sees a "black portal" at the deepest visible level).
  // 50,000 keeps geometry visible to ~level 165 — well past where
  // perspective shrinkage makes deeper levels sub-pixel anyway.
  ps.vCam.fov = parentCam.fov;
  ps.vCam.aspect = parentCam.aspect;
  ps.vCam.near = parentCam.near;
  ps.vCam.far = PORTAL_VCAM_FAR;
  ps.vCam.updateProjectionMatrix();
  ps.vCam.updateMatrixWorld();
}

/** Far plane for cascade virtual cameras. Larger than the main
 *  camera's default so deep recursion levels — which place the vCam
 *  hundreds-to-thousands of units from the cube — can still see the
 *  scene. See `computeChainPose` for the rationale. */
const PORTAL_VCAM_FAR = 50000;

/**
 * Clear the depth buffer in pixels where stencil equals `ref` by
 * rendering a fullscreen quad at z=1 (far) with depth-function
 * ALWAYS, color-write disabled, and stencil test EQUAL ref. Only
 * the masked region's depth gets reset to far; depth elsewhere is
 * preserved.
 *
 * `gl.clear` with the depth bit ignores stencil test (per WebGL
 * spec — only scissor and pixel ownership tests affect clears), so
 * a fullscreen quad is the standard workaround.
 */
function clearDepthInStencilRegion(gl: WebGLRenderer, ref: number): void {
  ensureDepthClearScene();
  if (!depthClearMaterial || !depthClearScene || !depthClearCamera) {
    return;
  }
  depthClearMaterial.stencilRef = ref;
  depthClearMaterial.needsUpdate = true;
  gl.render(depthClearScene, depthClearCamera);
}

// Depth-clear quad infrastructure — allocated lazily on first use.
// A fullscreen quad with vertex shader writing z=1 in NDC, no
// fragment color output, stencil-tested against the current ref.
let depthClearScene: Scene | null = null;
let depthClearCamera: OrthographicCamera | null = null;
let depthClearMaterial: ShaderMaterial | null = null;

function ensureDepthClearScene(): void {
  if (depthClearScene) {
    return;
  }
  const scene = new Scene();
  const cam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const mat = new ShaderMaterial({
    vertexShader: /* glsl */ `
      void main() {
        // Map vertex (already in NDC space [-1,1]) directly to clip
        // space at z=1 (far plane). w=1 so no perspective divide
        // alters z.
        gl_Position = vec4(position.xy, 1.0, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      void main() {}
    `,
    colorWrite: false,
    depthTest: true,
    depthWrite: true,
    depthFunc: AlwaysDepth,
    stencilWrite: true,
    stencilFunc: EqualStencilFunc,
    stencilRef: 0,
    stencilFuncMask: 0xff,
    stencilWriteMask: 0xff,
    stencilFail: KeepStencilOp,
    stencilZFail: KeepStencilOp,
    stencilZPass: KeepStencilOp,
  });
  const geom = new PlaneGeometry(2, 2);
  const mesh = new Mesh(geom, mat);
  mesh.frustumCulled = false;
  scene.add(mesh);
  depthClearScene = scene;
  depthClearCamera = cam;
  depthClearMaterial = mat;
}

/**
 * Configure every (non-excluded) material in the scene with stencil
 * test EQUAL `ref`, op `zPassOp`, stencilWrite=true. Three.js's
 * `WebGLRenderer.setMaterial` only enables stencil test when the
 * material's `stencilWrite` is true — so for the test to apply
 * scene-wide we have to set it on every material, every pass.
 *
 * Excluded materials (the portal surface masks) keep their own
 * stencil settings; the cascade configures those directly.
 */
function setSceneStencilTest(
  scene: Scene,
  func: StencilFunc,
  ref: number,
  zPassOp: StencilOp,
  exclude: Set<Material>,
): void {
  scene.traverse((obj) => {
    const mesh = obj as Mesh;
    const mat = mesh.material;
    if (!mat) {
      return;
    }
    if (Array.isArray(mat)) {
      for (const m of mat) {
        applyStencilToMaterial(m, func, ref, zPassOp, exclude);
      }
    } else {
      applyStencilToMaterial(mat, func, ref, zPassOp, exclude);
    }
  });
}

function applyStencilToMaterial(
  mat: Material,
  func: StencilFunc,
  ref: number,
  zPassOp: StencilOp,
  exclude: Set<Material>,
): void {
  if (exclude.has(mat)) {
    return;
  }
  // Three.js's `Material` type exposes all stencil properties — no
  // cast needed. Setting them in place is the standard way to drive
  // the stencil state from the cascade per pass.
  mat.stencilWrite = true;
  mat.stencilFunc = func;
  mat.stencilRef = ref;
  mat.stencilFuncMask = 0xff;
  mat.stencilWriteMask = 0xff;
  mat.stencilFail = KeepStencilOp;
  mat.stencilZFail = KeepStencilOp;
  mat.stencilZPass = zPassOp;
}

/**
 * Disable stencil testing on every (non-excluded) material in the
 * scene by setting `stencilWrite=false`. Three.js's setMaterial
 * then disables the stencil test for those materials, so they
 * render unmasked.
 */
function setSceneStencilDisabled(scene: Scene, exclude: Set<Material>): void {
  scene.traverse((obj) => {
    const mesh = obj as Mesh;
    const mat = mesh.material;
    if (!mat) {
      return;
    }
    if (Array.isArray(mat)) {
      for (const m of mat) {
        if (!exclude.has(m)) {
          m.stencilWrite = false;
        }
      }
    } else if (!exclude.has(mat)) {
      mat.stencilWrite = false;
    }
  });
}

interface PortalMeshProps {
  endpoint: PortalEndpoint;
  material: MeshBasicMaterial;
  meshRef: { current: Mesh | null };
}

/**
 * Renders a single portal endpoint's surface plane (stencil mask)
 * + rim cylinders (visible color geometry). The surface plane lives
 * on PORTAL_SURFACE_LAYER (so the cascade can target it specifically
 * via camera layers); the rim cylinders live on PORTAL_LAYER (so
 * they render as ordinary scene geometry in any pass that includes
 * that layer).
 */
/** Unified "approach" radius (cube-local units) that gates *both*
 *  the rim particle activation and the click-to-portal interaction.
 *  Outside this radius, particles drift slowly + dimly and the
 *  crosshair raycast skips the portal entirely; inside, particles
 *  ramp up and clicks register. Keeping the two coupled means the
 *  visual affordance and the interaction affordance can never
 *  disagree — if you can see the portal "wake up," you can click it,
 *  and vice versa. The rim's per-frame proximity factor in
 *  `PortalRim` re-uses this same constant as `RIM_PROXIMITY_FAR`. */
const PORTAL_APPROACH_RANGE = 140;
/** Crosshair-interaction range for portals — pinned to the approach
 *  radius so the click affordance matches the visual affordance. */
const PORTAL_INTERACT_RANGE = PORTAL_APPROACH_RANGE;

function PortalMesh({ endpoint, material, meshRef }: PortalMeshProps): JSX.Element {
  // Register a click handler with the central InteractionController.
  // The controller raycasts from screen-centre each frame (independent
  // of pointer-lock state), updates `hoveredInteractableId` based on
  // the nearest mesh tagged via `userData.interactable`, and fires
  // the registered handler on **mouseup** when press- and release-
  // targets match.
  //
  // The handler doesn't compute the leap target — it just queues a
  // click on this portal id. CursorAvatar consumes the request next
  // frame, runs `planPortalLeap` with bob-compensated source +
  // current avatar position, and either kicks off a leap (valid) or
  // discards (e.g. avatar standing behind a single-sided portal).
  // Splitting it this way keeps active-side validation in the one
  // place that has live avatar position; the click site stays a
  // pure "register intent" callback.
  useEffect(() => {
    const handler = (): void => {
      useWorldStore.getState().setPendingPortalClick(endpoint.id);
    };
    interactableHandlers.set(endpoint.id, handler);
    return () => {
      interactableHandlers.delete(endpoint.id);
    };
  }, [endpoint.id]);

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) {
      return;
    }
    if (mesh.layers && typeof mesh.layers.set === 'function') {
      mesh.layers.set(PORTAL_SURFACE_LAYER);
    }
    // Tag the surface plane for the InteractionController's raycast.
    // The controller reads `userData.interactable / interactableId /
    // interactableRange` to decide what's hoverable. Even though the
    // material has `colorWrite: false`, R3F/Three's raycaster uses
    // geometry, so the invisible plane is still a valid hit target.
    // The userData guard mirrors the test-env layer guard above —
    // jsdom mocks don't construct a real Three.js Mesh.
    if (mesh.userData) {
      mesh.userData.interactable = true;
      mesh.userData.interactableId = endpoint.id;
      mesh.userData.interactableRange = PORTAL_INTERACT_RANGE;
    }
    return () => {
      if (mesh.userData) {
        delete mesh.userData.interactable;
        delete mesh.userData.interactableId;
        delete mesh.userData.interactableRange;
      }
    };
  }, [meshRef, endpoint.id]);

  return (
    <group
      position={[endpoint.position[0], endpoint.position[1], endpoint.position[2]]}
      quaternion={[
        endpoint.quaternion[0],
        endpoint.quaternion[1],
        endpoint.quaternion[2],
        endpoint.quaternion[3],
      ]}
    >
      {/* Surface plane — stencil-only, no visible color. Layer +
          interactable userData are set in the useEffect above. */}
      <mesh
        ref={(node: Mesh | null) => {
          meshRef.current = node;
        }}
      >
        <planeGeometry args={[endpoint.size.width, endpoint.size.height]} />
        <primitive object={material} attach="material" />
      </mesh>
      {/* Rim — ordinary opaque geometry on PORTAL_LAYER. Renders at
          its actual world position via vCam projection in each
          recursion level, producing natural perspective shrinkage. */}
      <PortalRim
        width={endpoint.size.width}
        height={endpoint.size.height}
        color={endpoint.rim.color}
        portalPosition={endpoint.position}
      />
    </group>
  );
}

interface PortalRimProps {
  width: number;
  height: number;
  color: string;
  /** Cube-local center of the portal, used by the rim's per-frame
   *  proximity calc to dial speed + brightness up as the camera
   *  approaches. Bob isn't compensated here — `bobY` is small
   *  relative to typical approach distances, and the proximity
   *  factor is a soft falloff anyway. */
  portalPosition: Vector3Tuple;
}

/** Number of live particles per portal rim. Higher = denser at the
 *  cost of per-frame matrix/color writes. 2000 keeps the rim visibly
 *  saturated; production cost is dominated by the 2000 setMatrixAt +
 *  setColorAt writes per portal per frame, plus the vertex shader
 *  pass over `2000 * 24 verts` for each cascade level. */
const RIM_PARTICLE_COUNT = 2000;

/** Distance (cube-local units) at which proximity factor reaches 0
 *  — particles drift slowly and stay dim past this range. Pinned to
 *  `PORTAL_APPROACH_RANGE` so the rim's "wake up" radius matches the
 *  click radius and the visual affordance is honest. */
const RIM_PROXIMITY_FAR = PORTAL_APPROACH_RANGE;
/** Distance at which proximity factor reaches 1 — particles fly fast
 *  and are at full brightness this close. */
const RIM_PROXIMITY_NEAR = 30;
/** Velocity multiplier when the camera is far away (factor=0). 0.15
 *  reads as "barely drifting" — particles spawn at the rim and die
 *  near the rim, producing a calm static-cloud look. */
const RIM_SPEED_SCALE_IDLE = 0.15;
/** Velocity multiplier when the camera is at the active threshold
 *  (factor=1). 1.0 = the speed sampled in `respawnRimParticle`. */
const RIM_SPEED_SCALE_ACTIVE = 1.0;
/** Color multiplier when far. 0.45 = visibly dimmed but still
 *  recognizable as the portal's color. */
const RIM_BRIGHTNESS_IDLE = 0.45;
const RIM_BRIGHTNESS_ACTIVE = 1.0;
/** Live-instance fraction at idle. 0.2 = 1/5 of the buffer renders
 *  when far from the portal — saves the GPU 80% of the per-instance
 *  work, while still leaving a visible halo. The CPU still steps all
 *  particles each frame so the hidden ones aren't stale when count
 *  ramps back up on approach. */
const RIM_COUNT_FRACTION_IDLE = 0.2;
const RIM_COUNT_FRACTION_ACTIVE = 1.0;

/**
 * Particle-field rim: every frame, ~400 small cubes spawn along the
 * rectangle's perimeter, drift outward in randomized directions,
 * shrink quadratically, and respawn at end-of-life. Drawn as a
 * single InstancedMesh on PORTAL_LAYER, so a portal's full particle
 * cloud is one draw call per recursion level.
 *
 * Color comes from a small palette derived from `endpoint.rim.color`:
 * the rim color itself dominates, with white sparkles and a
 * complementary-hue accent for variety. Per-instance color is fed
 * via `setColorAt`, which lazy-allocates `instanceColor` on the mesh.
 *
 * The particle update runs at default useFrame priority, before the
 * cascade's priority-3 render pass, so each cascade level sees an
 * already-stepped buffer.
 */
function PortalRim({ width, height, color, portalPosition }: PortalRimProps): JSX.Element {
  const meshRef = useRef<InstancedMesh | null>(null);
  const camera = useThree((s) => s.camera);

  const palette = useMemo(() => buildRimPalette(color), [color]);

  // Particle pool. Pre-staggered ages so the first frame already
  // looks like a steady-state cloud, not a synchronized burst.
  const particles = useMemo<RimParticle[]>(() => {
    const arr: RimParticle[] = [];
    for (let i = 0; i < RIM_PARTICLE_COUNT; i += 1) {
      const p: RimParticle = {
        origin: new Vector3(),
        velocity: new Vector3(),
        color: new Color(),
        age: 0,
        lifetime: 1,
      };
      respawnRimParticle(p, width, height, palette, true);
      arr.push(p);
    }
    return arr;
  }, [width, height, palette]);

  // Scratch values reused across the per-frame loop — zero allocation.
  const tmpMat = useMemo(() => new Matrix4(), []);
  const tmpPos = useMemo(() => new Vector3(), []);
  const tmpQuat = useMemo(() => new Quaternion(), []);
  const tmpScale = useMemo(() => new Vector3(), []);
  const tmpVel = useMemo(() => new Vector3(), []);
  const tmpColor = useMemo(() => new Color(), []);
  const portalCenter = useMemo(
    () => new Vector3(portalPosition[0], portalPosition[1], portalPosition[2]),
    [portalPosition],
  );

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) {
      return;
    }
    if (mesh.layers && typeof mesh.layers.set === 'function') {
      mesh.layers.set(PORTAL_LAYER);
    }
  }, []);

  useFrame((_state, delta) => {
    const mesh = meshRef.current;
    if (!mesh || typeof mesh.setMatrixAt !== 'function') {
      return;
    }

    // Proximity factor: 1 when the camera is closer than NEAR,
    // 0 past FAR, smooth linear ramp in between. Drives both speed
    // (slow→fast) and brightness (dim→full) so the rim reads as
    // calm at idle and "alive" on approach.
    const dist = camera.position.distanceTo(portalCenter);
    const proximity = Math.max(
      0,
      Math.min(1, (RIM_PROXIMITY_FAR - dist) / (RIM_PROXIMITY_FAR - RIM_PROXIMITY_NEAR)),
    );
    const speedScale =
      RIM_SPEED_SCALE_IDLE + (RIM_SPEED_SCALE_ACTIVE - RIM_SPEED_SCALE_IDLE) * proximity;
    const brightness =
      RIM_BRIGHTNESS_IDLE + (RIM_BRIGHTNESS_ACTIVE - RIM_BRIGHTNESS_IDLE) * proximity;
    const countFraction =
      RIM_COUNT_FRACTION_IDLE + (RIM_COUNT_FRACTION_ACTIVE - RIM_COUNT_FRACTION_IDLE) * proximity;
    // `mesh.count` clips the InstancedMesh draw call to the first N
    // instances regardless of buffer length — the GPU just doesn't
    // process the rest. A larger floor than 1 keeps a visible halo
    // even when the player is on the far side of the cube.
    mesh.count = Math.max(1, Math.round(RIM_PARTICLE_COUNT * countFraction));
    const canSetColor = typeof mesh.setColorAt === 'function';

    for (let i = 0; i < particles.length; i += 1) {
      const p = particles[i]!;
      // `speedScale` slows TIME for the particle (age advances at
      // `delta * speedScale`) instead of scaling displacement. The
      // distinction matters: scaling displacement means slow particles
      // never reach far before dying — they huddle at the rim and the
      // cloud looks pinched. Scaling time keeps the same outward
      // trajectory but plays it slower, so the halo retains its full
      // spread at idle and just animates more languidly.
      p.age += delta * speedScale;
      if (p.age >= p.lifetime) {
        respawnRimParticle(p, width, height, palette, false);
      }

      const t = p.age / p.lifetime;
      // Quadratic falloff: shrinks gently early, fades fast at end.
      const fade = 1 - t;
      const size = RIM_PARTICLE_BASE_SIZE * fade * fade;

      tmpVel.copy(p.velocity).multiplyScalar(p.age);
      tmpPos.copy(p.origin).add(tmpVel);
      tmpScale.set(size, size, size);
      tmpMat.compose(tmpPos, tmpQuat, tmpScale);
      mesh.setMatrixAt(i, tmpMat);
      if (canSetColor) {
        tmpColor.copy(p.color).multiplyScalar(brightness);
        mesh.setColorAt(i, tmpColor);
      }
    }

    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) {
      mesh.instanceColor.needsUpdate = true;
    }
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, RIM_PARTICLE_COUNT]}>
      <boxGeometry args={[1, 1, 1]} />
      <meshBasicMaterial toneMapped={false} />
    </instancedMesh>
  );
}
