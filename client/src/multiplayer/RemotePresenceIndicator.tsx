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
import { useRef } from 'react';
import { Billboard, Html } from '@react-three/drei';
import type { Group } from 'three';
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
// group multiplies by REMOTE_AVATAR_SCALE (0.03), so a vertical
// offset of 60 here ends up ~1.8 world units above the cursor.

const PANEL_VERTICAL_OFFSET = 60;
const HTML_DISTANCE_FACTOR = 80;

/** Solid back plate sized to fit roughly behind the rendered DOM
 *  panel. Width/height are in pre-scale units; the cursor group's
 *  0.03 scale brings them down to world dimensions. The Html element
 *  pins itself to a 0,0,0 origin within the Billboard, with its CSS
 *  size determining visible footprint — the back plate just needs
 *  to be large enough to occlude that footprint from behind. */
const BACK_PLATE_WIDTH = 90;
const BACK_PLATE_HEIGHT = 130;
const BACK_PLATE_BG = '#12121a';
const BACK_PLATE_BORDER = '#00ffcc';
const BACK_PLATE_OPACITY = 0.95;

function MenuPanel(): JSX.Element {
  const groupRef = useRef<Group>(null);

  // Billboard wraps the panel so it always faces the local viewer's
  // camera, regardless of how the remote cursor's group is rotated.
  // Without this, the panel would inherit the cursor's mouselook
  // rotation and orbit visibly as the remote player turned.
  return (
    <Billboard ref={groupRef} position={[0, PANEL_VERTICAL_OFFSET, 0]} follow>
      {/* Solid back plate — placed slightly behind the Html origin
          so observers viewing from the back of the panel see an
          opaque rectangle instead of the CSS3D backface (which
          would otherwise show the DOM mirrored or transparent). */}
      <mesh position={[0, 0, -1]} frustumCulled={false}>
        <planeGeometry args={[BACK_PLATE_WIDTH + 4, BACK_PLATE_HEIGHT + 4]} />
        <meshBasicMaterial color={BACK_PLATE_BORDER} transparent opacity={0.55} />
      </mesh>
      <mesh position={[0, 0, -0.95]} frustumCulled={false}>
        <planeGeometry args={[BACK_PLATE_WIDTH, BACK_PLATE_HEIGHT]} />
        <meshBasicMaterial color={BACK_PLATE_BG} transparent opacity={BACK_PLATE_OPACITY} />
      </mesh>

      {/* Pixel-perfect pause-menu DOM, projected into 3D via
          drei's Html transform. distanceFactor scales the CSS
          pixels relative to world units; tuned with the cursor's
          REMOTE_AVATAR_SCALE so the panel reads at a comfortable
          size from typical viewing distances. */}
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
    </Billboard>
  );
}
