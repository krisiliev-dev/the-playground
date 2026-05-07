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

/** Forward offset = world +Z direction. With the typical scene
 *  setup (cameras at z≈-360 looking toward origin) this puts the
 *  panel between observer and remote cursor for any observer on
 *  that same side — visually "in front of" the cursor from their
 *  POV. Static in world coords because the indicator group is
 *  position-only, so the panel never orbits or jitters with the
 *  remote cursor's rotation. */
const PANEL_FORWARD_OFFSET = 6;
const PANEL_VERTICAL_OFFSET = 0.4;

/** drei's <Html transform> scales by `distanceFactor / cameraDist`
 *  (capped at 1). Larger distanceFactor → larger rendered Html.
 *  At typical scene distances (~5-50 world units between observer
 *  and panel), distanceFactor ≈ 8 keeps the panel readable without
 *  dominating the view. Tune up if the panel feels small, down if
 *  it feels overwhelming. */
const HTML_DISTANCE_FACTOR = 8;

const BACK_PLATE_WIDTH = 6;
const BACK_PLATE_HEIGHT = 8;
const BACK_PLATE_BG = '#12121a';
const BACK_PLATE_BORDER = '#00ffcc';
const BACK_PLATE_OPACITY = 0.95;

function MenuPanel(): JSX.Element {
  // No Billboard, no useFrame — the panel is parented to the
  // cursor's local frame and stays at its local position +
  // orientation. As the remote cursor moves and rotates, the
  // panel moves and rotates with it, like an object physically
  // attached to the cursor. From a stationary observer's POV,
  // the panel is "still" in the sense that no per-frame
  // billboard math is reorienting it.
  return (
    <group position={[0, PANEL_VERTICAL_OFFSET, PANEL_FORWARD_OFFSET]}>
      {/* Solid back plate — sits slightly behind the Html origin
          so observers who walk around to the cursor's other side
          see an opaque rectangle instead of the CSS3D backface.
          Plane geometry's default FrontSide means the back of
          the plate is invisible, which is correct: the back of
          the back plate is the *front* of the panel from the
          owner's POV. */}
      <mesh position={[0, 0, -0.05]} frustumCulled={false}>
        <planeGeometry args={[BACK_PLATE_WIDTH + 0.2, BACK_PLATE_HEIGHT + 0.2]} />
        <meshBasicMaterial color={BACK_PLATE_BORDER} transparent opacity={0.55} />
      </mesh>
      <mesh position={[0, 0, -0.04]} frustumCulled={false}>
        <planeGeometry args={[BACK_PLATE_WIDTH, BACK_PLATE_HEIGHT]} />
        <meshBasicMaterial color={BACK_PLATE_BG} transparent opacity={BACK_PLATE_OPACITY} />
      </mesh>

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
        <div style={{ pointerEvents: 'none', userSelect: 'none' }}>
          <RemotePauseMenuView />
        </div>
      </Html>
    </group>
  );
}
