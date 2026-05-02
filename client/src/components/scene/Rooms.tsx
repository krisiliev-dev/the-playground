/**
 * Rooms — the three 3D destinations the section portals lead to.
 *
 * Each room is an inverted cube (BackSide rendering, avatar stands
 * inside) with a section-tinted MeshStandardMaterial. The three
 * rooms are spatially coherent with the disc: they sit BEHIND the
 * impact wall in a left-to-right row matching the user's
 * perspective looking through the disc — Writing (yellow) on the
 * left, Projects (pink) in the middle, About (blue) on the right.
 *
 * Positions derive from `clickHit` at render time:
 *   - "back" = `-clickHit.normal` (outward from the wall, away
 *     from the cube interior).
 *   - "right" = `clickHit.normal × world_up` — the user's right
 *     when looking out through the disc.
 *   - Each room sits at clickHit.point + back × DISTANCE +
 *     right × (slot × SPACING), with slot ∈ {-1, 0, +1}.
 *
 * SE quadrant has no room — Simple Experience is a documentMode
 * flip, not a 3D destination. Phase 4 step 1 is geometry only;
 * traversal, per-room clamping, and URL sync land in subsequent
 * commits.
 */
import { useMemo } from 'react';
import { BackSide, Vector3 } from 'three';
import type { Vector3Tuple } from 'three';
import { useWorldStore, type ClickHit } from '@/store';

interface RoomConfig {
  id: string;
  /** Route this room corresponds to. URL sync uses this in a later phase. */
  path: string;
  /** Lateral slot position relative to the disc center, in the
   *  user's view when looking out through the disc:
   *    -1 = left, 0 = centre, +1 = right. */
  slot: -1 | 0 | 1;
  /** Section-tinted color — same hex as the matching portal pie. */
  color: string;
  /** Cube edge lengths along each axis. */
  dimensions: Vector3Tuple;
}

/** Default room cube size — smaller than the formation's 800-unit
 *  cube; rooms are intimate spaces rather than open worlds. */
const ROOM_SIZE: Vector3Tuple = [400, 400, 400];

/** How far behind the impact wall to place the row of rooms. Far
 *  enough that they read as "in the distance" through the disc;
 *  close enough that the avatar can reach them once traversal is
 *  wired up. */
const ROOM_BEHIND_DISTANCE = 1500;

/** Lateral spacing between adjacent rooms (centre-to-centre). With
 *  ROOM_SIZE.x = 400, 600 leaves a 200-unit gap between cube faces
 *  so they don't touch. */
const ROOM_SPACING = 600;

const WORLD_UP = new Vector3(0, 1, 0);

export const ROOMS: ReadonlyArray<RoomConfig> = [
  // Right-most slot when looking through the disc. About = royal blue.
  { id: 'room-about', path: '/about', slot: 1, color: '#4169e1', dimensions: ROOM_SIZE },
  // Centre slot. Projects = pink.
  { id: 'room-projects', path: '/projects', slot: 0, color: '#ff6ec7', dimensions: ROOM_SIZE },
  // Left-most slot. Writing = amber/yellow.
  { id: 'room-writing', path: '/writing', slot: -1, color: '#ffcc66', dimensions: ROOM_SIZE },
];

/**
 * Compute the world-space center of a room given the impact
 * wall's clickHit and the room's lateral slot. Pure function —
 * extracted so the spatial layout is unit-testable without
 * mounting an R3F scene.
 *
 * Layout: from `clickHit.point`, walk `ROOM_BEHIND_DISTANCE` units
 * outward along `-clickHit.normal` (back through the wall), then
 * step `slot × ROOM_SPACING` units along the user's right axis
 * (`clickHit.normal × world_up`). Result: a row of three rooms
 * lined up perpendicular to the wall normal at uniform depth.
 */
export function computeRoomPosition(clickHit: ClickHit, slot: number): Vector3Tuple {
  const center = new Vector3(...clickHit.point);
  const normal = new Vector3(...clickHit.normal);
  const back = normal.clone().negate();
  const right = normal.clone().cross(WORLD_UP).normalize();
  const pos = center
    .clone()
    .addScaledVector(back, ROOM_BEHIND_DISTANCE)
    .addScaledVector(right, slot * ROOM_SPACING);
  return [pos.x, pos.y, pos.z];
}

export function Rooms(): JSX.Element | null {
  const clickHit = useWorldStore((s) => s.clickHit);

  // Positions derive from clickHit; recompute only when it changes
  // (typically once per session, on the user's first cube click).
  // We pass `clickHit` itself as the dep — the store object is
  // stable across renders if the contents haven't changed.
  const positions = useMemo(() => {
    if (!clickHit) {
      return null;
    }
    return ROOMS.map((room) => computeRoomPosition(clickHit, room.slot));
  }, [clickHit]);

  if (!positions) {
    // Rooms only exist relative to where the swords landed —
    // before clickHit is set, nothing to render.
    return null;
  }

  return (
    <>
      {ROOMS.map((room, i) => {
        const position = positions[i];
        if (!position) {
          return null;
        }
        return (
          <Room key={room.id} position={position} color={room.color} dimensions={room.dimensions} />
        );
      })}
    </>
  );
}

interface RoomProps {
  position: Vector3Tuple;
  color: string;
  dimensions: Vector3Tuple;
}

/**
 * A single room — an inverted cube the avatar stands inside.
 *
 * BackSide rendering hides the back-facing geometry so we see only
 * the inside walls; emissiveIntensity at 0.12 gives a subtle ambient
 * glow in the room's color so the space feels lit by its own
 * atmosphere rather than the scene's ambient light.
 */
function Room({ position, color, dimensions }: RoomProps): JSX.Element {
  return (
    <mesh position={position}>
      <boxGeometry args={dimensions} />
      <meshStandardMaterial
        color={color}
        side={BackSide}
        emissive={color}
        emissiveIntensity={0.12}
        metalness={0.3}
        roughness={0.7}
      />
    </mesh>
  );
}
