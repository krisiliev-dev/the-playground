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
import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import type { Group, Mesh } from 'three';
import type { Entity } from './types';

interface RemotePresenceIndicatorProps {
  entity: Entity;
}

/** Distance the menu plane floats in front of the remote cursor.
 *  Local-frame; cursor's transform handles world-space placement. */
const MENU_PLANE_FORWARD_OFFSET = 80;
const MENU_PLANE_VERTICAL_OFFSET = 40;
const MENU_PLANE_WIDTH = 60;
const MENU_PLANE_HEIGHT = 36;
const MENU_PLANE_BG = '#0f1117';
const MENU_PLANE_ICON = '#00ffcc';

export function RemotePresenceIndicator({ entity }: RemotePresenceIndicatorProps): JSX.Element {
  const menu = readMenu(entity);

  return (
    <>
      {menu !== null && <MenuPlane menuKind={menu} />}
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

interface MenuPlaneProps {
  menuKind: string;
}

/** A small 2D plane floating in front of the remote cursor that
 *  faces the local viewer's camera (billboard). Stylised — a dark
 *  rectangle with a cyan "II" pause icon — not a literal mirror of
 *  the local pause-menu UI per ADR-006's stylised-not-literal
 *  guidance.
 *
 *  Per-frame work: we re-orient toward the camera each frame
 *  (manual lookAt rather than drei's <Billboard> to avoid the
 *  extra dependency surface and to keep the cursor scale chain
 *  simple — the indicator inherits the cursor group's scale, so
 *  REMOTE_AVATAR_SCALE = 0.03 means our plane geometry must be
 *  authored in the much-larger pre-scale frame). */
function MenuPlane({ menuKind: _menuKind }: MenuPlaneProps): JSX.Element {
  const groupRef = useRef<Group>(null);
  const camera = useThree((s) => s.camera);

  useFrame(() => {
    const group = groupRef.current;
    if (!group) {
      return;
    }
    // Billboard: face the local camera. Not the cursor's camera —
    // we want THIS viewer's camera, which is what useThree exposes.
    group.quaternion.copy(camera.quaternion);
  });

  return (
    <group ref={groupRef} position={[0, MENU_PLANE_VERTICAL_OFFSET, MENU_PLANE_FORWARD_OFFSET]}>
      {/* Dark rectangular background. */}
      <mesh frustumCulled={false}>
        <planeGeometry args={[MENU_PLANE_WIDTH, MENU_PLANE_HEIGHT]} />
        <meshBasicMaterial color={MENU_PLANE_BG} transparent opacity={0.85} />
      </mesh>
      {/* Pause icon — two parallel bars rendered as small mesh
          panels. Simple geometry so we don't need a font/texture
          for slice 3a; future versions can swap in a textured
          plane or the actual pause-menu render-target. */}
      <PauseBars />
    </group>
  );
}

const PAUSE_BAR_WIDTH = 6;
const PAUSE_BAR_HEIGHT = 18;
const PAUSE_BAR_SPACING = 12;

function PauseBars(): JSX.Element {
  return (
    <group position={[0, 0, 0.1]}>
      <PauseBar x={-PAUSE_BAR_SPACING / 2} />
      <PauseBar x={+PAUSE_BAR_SPACING / 2} />
    </group>
  );
}

function PauseBar({ x }: { x: number }): JSX.Element {
  const ref = useRef<Mesh>(null);
  return (
    <mesh ref={ref} position={[x, 0, 0]} frustumCulled={false}>
      <planeGeometry args={[PAUSE_BAR_WIDTH, PAUSE_BAR_HEIGHT]} />
      <meshBasicMaterial color={MENU_PLANE_ICON} />
    </mesh>
  );
}
