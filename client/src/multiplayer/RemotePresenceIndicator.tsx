/**
 * RemotePresenceIndicator — third-person rendering of a remote
 * player's presence state (per ADR-006). Mounted as a child of
 * each `<RemoteCursorAvatar>`; reads the entity's `props` bag
 * for presence keys (menu, etc.) and renders the corresponding
 * world-space affordance over that player's cursor.
 *
 * Slice 3a: only the menu plane is wired. Slice 3b will add
 * proximity-based interactable highlights (the `near` prop is
 * surfaced into the world via the *target* object animating, not
 * a per-player overlay, so it doesn't render here).
 */
import { Text } from '@react-three/drei';
import type { Entity } from './types';

interface RemotePresenceIndicatorProps {
  entity: Entity;
}

export function RemotePresenceIndicator({ entity }: RemotePresenceIndicatorProps): JSX.Element {
  const menu = readMenu(entity);

  return (
    <>
      {menu !== null && <MenuPanel />}
      {/* Future slice 3b additions go here — but `near` is rendered on
          the *target* object, not over the cursor, so it lives elsewhere. */}
    </>
  );
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
// All sizes are in the *pre-scale* frame — the parent cursor
// group multiplies by REMOTE_AVATAR_SCALE (0.03), so a width
// of 80 here ends up ~2.4 world units. Tuned so the menu
// is comfortably readable a few units away from the remote
// cursor without dwarfing the cursor model itself.

const PANEL_WIDTH = 80;
const PANEL_HEIGHT = 110;
const PANEL_FORWARD_OFFSET = 90;
const PANEL_VERTICAL_OFFSET = 30;
const PANEL_BG_COLOR = '#0f1117';
const PANEL_BORDER_COLOR = '#00ffcc';
const PANEL_OPACITY = 0.92;

const TEXT_COLOR = '#e0e0e8';
const TEXT_SIZE = 7.5;
const TEXT_LINE_SPACING = 11;

/** Items match the local PauseMenu's section list. Kept hand-
 *  synced rather than imported from `PauseMenu.tsx` because that
 *  module pulls in DOM-only dependencies (react-router); a quiet
 *  duplication is cheaper than a circular-dep workaround. Update
 *  both when the section list changes. */
const MENU_ITEMS: readonly string[] = [
  'Home',
  'About',
  'Projects',
  'Writing',
  'Contact',
  'Simple Experience',
];

/**
 * The menu panel — a stylised 2D plane with the section list
 * rendered as 3D text. Orientation: rotated 180° around Y so
 * its front face points back at the remote cursor (i.e. the
 * "owner" of the menu reads it). Other viewers see it from
 * whatever angle they're at — walking around the remote cursor
 * naturally reveals the back/sides of the panel, like watching
 * someone read a book.
 */
function MenuPanel(): JSX.Element {
  // Total stack height for vertical centring.
  const stackHeight = (MENU_ITEMS.length - 1) * TEXT_LINE_SPACING;
  const topY = stackHeight / 2;

  return (
    <group
      position={[0, PANEL_VERTICAL_OFFSET, PANEL_FORWARD_OFFSET]}
      // 180° around Y: the panel's geometry default-faces local +Z;
      // we want it facing local -Z so the cursor (at local origin,
      // looking down +Z toward the panel) sees the FRONT of it.
      rotation={[0, Math.PI, 0]}
    >
      {/* Background. Slight inset border via two stacked planes —
          cheaper than a textured border and reads cleanly at the
          panel's size. */}
      <mesh frustumCulled={false}>
        <planeGeometry args={[PANEL_WIDTH + 2, PANEL_HEIGHT + 2]} />
        <meshBasicMaterial
          color={PANEL_BORDER_COLOR}
          transparent
          opacity={PANEL_OPACITY * 0.55}
        />
      </mesh>
      <mesh frustumCulled={false} position={[0, 0, 0.05]}>
        <planeGeometry args={[PANEL_WIDTH, PANEL_HEIGHT]} />
        <meshBasicMaterial color={PANEL_BG_COLOR} transparent opacity={PANEL_OPACITY} />
      </mesh>

      {/* Section labels — top to bottom, line-spaced. Each item is
          a separate <Text> — drei caches the font/SDF atlas, so
          additional labels are cheap. The slight forward offset
          (+0.1 z) keeps the text from z-fighting the bg plane. */}
      {MENU_ITEMS.map((label, i) => (
        <Text
          key={label}
          position={[0, topY - i * TEXT_LINE_SPACING, 0.1]}
          fontSize={TEXT_SIZE}
          color={TEXT_COLOR}
          anchorX="center"
          anchorY="middle"
        >
          {label}
        </Text>
      ))}
    </group>
  );
}
