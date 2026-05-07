/**
 * Centralised render-order registry.
 *
 * Three.js sorts opaque meshes front-to-back by camera distance and
 * transparent meshes back-to-front. `mesh.renderOrder` is the manual
 * override — meshes with higher values draw LATER (on top), within
 * the same render pass.
 *
 * This file names every render-order slot the scene uses, so that a
 * reader can answer "what draws on top of what, and why?" without
 * scanning the codebase for magic numbers. Adding a new layer? Pick
 * a band that documents the visual category (foreground vs.
 * background, UI vs. world), then assign a value inside it.
 *
 * # The bands
 *
 * Bands are spaced by 100 so we have room to slot extra layers
 * between two existing ones without renumbering everything.
 *
 *  -100..   -1   BACKGROUND   sky / far visuals that should never win
 *                             a tied depth test against world geometry
 *     0          SCENE        ordinary scene meshes (cube walls,
 *                             swords, portal rims) — the Three.js
 *                             default; do not override unless needed
 *   100..  199   ATMOSPHERIC  full-screen overlays drawn after the
 *                             world (haze, fog cards) but BENEATH the
 *                             cursor + UI affordances
 *   200..  299   CURSOR       avatar cursor (in-scene depth-tested
 *                             copy + main-view always-on-top copy)
 *   900..  999   FOREGROUND   reserved for emergency on-top elements
 *
 * # When NOT to use renderOrder
 *
 * Render-order is the wrong tool for many "X draws over Y" issues.
 * Before reaching for a value here, check whether the real fix is:
 *
 *   - `depthTest`        — the depth buffer already encodes "what is
 *                          in front of what." If geometry should
 *                          occlude something, leave depthTest on. If
 *                          something needs to draw on top regardless
 *                          (e.g. cursor as UI), set depthTest=false.
 *
 *   - `camera.layers`    — when objects shouldn't be visible to a
 *                          given camera at all (e.g. portal-surface
 *                          stencil planes are excluded from the
 *                          main render pass), use layers, not
 *                          renderOrder.
 *
 *   - render-pass split  — when the issue is "phase A wrote pixels,
 *                          phase B overwrote them." Fix the pass
 *                          ordering or stencil/depth setup, not the
 *                          renderOrder.
 *
 * Render-order is the right tool when two transparent (or
 * depthTest=false) meshes are drawn in the same pass and need a
 * deterministic paint order — e.g. cursor body vs. cursor outline,
 * or haze vs. cursor.
 */

/** Atmospheric overlays — translucent full-FOV planes (haze, fog).
 *  Drawn after world geometry so they tint the scene, but before
 *  the cursor so UI stays crisp. */
export const RENDER_ORDER_HAZE = 100;

/** Cursor outline (BackSide-rendered enlarged shell). Must draw
 *  BEFORE the cursor body so the body covers the outline's
 *  interior — leaving only the silhouette halo visible. */
export const RENDER_ORDER_CURSOR_OUTLINE = 201;

/** Cursor body (frontmost UI affordance — always visible to the
 *  player). Drawn after the outline shell so it covers the
 *  shell's interior; combined with `depthTest: false`, this
 *  keeps the cursor on top regardless of scene composition. */
export const RENDER_ORDER_CURSOR_BODY = 202;
