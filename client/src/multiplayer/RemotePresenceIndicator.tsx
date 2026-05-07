/**
 * RemotePresenceIndicator — third-person rendering of a remote
 * player's presence state (per ADR-006). Mounted as a child of
 * each `<RemoteCursorAvatar>`; reads the entity's `props` bag
 * for presence keys (menu, etc.) and renders the corresponding
 * world-space affordance over that player's cursor.
 *
 * The menu panel uses drei's `<Html transform>` to embed the
 * actual pause-menu DOM in 3D space — this gives pixel-perfect
 * fidelity with the local pause menu (same CSS, same layout, no
 * hand-rolled 3D approximation). The DOM is rendered read-only
 * (no click handlers, no state) since it's a presence indicator,
 * not an interactive surface.
 *
 * A solid 3D back plate is parented behind the Html so an
 * observer who walks around the remote cursor sees an opaque
 * back — CSS3D backfaces would otherwise show the menu mirrored
 * (or invisible if `backfaceVisibility: hidden` is set).
 *
 * Slice 3a: only the menu panel is wired. Slice 3b will add
 * proximity-based interactable highlights (the `near` prop is
 * surfaced into the world via the *target* object animating, not
 * a per-player overlay, so it doesn't render here).
 */
import { Html } from '@react-three/drei';
import type { Entity } from './types';
import { RemotePauseMenuView } from './RemotePauseMenuView';

interface RemotePresenceIndicatorProps {
  entity: Entity;
}

export function RemotePresenceIndicator({ entity }: RemotePresenceIndicatorProps): JSX.Element {
  const menu = readMenu(entity);

  return <>{menu !== null && <MenuPanel />}</>;
}

/** Type-narrow the opaque entity.props.menu value into a string|null.
 *  Defensive: anything other than a non-empty string is treated as
 *  "no menu," so a buggy sender can't make us render based on, say,
 *  `42` or an empty string. */
function readMenu(entity: Entity): string | null {
  const value = (entity.props as { menu?: unknown }).menu;
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }
  return null;
}

// ─── Menu panel ───────────────────────────────────────────────
// Offsets are in WORLD units — the parent presence group is
// scale=1 (separate from the cursor's 0.03 scale chain), so we
// can author dimensions directly without dividing by 0.03.

/** Forward offset = world -Z direction (toward observer). The
 *  scene's cameras spawn at z≈-360 looking at the origin, so
 *  smaller (more negative) z is "closer to observer." Subtracting
 *  from the cursor's z puts the panel between observer and
 *  cursor — visually "in front of" the cursor from any observer
 *  on the typical viewing side. Static in world coords because
 *  the indicator group is position-only, so the panel never
 *  orbits or jitters with the remote cursor's rotation. */
const PANEL_FORWARD_OFFSET = -6;
const PANEL_VERTICAL_OFFSET = 0.4;

/** drei's <Html transform> scales by `distanceFactor / cameraDist`
 *  (capped at 1). Larger distanceFactor → larger rendered Html.
 *  At typical scene distances (~5-50 world units between observer
 *  and panel), distanceFactor ≈ 8 keeps the panel readable without
 *  dominating the view. Tune up if the panel feels small, down if
 *  it feels overwhelming. */
const HTML_DISTANCE_FACTOR = 8;

function MenuPanel(): JSX.Element {
  // Position-only group, no Billboard, no useFrame. The panel
  // travels with the remote cursor's world position but stays
  // at fixed world orientation. No back plate — the Html alone
  // reads correctly from the typical viewing side, and a
  // backside-cover plane was empirically more occlusion trouble
  // than it was worth.
  return (
    <group position={[0, PANEL_VERTICAL_OFFSET, PANEL_FORWARD_OFFSET]}>
      <Html
        transform
        sprite={false}
        distanceFactor={HTML_DISTANCE_FACTOR}
        // occlude="blending" so the Html depth-tests against 3D
        // meshes (cursors, walls). Without this, drei's Html
        // always renders on top of all 3D content — fine for HUDs
        // and labels, wrong for an in-world panel that should be
        // hidden when a closer object passes in front.
        occlude="blending"
        pointerEvents="none"
        zIndexRange={[0, 0]}
      >
        {/* backfaceVisibility:hidden so a viewer on the cursor
            side sees only the back plate (solid), not the
            mirrored DOM behind it. */}
        <div
          style={{
            pointerEvents: 'none',
            userSelect: 'none',
            backfaceVisibility: 'hidden',
          }}
        >
          <RemotePauseMenuView />
        </div>
      </Html>
    </group>
  );
}
