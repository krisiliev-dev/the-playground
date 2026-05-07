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
  type Group,
  IncrementStencilOp,
  KeepStencilOp,
  type Material,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  type StencilFunc,
  type StencilOp,
  Vector3,
  type Vector3Tuple,
  type WebGLRenderer,
} from 'three';
import { MAX_PORTAL_RECURSION, getPaired, type PortalEndpoint } from '@/content/portals';
import { MAIN_CUBE_BOB } from '@/content/routes';
import { useWorldStore } from '@/store';
import { minPlayerDistance } from '@/multiplayer/playerProximity';
import { cursorWorldPosition } from '../cursorWorldPosition';
import { useInteractable } from '../Interactable';
import { floatOffset } from '../floatBob';
import {
  CASCADE_OVERLAY_LAYER,
  CURSOR_LAYER,
  PORTAL_LAYER,
  PORTAL_SURFACE_LAYER,
} from '../sceneLayers';
import { bobbedEndpoint, isOnActiveSide, virtualCameraPose } from './portalMath';

interface PortalState {
  readonly endpoint: PortalEndpoint;
  /** Live ref to the stencil-only surface plane mesh. */
  meshRef: { current: Mesh | null };
  /** Live ref to the outer transform group that wraps both the
   *  surface mesh and the rim. The cascade bobs the *group* each
   *  frame (not the mesh) so the rim and surface stay locked
   *  together — bobbing the mesh alone (the old approach) only
   *  worked when endpoint.y === 0; for non-zero Y it double-counts
   *  because the parent group already contributes endpoint.y to the
   *  mesh's world position. */
  groupRef: { current: Group | null };
  /** The stencil-only material for the surface plane. Stencil props
   *  are reconfigured per render pass in the cascade loop. */
  readonly surfaceMaterial: MeshBasicMaterial;
  /** Reused PerspectiveCamera, repointed each render with the
   *  appropriate (depth, portal) chain pose. */
  readonly vCam: PerspectiveCamera;
}

export function PortalCascade(): JSX.Element {
  const camera = useThree((s) => s.camera);
  const portalEndpoints = useWorldStore((s) => s.portalEndpoints);

  // Per-portal state. Reallocated whenever the active endpoint set
  // changes (reveal start / reset). The surface materials and vCams
  // are reused across frames within a given endpoint generation;
  // disposal happens in the cleanup of the dispose effect below.
  //
  // Trigger endpoints (no `pairedWith`) still get a PortalState so
  // their rim renders, but `getPaired` returns null for them — the
  // cascade's recursive draw skips through-view rendering when there
  // is no destination. The trigger fires elsewhere (CursorAvatar's
  // walk-cross detector + click handler).
  const portalStates = useMemo<PortalState[]>(() => {
    const states: PortalState[] = [];
    for (const ep of portalEndpoints) {
      const paired = ep.trigger ? null : getPaired(ep.id, portalEndpoints);
      if (!ep.trigger && !paired) {
        continue;
      }
      // The surface material is configured for stencil-only writes.
      // Stencil func/ref/op are mutated per pass during the cascade;
      // colorWrite + depthWrite stay false so the surface plane
      // never produces visible pixels or interferes with depth.
      //
      // depthTest is set per-phase: Phase A (stencil mark) wants
      // depth-test ON so foreground geometry (swords, debris) can
      // correctly occlude the mark and prevent the through-view from
      // overwriting their pixels. Phase F (stencil decrement) wants
      // depth-test OFF — by then the depth buffer holds vCam-space
      // values that are meaningless to compare against parentCam-space
      // surface-plane depth. The initial value here is what Phase A
      // assumes when first reading the material; Phases A and F both
      // set it explicitly each frame.
      const surfaceMaterial = new MeshBasicMaterial({
        side: DoubleSide,
        colorWrite: false,
        depthWrite: false,
        depthTest: true,
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
        groupRef: { current: null },
        surfaceMaterial,
        vCam: new PerspectiveCamera(),
      });
    }
    return states;
  }, [portalEndpoints]);

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

    // Per-route visibility filter: only portals tagged with the
    // avatar's current route render. Hides off-route portals so
    // neither Phase 1 (main render) nor any cascade phase touches
    // them. Saves the per-portal cascade work (Phase A→F per portal,
    // recursing up to MAX_PORTAL_RECURSION) for portals the player
    // can't see anyway, and keeps cross-route stencil bookkeeping
    // out of the picture entirely.
    const currentRoute = useWorldStore.getState().currentRoute;
    for (const ps of portalStates) {
      const group = ps.groupRef.current;
      if (group) {
        group.visible = ps.endpoint.route === currentRoute;
      }
    }
    const visiblePortalStates = portalStates.filter((ps) => ps.endpoint.route === currentRoute);
    if (visiblePortalStates.length === 0) {
      // Nothing to cascade — fall back to a default render.
      gl.setRenderTarget(null);
      gl.render(sceneRef, mainCam);
      return;
    }

    // Bob-compensate the outer transform group of each visible
    // portal so its surface plane AND rim stay locked to the
    // bobbing cube wall. Setting `group.position.y = endpoint.y +
    // bobY` overrides the y-component the JSX initialised; X and Z
    // stay where the JSX put them.
    for (const ps of visiblePortalStates) {
      const group = ps.groupRef.current;
      if (group) {
        group.position.y = ps.endpoint.position[1] + bobY;
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
    // Only visible (current-route) portals get cascaded — but the
    // `allPortals` argument is the FULL `portalStates` list so
    // `computeChainPose` can still resolve cross-route pairings
    // (a formation portal's destination is its room-exit pair, even
    // when the avatar is in the main cube and the room is "off
    // route"). Off-route portals are still hidden via their parent
    // group's `visible = false`, so Phase A's "hide other portals"
    // loop iterating over the full list is a no-op for them.
    for (const ps of visiblePortalStates) {
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
          groupRef={state.groupRef}
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

  // Trigger endpoints don't render a through-view — there's no
  // destination to step the virtual camera into. Skip the cascade
  // for them entirely; their rim still renders as ordinary scene
  // geometry in Phase 1 + each level's Phase D pass 1.
  if (ps.endpoint.trigger) {
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
  // Depth-test ON. Foreground geometry between parentCam and the
  // portal (swords sticking out of the wall, debris in flight)
  // correctly occludes the stencil mark, so Phase D's through-view
  // doesn't overwrite those pixels. The mark pass writes no color
  // and no depth (`colorWrite: false`, `depthWrite: false`); the
  // depth buffer it consults was just written by Phase 1 (depth 0)
  // or Phase D pass 1 of the parent level (depth ≥ 1), and in both
  // cases its values are meaningful for "what's in front of this
  // portal from this camera's POV?" — exactly the question we
  // want answered.
  ps.surfaceMaterial.depthTest = true;
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
  computeChainPose(
    ps,
    parentCam,
    bobY,
    allPortals.map((other) => other.endpoint),
  );

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
  // depthTest OFF for this pass. Phase F is pure stencil bookkeeping
  // — its job is to undo the mark Phase A wrote. The stencil-equal
  // check on (stencilRef+1) already gates the decrement to exactly
  // the pixels Phase A marked, so depth-test isn't needed for
  // correctness. Worse: the depth buffer here holds Phase D's
  // through-view depth (vCam-space), not parentCam-space, so a
  // depth-test against the surface plane's parentCam-space depth
  // could fail unpredictably and leave stencil residue across
  // frames.
  ps.surfaceMaterial.depthTest = false;
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
function computeChainPose(
  ps: PortalState,
  parentCam: PerspectiveCamera,
  bobY: number,
  allEndpoints: ReadonlyArray<PortalEndpoint>,
): void {
  const endpoint = ps.endpoint;
  const paired = getPaired(endpoint.id, allEndpoints);
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
  groupRef: { current: Group | null };
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

function PortalMesh({ endpoint, material, meshRef, groupRef }: PortalMeshProps): JSX.Element {
  // Wire interaction via the unified hook: registers the click
  // handler with `InteractionController`, tags the surface plane's
  // userData so the per-frame raycast picks it up, and animates a
  // hover/press scale on the parent group (which contains both the
  // surface plane AND the rim — so the rim "pops" when crosshaired).
  //
  // The handler queues a portal click; CursorAvatar consumes the
  // request next frame, runs `planPortalLeap` with the live avatar
  // position + bob compensation, and either kicks off a leap or
  // discards the click (e.g. avatar behind a single-sided portal).
  // Keeping active-side validation in the consume site means the
  // click handler stays a pure "register intent" callback.
  useInteractable({
    id: endpoint.id,
    range: PORTAL_INTERACT_RANGE,
    ref: meshRef,
    visualRef: groupRef,
    onInteract: () => useWorldStore.getState().setPendingPortalClick(endpoint.id),
  });

  // The surface plane needs to be on PORTAL_SURFACE_LAYER (the
  // cascade targets that layer specifically for stencil-mark
  // passes); the userData / interactable wiring is fully handled
  // by `useInteractable` above.
  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh || !mesh.layers || typeof mesh.layers.set !== 'function') {
      return;
    }
    mesh.layers.set(PORTAL_SURFACE_LAYER);
  }, [meshRef]);

  return (
    <group
      ref={(node: Group | null) => {
        groupRef.current = node;
      }}
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
   *  proximity calc to dial brightness up as the camera approaches.
   *  Bob isn't compensated here — `bobY` is small relative to
   *  typical approach distances, and the proximity factor is a soft
   *  falloff anyway. */
  portalPosition: Vector3Tuple;
}

/** Distance (cube-local units) at which proximity factor reaches 0
 *  — the rim sits at idle brightness + idle speed past this range.
 *  Pinned to `PORTAL_APPROACH_RANGE` so the rim's "wake up" radius
 *  matches the click radius and the visual affordance is honest. */
const RIM_PROXIMITY_FAR = PORTAL_APPROACH_RANGE;
/** Distance at which proximity factor reaches 1 — rim is at full
 *  brightness + full speed this close. */
const RIM_PROXIMITY_NEAR = 30;
/** Emissive intensity multiplier when the camera is far away. 0.45
 *  = visibly present but understated. */
const RIM_BRIGHTNESS_IDLE = 0.45;
/** Emissive intensity multiplier when the camera is within
 *  `RIM_PROXIMITY_NEAR`. 1.0 = full saturation. */
const RIM_BRIGHTNESS_ACTIVE = 1.0;
/** Line speed multiplier at idle (player far / portal not
 *  interactable). 0.05 = 5% of normal speed — almost still, with a
 *  faint drift to keep the rim feeling alive. */
const RIM_SPEED_IDLE = 0.05;
/** Line speed multiplier at active (player within approach range).
 *  1.0 = the speeds hardcoded in the shader. */
const RIM_SPEED_ACTIVE = 1.0;

/** Bar thickness in world units. Thicker than the old line look so
 *  the rim has visible 3D presence and gives the racing lines lanes
 *  to vary across. */
const RIM_BAR_THICKNESS = 1.5;
/** Base alpha of the rim's solid fill — near-transparent so the
 *  frame reads as energy-field rather than physical metal, and the
 *  racing lines pop against the faint backdrop. */
const RIM_BASE_ALPHA = 0.12;

const RIM_VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/** Fragment shader: full-rim cyberpunk racetrack with comet-shaped
 *  streaks at varying lengths, lanes, hues, and speeds.
 *
 *  Each line is a "comet" — a sharp bright HEAD at position `pos`
 *  with a fading TAIL extending behind it for `streakLen` along the
 *  motion direction. `dirSign` (±1) selects which direction the
 *  tail extends. Tail intensity falls off quadratically.
 *
 *  Per-line `hue` rotates the base portal color via Rodrigues'
 *  formula around the (1,1,1) axis in RGB space — cheap, hue-only
 *  rotation that preserves brightness. ±0.5 radian (~±30°) keeps
 *  variants close to the portal's brand color but visually distinct.
 *
 *  Line motion uses `u_phaseClock` (an accumulator advanced on the
 *  JS side by `delta * speedScale` each frame) instead of `u_time`,
 *  so proximity-driven speed changes flow smoothly without
 *  phase jumps. The breathing pulse stays on `u_time` (constant rate). */
const RIM_FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 u_color;
  uniform float u_brightness;
  uniform float u_axis;
  uniform float u_perimAtStart;
  uniform float u_perimAtEnd;
  uniform float u_baseAlpha;
  uniform float u_time;
  uniform float u_phaseClock;
  varying vec2 vUv;

  // Cheap hue rotation in RGB space around the (1,1,1) gray axis
  // via Rodrigues' formula. Preserves brightness; pure hue shift.
  // Source: standard YIQ-equivalent shader trick.
  vec3 hueShift(vec3 c, float h) {
    const vec3 K = vec3(0.5773502691896258);
    float cs = cos(h);
    return c * cs + cross(K, c) * sin(h) + K * dot(K, c) * (1.0 - cs);
  }

  // Compute one comet line's color contribution at this fragment.
  // - perim: this fragment's full-rim coordinate in [0, 1).
  // - v: perpendicular (lane) coordinate in [0, 1].
  // - pos: head position around the perimeter.
  // - lane: lane center (uv-perp value).
  // - streakLen: length of the trail behind the head, in perim units.
  // - laneWidth: line half-width across the lane axis.
  // - dirSign: ±1; tail extends in direction opposite to motion.
  // - hue: hue shift in radians applied to baseCol.
  // - baseCol: portal's rim color (u_color).
  // - intens: per-line intensity multiplier.
  // Returns vec4(rgb_contribution, alpha_contribution) so we can
  // accumulate colored streaks additively.
  vec4 lineFx(
    float perim, float v,
    float pos, float lane,
    float streakLen, float laneWidth,
    float dirSign, float hue,
    vec3 baseCol, float intens
  ) {
    // "Behind head" coordinate, in motion direction. 0 at head;
    // grows toward streakLen at the tail end.
    float behind = (pos - perim) * dirSign;
    behind = behind - floor(behind + 0.5); // wrap to (-0.5, 0.5]
    // Gate to [0, streakLen] without an if-branch (cheaper on GPU).
    float gate = step(0.0, behind) * step(behind, streakLen);
    float trail = (1.0 - behind / streakLen) * gate;
    trail = trail * trail; // quadratic falloff for sharper head, soft tail
    float laneFall = 1.0 - smoothstep(laneWidth * 0.65, laneWidth, abs(v - lane));
    float i = trail * laneFall * intens;
    vec3 c = hueShift(baseCol, hue);
    return vec4(c * i, i);
  }

  void main() {
    float u = mix(vUv.x, vUv.y, u_axis);
    float v = mix(vUv.y, vUv.x, u_axis);
    float perim = mix(u_perimAtStart, u_perimAtEnd, u);

    // Breathing pulse on constant time clock (independent of speed).
    float pulse = 1.0 + 0.15 * sin(u_time * 1.4);

    // 27 comet lines: varied lengths (0.020..0.180), hues (-0.50..+0.50),
    // lane widths, speeds, directions, intensities. Position uses
    // u_phaseClock so proximity-driven speed scales smoothly.
    vec4 acc = vec4(0.0);
    acc += lineFx(perim, v, fract(u_phaseClock *  0.21 + 0.00), 0.04, 0.060, 0.030,  1.0,  0.00, u_color, 1.10);
    acc += lineFx(perim, v, fract(u_phaseClock * -0.27 + 0.30), 0.08, 0.030, 0.025, -1.0,  0.30, u_color, 1.30);
    acc += lineFx(perim, v, fract(u_phaseClock *  0.13 + 0.43), 0.12, 0.110, 0.050,  1.0, -0.40, u_color, 0.85);
    acc += lineFx(perim, v, fract(u_phaseClock * -0.18 + 0.71), 0.16, 0.040, 0.030, -1.0,  0.50, u_color, 1.20);
    acc += lineFx(perim, v, fract(u_phaseClock *  0.08 + 0.15), 0.20, 0.080, 0.040,  1.0, -0.20, u_color, 0.95);
    acc += lineFx(perim, v, fract(u_phaseClock * -0.31 + 0.62), 0.24, 0.140, 0.060, -1.0,  0.10, u_color, 0.65);
    acc += lineFx(perim, v, fract(u_phaseClock *  0.16 + 0.86), 0.28, 0.025, 0.025,  1.0, -0.50, u_color, 1.30);
    acc += lineFx(perim, v, fract(u_phaseClock * -0.11 + 0.04), 0.32, 0.090, 0.045, -1.0,  0.40, u_color, 0.90);
    acc += lineFx(perim, v, fract(u_phaseClock *  0.24 + 0.49), 0.36, 0.045, 0.035,  1.0,  0.00, u_color, 1.15);
    acc += lineFx(perim, v, fract(u_phaseClock * -0.06 + 0.18), 0.40, 0.100, 0.050, -1.0, -0.30, u_color, 0.80);
    acc += lineFx(perim, v, fract(u_phaseClock *  0.19 + 0.55), 0.44, 0.030, 0.030,  1.0,  0.20, u_color, 1.10);
    acc += lineFx(perim, v, fract(u_phaseClock * -0.29 + 0.92), 0.48, 0.020, 0.025, -1.0, -0.10, u_color, 1.40);
    acc += lineFx(perim, v, fract(u_phaseClock *  0.10 + 0.27), 0.52, 0.150, 0.060,  1.0,  0.50, u_color, 0.75);
    acc += lineFx(perim, v, fract(u_phaseClock * -0.14 + 0.37), 0.56, 0.055, 0.038, -1.0, -0.40, u_color, 1.05);
    acc += lineFx(perim, v, fract(u_phaseClock *  0.34 + 0.78), 0.60, 0.025, 0.030,  1.0,  0.30, u_color, 1.30);
    acc += lineFx(perim, v, fract(u_phaseClock * -0.22 + 0.13), 0.64, 0.085, 0.045, -1.0,  0.00, u_color, 0.95);
    acc += lineFx(perim, v, fract(u_phaseClock *  0.07 + 0.66), 0.68, 0.020, 0.025,  1.0, -0.50, u_color, 1.20);
    acc += lineFx(perim, v, fract(u_phaseClock * -0.17 + 0.45), 0.72, 0.180, 0.065, -1.0,  0.40, u_color, 0.70);
    acc += lineFx(perim, v, fract(u_phaseClock *  0.26 + 0.08), 0.76, 0.040, 0.035,  1.0, -0.20, u_color, 1.15);
    acc += lineFx(perim, v, fract(u_phaseClock * -0.09 + 0.85), 0.80, 0.110, 0.055, -1.0,  0.10, u_color, 0.85);
    acc += lineFx(perim, v, fract(u_phaseClock *  0.15 + 0.21), 0.84, 0.030, 0.030,  1.0,  0.30, u_color, 1.10);
    acc += lineFx(perim, v, fract(u_phaseClock * -0.32 + 0.59), 0.88, 0.020, 0.025, -1.0, -0.40, u_color, 1.35);
    acc += lineFx(perim, v, fract(u_phaseClock *  0.12 + 0.74), 0.92, 0.075, 0.045,  1.0,  0.20, u_color, 0.95);
    acc += lineFx(perim, v, fract(u_phaseClock * -0.20 + 0.36), 0.96, 0.050, 0.038, -1.0, -0.10, u_color, 1.05);
    acc += lineFx(perim, v, fract(u_phaseClock *  0.30 + 0.51), 0.18, 0.030, 0.030,  1.0,  0.50, u_color, 1.20);
    acc += lineFx(perim, v, fract(u_phaseClock * -0.08 + 0.95), 0.34, 0.130, 0.060, -1.0, -0.30, u_color, 0.60);
    acc += lineFx(perim, v, fract(u_phaseClock *  0.22 + 0.16), 0.66, 0.045, 0.035,  1.0,  0.00, u_color, 1.15);

    // Apply pulse to the accumulated streaks (color + alpha).
    vec3 streakRgb = acc.rgb * pulse;
    float streakA = acc.a * pulse;

    vec3 base = u_color * u_baseAlpha;
    // Lift streak color toward bright/white at high intensity for that
    // hot-neon glow where the head passes.
    vec3 hot = mix(streakRgb * 1.6, streakRgb * 1.6 + vec3(0.4), 0.5);
    vec3 col = base + hot * u_brightness;
    float alpha = clamp(u_baseAlpha + streakA, 0.0, 1.0);
    gl_FragColor = vec4(col, alpha);
  }
`;

/**
 * Full-rim cyberpunk racetrack: 4 thick, near-transparent emissive
 * bars forming a frame around the portal. Each bar is a
 * BoxGeometry with its own ShaderMaterial that draws a faint
 * solid base + 5 bright "racing lines" (cars) circling the full
 * perimeter at different speeds, lanes, and widths. Some run
 * clockwise, some counter-clockwise; lines flow continuously
 * across bar boundaries (corners).
 *
 * Why 4 materials (one per bar): each needs a unique
 * `u_perimStart` and `u_perimLength` so the fragment shader can
 * compute its position around the FULL perimeter, not just within
 * the local bar. Materials share the time + brightness uniforms,
 * which we update on all 4 each frame.
 *
 * Per-frame cost: 1 distance calc + 4 uniform writes for `u_time`
 * + 4 for `u_brightness`. Negligible. The fragment shader is a
 * handful of math ops + `smoothstep`s per fragment, over a tiny
 * pixel coverage.
 */
function PortalRim({ width, height, color, portalPosition }: PortalRimProps): JSX.Element {
  const groupRef = useRef<Group | null>(null);

  const portalCenter = useMemo(
    () => new Vector3(portalPosition[0], portalPosition[1], portalPosition[2]),
    [portalPosition],
  );

  // 4 materials, one per bar. Each gets the perim range it covers
  // (start → end pair) so the shader can `mix` across regardless
  // of whether the bar's UV runs in the same direction as
  // increasing perim. Track is clockwise from top-left (perim 0).
  // Right + bottom bars pass start > end so their UVs run perim
  // backward — matches their UV layout where uv=0 is at the FAR
  // end of the bar (bottom-right and bottom-left respectively).
  const materials = useMemo(() => {
    const total = 2 * (width + height);
    const widthFrac = width / total;
    const heightFrac = height / total;
    const make = (axis: number, perimAtStart: number, perimAtEnd: number): ShaderMaterial =>
      new ShaderMaterial({
        uniforms: {
          u_color: { value: new Color(color) },
          u_brightness: { value: RIM_BRIGHTNESS_IDLE },
          u_axis: { value: axis },
          u_perimAtStart: { value: perimAtStart },
          u_perimAtEnd: { value: perimAtEnd },
          u_baseAlpha: { value: RIM_BASE_ALPHA },
          u_time: { value: 0 },
          // phaseClock is incremented in useFrame by `delta * speedScale`
          // each frame, so proximity-driven speed changes flow without
          // phase-jump artifacts.
          u_phaseClock: { value: 0 },
        },
        vertexShader: RIM_VERTEX_SHADER,
        fragmentShader: RIM_FRAGMENT_SHADER,
        toneMapped: false,
        transparent: true,
        // Don't write depth — adjacent transparent meshes (the
        // 4 bars overlap at corners) would otherwise occlude each
        // other inconsistently across viewing angles.
        depthWrite: false,
      });
    return {
      // Top: clockwise from top-left to top-right. uv.x runs left
      // to right, perim runs 0 → widthFrac.
      top: make(0, 0, widthFrac),
      // Right: clockwise from top-right to bottom-right. uv.y=0 is
      // at the BOTTOM of the right bar (away from top-right corner
      // where perim enters), so uv.y=0 ↔ widthFrac+heightFrac and
      // uv.y=1 ↔ widthFrac. Reverse direction.
      right: make(1, widthFrac + heightFrac, widthFrac),
      // Bottom: clockwise from bottom-right to bottom-left. uv.x=0
      // is at the LEFT of the bottom bar, so uv.x=0 ↔ 2wF+hF and
      // uv.x=1 ↔ wF+hF. Reverse direction.
      bottom: make(0, 2 * widthFrac + heightFrac, widthFrac + heightFrac),
      // Left: clockwise from bottom-left to top-left. uv.y=0 is at
      // the BOTTOM of the left bar, perim enters at bottom-left.
      // Direct: uv.y=0 ↔ 2wF+hF, uv.y=1 ↔ 1.
      left: make(1, 2 * widthFrac + heightFrac, 1),
    };
  }, [color, width, height]);

  // Tag every bar mesh with PORTAL_LAYER so the cascade renders the
  // rim alongside other in-scene geometry through each through-view.
  useEffect(() => {
    const group = groupRef.current;
    if (!group) {
      return;
    }
    group.traverse((obj) => {
      if (obj.layers && typeof obj.layers.set === 'function' && obj !== group) {
        obj.layers.set(PORTAL_LAYER);
      }
    });
  }, [width, height]);

  useEffect(() => {
    return () => {
      materials.top.dispose();
      materials.right.dispose();
      materials.bottom.dispose();
      materials.left.dispose();
    };
  }, [materials]);

  // Phase accumulator — advanced by `delta * speedScale` each frame
  // so the streaks slow down smoothly when the avatar steps out of
  // the approach radius and speed up smoothly on re-approach.
  // Multiplying `u_time * speedScale` directly would cause a phase
  // pop the moment speedScale changed; integrating the rate instead
  // keeps motion continuous.
  const phaseClockRef = useRef(0);

  useFrame((state, delta) => {
    // Aggregate proximity across local + remote players. Local
    // position sources from `cursorWorldPosition` (the avatar's
    // world position, written each frame by CursorAvatar) rather
    // than `camera.position` — in 3rd-person rig the camera sits
    // ~30 units behind the avatar, so using camera position here
    // would make the LOCAL proximity threshold trip later than
    // the remote threshold (which uses entity-cursor positions).
    // Both sides now measure from the cursor.
    const { entities, localPlayerId } = useWorldStore.getState();
    const dist = minPlayerDistance(
      [portalCenter.x, portalCenter.y, portalCenter.z],
      [cursorWorldPosition.x, cursorWorldPosition.y, cursorWorldPosition.z],
      entities,
      localPlayerId,
    );
    const proximity = Math.max(
      0,
      Math.min(1, (RIM_PROXIMITY_FAR - dist) / (RIM_PROXIMITY_FAR - RIM_PROXIMITY_NEAR)),
    );
    const brightness =
      RIM_BRIGHTNESS_IDLE + (RIM_BRIGHTNESS_ACTIVE - RIM_BRIGHTNESS_IDLE) * proximity;
    // Speed is a HARD threshold at the interactable range, not a
    // gradual ramp: idle (almost still) outside, active (full) once
    // the avatar crosses into click range. The phase accumulator
    // handles the rate jump smoothly — phaseClock keeps advancing,
    // just 20× faster from the next frame on, so motion accelerates
    // without phase teleporting.
    const isInteractable = dist <= RIM_PROXIMITY_FAR;
    const speedScale = isInteractable ? RIM_SPEED_ACTIVE : RIM_SPEED_IDLE;
    phaseClockRef.current += delta * speedScale;

    const time = state.clock.elapsedTime;
    const phaseClock = phaseClockRef.current;
    for (const mat of [materials.top, materials.right, materials.bottom, materials.left]) {
      mat.uniforms.u_brightness!.value = brightness;
      mat.uniforms.u_time!.value = time;
      mat.uniforms.u_phaseClock!.value = phaseClock;
    }
  });

  const halfW = width / 2;
  const halfH = height / 2;
  const t = RIM_BAR_THICKNESS;
  // Top + bottom bars are length `width + t` so they cover the
  // four outer corner blocks. With length=width, the cubes at
  // (±(halfW+t/2), ±(halfH+t/2)) — the absolute outer corners of
  // the rim — would be in NO bar (top stops at x=±halfW, right
  // stops at y=±halfH). Extending the horizontals by `t` fills
  // those gaps; left + right bars stay at length=height since
  // the extended top + bottom now cover their corner cubes.
  const horizLen = width + t;

  return (
    <group ref={groupRef}>
      {/* Top bar — long axis = X (u_axis=0), extended to cover
          the top-left + top-right outer corners. */}
      <mesh position={[0, halfH, 0]}>
        <boxGeometry args={[horizLen, t, t]} />
        <primitive object={materials.top} attach="material" />
      </mesh>
      {/* Right bar — long axis = Y (u_axis=1). */}
      <mesh position={[halfW, 0, 0]}>
        <boxGeometry args={[t, height, t]} />
        <primitive object={materials.right} attach="material" />
      </mesh>
      {/* Bottom bar — extended to cover bottom-left + bottom-right
          outer corners. */}
      <mesh position={[0, -halfH, 0]}>
        <boxGeometry args={[horizLen, t, t]} />
        <primitive object={materials.bottom} attach="material" />
      </mesh>
      {/* Left bar */}
      <mesh position={[-halfW, 0, 0]}>
        <boxGeometry args={[t, height, t]} />
        <primitive object={materials.left} attach="material" />
      </mesh>
    </group>
  );
}
