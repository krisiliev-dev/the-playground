/**
 * Tests for the camera-layer constants used by the scene composition.
 *
 * Layers are a 32-bit bitfield on `THREE.Object3D` and `THREE.Camera`.
 * A mesh renders for a camera only when their layer masks intersect.
 * These constants map semantic roles (cursor, portal rim, cascade
 * overlay) onto specific bit positions; this file pins:
 *
 *   - The constants are distinct (no two roles map to the same bit).
 *   - They're in range [1, 31] (bit 0 is the default layer; we
 *     explicitly leave it for "ordinary scene content").
 *   - The Three.js Layers class behaves as expected — a camera with
 *     a given role's layer enabled "passes" a mesh that has only
 *     that layer enabled. This is the load-bearing property the
 *     cascade renderer relies on for `Phase D pass 2` (vCam set to
 *     CASCADE_OVERLAY_LAYER renders only overlay-tagged meshes).
 */
import { describe, it, expect } from 'vitest';
import { Layers } from 'three';
import {
  CASCADE_OVERLAY_LAYER,
  CURSOR_LAYER,
  PORTAL_LAYER,
  PORTAL_SURFACE_LAYER,
} from '@/components/scene/sceneLayers';

describe('scene layer constants', () => {
  it('all constants are valid layer indices in [1, 31]', () => {
    // Bit 0 is the default layer (every Object3D has it on by default).
    // Reserve roles to bits 1-31 so they coexist with default content.
    for (const layer of [
      CURSOR_LAYER,
      PORTAL_LAYER,
      PORTAL_SURFACE_LAYER,
      CASCADE_OVERLAY_LAYER,
    ]) {
      expect(layer).toBeGreaterThanOrEqual(1);
      expect(layer).toBeLessThanOrEqual(31);
      expect(Number.isInteger(layer)).toBe(true);
    }
  });

  it('all constants are distinct (no role aliases another)', () => {
    const layers = [
      CURSOR_LAYER,
      PORTAL_LAYER,
      PORTAL_SURFACE_LAYER,
      CASCADE_OVERLAY_LAYER,
    ];
    const unique = new Set(layers);
    expect(unique.size).toBe(layers.length);
  });
});

describe('CASCADE_OVERLAY_LAYER — interaction with Three.js Layers', () => {
  // The cascade renderer's Phase D pass 2 sets vCam.layers to JUST
  // CASCADE_OVERLAY_LAYER (after a fresh `set(...)` which wipes all
  // bits). These tests pin the resulting visibility-test behavior so
  // a future Three.js Layers semantic change wouldn't silently break
  // the overlay pass.

  it('a mesh with only the overlay layer matches a camera with only the overlay layer', () => {
    const camLayers = new Layers();
    camLayers.set(CASCADE_OVERLAY_LAYER); // wipes default bit 0 too
    const meshLayers = new Layers();
    meshLayers.disable(0);
    meshLayers.enable(CASCADE_OVERLAY_LAYER);
    expect(camLayers.test(meshLayers)).toBe(true);
  });

  it('a mesh with only layer 0 does NOT match a camera set to overlay-only', () => {
    // Phase D pass 2 of the cascade isolates overlay-tagged content
    // by zeroing all other bits. A default-layer mesh (cube, rim
    // particle on its own portal layer, etc.) MUST be filtered out
    // here, otherwise the second pass would re-render scene geometry
    // and overwrite the inner recursion's content.
    const camLayers = new Layers();
    camLayers.set(CASCADE_OVERLAY_LAYER);
    const meshLayers = new Layers(); // default → bit 0 only
    expect(camLayers.test(meshLayers)).toBe(false);
  });

  it('a mesh on BOTH layer 0 AND overlay matches a camera on either', () => {
    // This is the route-content text setup: text stays on layer 0
    // for main-view rendering AND adds CASCADE_OVERLAY_LAYER for the
    // cascade overlay pass. Both paths must hit it.
    const meshLayers = new Layers();
    meshLayers.enable(CASCADE_OVERLAY_LAYER); // bit 0 stays enabled

    const mainCam = new Layers(); // layer 0 (default)
    expect(mainCam.test(meshLayers)).toBe(true);

    const overlayCam = new Layers();
    overlayCam.set(CASCADE_OVERLAY_LAYER);
    expect(overlayCam.test(meshLayers)).toBe(true);
  });

  it('Phase D pass 1 vCam (layers 0 + PORTAL) does NOT see overlay-only meshes', () => {
    // Pass 1 is supposed to render cube + rim but NOT cursor in-scene.
    // This pins the layer-mask config that achieves that exclusion.
    const passOneCam = new Layers();
    passOneCam.set(0);
    passOneCam.enable(PORTAL_LAYER);

    const overlayOnlyMesh = new Layers();
    overlayOnlyMesh.disable(0);
    overlayOnlyMesh.enable(CASCADE_OVERLAY_LAYER);

    expect(passOneCam.test(overlayOnlyMesh)).toBe(false);
  });
});
