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
// All offsets are in the *pre-scale* frame — the parent cursor
// group multiplies by REMOTE_AVATAR_SCALE (0.03), so a forward
// offset of 70 here ends up ~2.1 world units in front of the
// cursor.

/** Position the panel in the cursor's local +Z direction —
 *  which (because cursor.quaternion mirrors the camera that
 *  follows it) is the direction "behind the cursor's facing"
 *  but visually "in front of the cursor" from any observer
 *  whose own camera is on that same side. The plane's default
 *  front face also points in +Z, so it naturally faces the
 *  observer with no rotation needed.
 *
 *  Slight Y lift so the panel doesn't collide with the cursor
 *  geometry; tune up for "menu floats above" vs. tune to 0 for
 *  "menu sits in line with cursor's facing." */
const PANEL_FORWARD_OFFSET = 70;
const PANEL_VERTICAL_OFFSET = 8;

/** Larger distance-factor on drei's `<Html transform>` makes the
 *  CSS pixels span fewer world units — i.e. the panel appears
 *  bigger relative to the rest of the scene. Tuned so the panel
 *  reads from a few units away without dwarfing the cursor model
 *  itself. Slice 3a default (80) felt undersized in playtest. */
const HTML_DISTANCE_FACTOR = 50;

const BACK_PLATE_WIDTH = 130;
const BACK_PLATE_HEIGHT = 180;
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
      <mesh position={[0, 0, -1]} frustumCulled={false}>
        <planeGeometry args={[BACK_PLATE_WIDTH + 4, BACK_PLATE_HEIGHT + 4]} />
        <meshBasicMaterial color={BACK_PLATE_BORDER} transparent opacity={0.55} />
      </mesh>
      <mesh position={[0, 0, -0.95]} frustumCulled={false}>
        <planeGeometry args={[BACK_PLATE_WIDTH, BACK_PLATE_HEIGHT]} />
        <meshBasicMaterial color={BACK_PLATE_BG} transparent opacity={BACK_PLATE_OPACITY} />
      </mesh>

      <Html
        transform
        sprite={false}
        distanceFactor={HTML_DISTANCE_FACTOR}
        occlude={false}
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
