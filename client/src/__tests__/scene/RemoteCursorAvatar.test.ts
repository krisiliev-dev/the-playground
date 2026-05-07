/**
 * Tests for `buildCursorTree` — the pure-ish helper that
 * constitutes the entire correctness payload of
 * `RemoteCursorAvatar`. Locks the contract:
 *
 *   - Strips CursorAvatar's mutations from the cached GLB scene
 *     (cleared via parent-not-Mesh filter + child-mesh removal).
 *   - Re-skins original meshes with a per-player body material.
 *   - Adds an outline shell as a child of each body, properly
 *     positioned + scaled.
 *   - Sets render-order so body draws over outline interior.
 *   - Sets CASCADE_OVERLAY_LAYER on every mesh (main view +
 *     cascade through-views).
 *   - depthWrite=true on both body and outline so the cursor
 *     correctly occludes portal stencil masks (otherwise portal
 *     cutouts paint over the cursor in screen space).
 *
 * Component-level rendering (R3F + jsdom Canvas) is too heavy to
 * unit test reliably; the visual assertions are confirmed via
 * the manual two-tab smoke test.
 */
import { describe, it, expect } from 'vitest';
import {
  BackSide,
  BoxGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
} from 'three';
import { buildCursorTree } from '@/components/scene/RemoteCursorAvatar';
import { CASCADE_OVERLAY_LAYER } from '@/components/scene/sceneLayers';
import {
  RENDER_ORDER_CURSOR_BODY,
  RENDER_ORDER_CURSOR_OUTLINE,
} from '@/components/scene/renderOrder';

/** A bare GLB-shaped tree: a root Object3D with two body Meshes. */
function makePristineGlb(): Object3D {
  const root = new Object3D();
  const meshA = new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial());
  const meshB = new Mesh(new BoxGeometry(2, 2, 2), new MeshStandardMaterial());
  root.add(meshA, meshB);
  return root;
}

/** Same shape but with CursorAvatar-style mutations attached:
 *  each body mesh has child meshes (its own outline shell + a
 *  larger in-scene cascade copy). buildCursorTree must strip
 *  these before re-skinning. */
function makeContaminatedGlb(): Object3D {
  const root = makePristineGlb();
  for (const mesh of root.children as Mesh[]) {
    const fakeOutline = new Mesh(new BoxGeometry(1.06, 1.06, 1.06), new MeshBasicMaterial());
    const fakeInScene = new Mesh(new BoxGeometry(5, 5, 5), new MeshStandardMaterial());
    mesh.add(fakeOutline, fakeInScene);
  }
  return root;
}

function bodyMeshes(tree: Object3D): Mesh[] {
  const out: Mesh[] = [];
  tree.traverse((o) => {
    const m = o as Mesh;
    if (m.isMesh && !(o.parent as Mesh | null)?.isMesh) {
      out.push(m);
    }
  });
  return out;
}

describe('buildCursorTree', () => {
  it('preserves both original GLB meshes from a pristine source', () => {
    const out = buildCursorTree(makePristineGlb(), '#ffffff');
    expect(bodyMeshes(out)).toHaveLength(2);
  });

  it('strips CursorAvatar-attached child meshes from a contaminated source', () => {
    const tree = buildCursorTree(makeContaminatedGlb(), '#ffffff');
    for (const body of bodyMeshes(tree)) {
      const childMeshes = body.children.filter((c) => (c as Mesh).isMesh);
      // Exactly ONE child mesh per body: the freshly-added outline.
      // The CursorAvatar additions (fakeOutline + fakeInScene) are gone.
      expect(childMeshes).toHaveLength(1);
      expect((childMeshes[0] as Mesh).userData.isOutlineShell).toBe(true);
    }
  });

  it('re-skins body meshes with the supplied bodyColor', () => {
    const tree = buildCursorTree(makePristineGlb(), '#ff00aa');
    for (const body of bodyMeshes(tree)) {
      expect(body.material).toBeInstanceOf(MeshStandardMaterial);
      const mat = body.material as MeshStandardMaterial;
      // Three.js Color stores normalised floats — compare by hex.
      expect(`#${mat.color.getHexString()}`).toBe('#ff00aa');
    }
  });

  it('sets renderOrder so body draws over outline interior', () => {
    const tree = buildCursorTree(makePristineGlb(), '#ffffff');
    for (const body of bodyMeshes(tree)) {
      expect(body.renderOrder).toBe(RENDER_ORDER_CURSOR_BODY);
      const outline = body.children.find((c) => (c as Mesh).userData.isOutlineShell) as Mesh;
      expect(outline).toBeDefined();
      expect(outline.renderOrder).toBe(RENDER_ORDER_CURSOR_OUTLINE);
      expect(outline.renderOrder).toBeLessThan(body.renderOrder);
    }
  });

  it('puts every mesh on CASCADE_OVERLAY_LAYER (in addition to default 0)', () => {
    const tree = buildCursorTree(makePristineGlb(), '#ffffff');
    for (const body of bodyMeshes(tree)) {
      // Layer mask is a 32-bit bitfield. Three.js layers use bit
      // positions, so layer N corresponds to (1 << N).
      const layerBit = 1 << CASCADE_OVERLAY_LAYER;
      expect(body.layers.mask & layerBit).not.toBe(0);
      expect(body.layers.mask & 1).not.toBe(0); // default layer 0 still set
      const outline = body.children.find((c) => (c as Mesh).userData.isOutlineShell) as Mesh;
      expect(outline.layers.mask & layerBit).not.toBe(0);
    }
  });

  it('writes depth on both body and outline (load-bearing for portal stencil)', () => {
    const tree = buildCursorTree(makePristineGlb(), '#ffffff');
    for (const body of bodyMeshes(tree)) {
      const bodyMat = body.material as MeshStandardMaterial;
      expect(bodyMat.depthWrite).toBe(true);

      const outline = body.children.find((c) => (c as Mesh).userData.isOutlineShell) as Mesh;
      const outlineMat = outline.material as MeshBasicMaterial;
      expect(outlineMat.depthWrite).toBe(true);
      expect(outlineMat.side).toBe(BackSide);
    }
  });

  it('disables frustum culling on every mesh', () => {
    // Frustum culling on small meshes parented to a deep group
    // chain misfires under cascade vCam transforms — the local
    // cursor disables it for the same reason.
    const tree = buildCursorTree(makePristineGlb(), '#ffffff');
    for (const body of bodyMeshes(tree)) {
      expect(body.frustumCulled).toBe(false);
      const outline = body.children.find((c) => (c as Mesh).userData.isOutlineShell) as Mesh;
      expect(outline.frustumCulled).toBe(false);
    }
  });

  it('does not mutate the source tree', () => {
    const source = makePristineGlb();
    const sourceMeshCount = bodyMeshes(source).length;
    const sourceFirstMaterial = (source.children[0] as Mesh).material;

    buildCursorTree(source, '#ffffff');

    expect(bodyMeshes(source)).toHaveLength(sourceMeshCount);
    expect((source.children[0] as Mesh).material).toBe(sourceFirstMaterial);
    // No outline shells leaked back into the source.
    for (const m of source.children as Mesh[]) {
      expect(m.children.length).toBe(0);
    }
  });
});
