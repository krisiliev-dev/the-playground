/**
 * Three.js camera-layer constants used by the scene composition.
 *
 * Layers are a 32-bit bitfield on every Object3D and PerspectiveCamera.
 * An object only renders for a camera when their layer masks intersect.
 * We use this to keep a small UI element (the cursor avatar) renderable
 * alongside any active scene without having to mount it inside each
 * scene's `createPortal` subtree.
 *
 * Layer 0 is the default — every object lives there unless explicitly
 * moved. Don't add to this file unless you have a real reason for a
 * dedicated channel; layer juggling is cheap to add and expensive to
 * untangle.
 */

/** Cursor avatar mesh + outline shells. Enabled persistently on the
 *  main camera by `<SceneHost>` so the cursor renders in any active
 *  scene. Render-order on the mesh keeps it visually on top. */
export const CURSOR_LAYER = 2;

/** Portal rim cylinders (the colored cyan/pink/etc. bars tracing
 *  each portal's edge). Drawn as ordinary opaque geometry — when
 *  rendered in a portal's through-view they appear at their actual
 *  world position with full perspective, producing the iconic
 *  Portal-game tunnel shrinkage. */
export const PORTAL_LAYER = 3;

/** Portal SURFACE planes (the rectangle that gets stencil-marked,
 *  not drawn as visible color). Separated from PORTAL_LAYER so the
 *  stencil pass can render only surfaces (no rims, no other meshes)
 *  by setting camera.layers to this value alone. The cascade
 *  toggles this layer on/off to control which pass renders surfaces
 *  for stencil writing vs. excludes them entirely. */
export const PORTAL_SURFACE_LAYER = 4;

/** Cascade "overlay" layer — anything that should render in a
 *  cascade through-view's POST-recursion pass, on top of any deeper
 *  recursion content within the level's stencil region.
 *
 *  Why it exists: Phase D pass 1 renders the scene, then Phase E
 *  recurses, overwriting the inner sub-region R_{N+1} ⊂ R_N with
 *  the next level's content. Anything whose screen projection from
 *  vCam_N falls inside R_{N+1} is invisible at level N — only the
 *  deepest level (where Phase E does nothing) preserves it. Cube
 *  walls and rim particles avoid this because they extend beyond
 *  R_{N+1} at every level, but small objects at world center (the
 *  cursor avatar, centered text) get fully swallowed.
 *
 *  Objects on this layer are excluded from Phase D pass 1 and
 *  re-rendered in Phase D pass 2 (after the recursion returns), so
 *  they appear at the OUTER level's perspective, on top of inner
 *  cascade content within R_N. Trade-off: the outermost level's
 *  view of these objects "wins" the screen-center pixels — by
 *  design, since that's what reads as "I see my cursor through the
 *  portal" rather than "I see only the innermost recursion's cursor
 *  buried at sub-pixel size."
 *
 *  Used by:
 *    - The cursor's in-scene copy (depth-tested, separate from the
 *      always-on-top `CURSOR_LAYER` main-view copy).
 *    - The route-content text meshes (shared with layer 0 so they
 *      also render in main view). */
export const CASCADE_OVERLAY_LAYER = 5;
