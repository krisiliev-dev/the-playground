/**
 * renderOrder — invariant tests.
 *
 * The registry's whole point is to make "what draws on top of what"
 * a single-file decision. These tests lock in the *relative* ordering
 * the rest of the scene assumes, so a casual edit to one constant
 * fails CI rather than silently flipping a visual layering rule.
 *
 * Absolute values aren't tested — only relationships. Re-banding the
 * registry (e.g. shifting the cursor band from 200 → 500) shouldn't
 * fail this file as long as the relative order is preserved.
 */
import { describe, it, expect } from 'vitest';
import {
  RENDER_ORDER_HAZE,
  RENDER_ORDER_CURSOR_BODY,
  RENDER_ORDER_CURSOR_OUTLINE,
} from '@/components/scene/renderOrder';

describe('renderOrder registry', () => {
  it('haze draws after default scene geometry (haze > 0)', () => {
    // World meshes use Three.js default renderOrder=0. Haze tints
    // them on the way to the eye, so it must paint later.
    expect(RENDER_ORDER_HAZE).toBeGreaterThan(0);
  });

  it('cursor draws on top of atmospheric haze', () => {
    // The cursor is a UI affordance — should never be obscured by
    // a visual veil.
    expect(RENDER_ORDER_CURSOR_BODY).toBeGreaterThan(RENDER_ORDER_HAZE);
    expect(RENDER_ORDER_CURSOR_OUTLINE).toBeGreaterThan(RENDER_ORDER_HAZE);
  });

  it('cursor body draws after its outline shell', () => {
    // The outline is a BackSide-rendered enlarged copy. The body must
    // paint LATER so it covers the outline's interior, leaving only
    // the silhouette halo visible. Flipping this would turn the
    // cursor into a solid outline-coloured blob.
    expect(RENDER_ORDER_CURSOR_BODY).toBeGreaterThan(RENDER_ORDER_CURSOR_OUTLINE);
  });
});
