/**
 * Rooms — the three 3D destinations the section portals lead to.
 *
 * Each room is an inverted cube (BackSide rendering, avatar stands
 * inside) with a section-tinted MeshStandardMaterial. The cubes
 * are positioned far from the formation cube in distinct world
 * directions so they're spatially distinct destinations that the
 * portal walk-through can teleport the avatar into. They're
 * mounted unconditionally so they exist in the scene graph from
 * mount onward; subsequent phases wire up:
 *
 *   - the avatar's per-cube clamping context (so walking inside
 *     a room clamps to that room's bounds, not the formation cube),
 *   - portal walk-through actually translating the avatar's
 *     position into a room (rather than just dispatching a route),
 *   - the return portal that sends the avatar back to the
 *     formation,
 *   - URL sync (avatar in About room ↔ /about).
 *
 * SE quadrant has no room — Simple Experience is a documentMode
 * flip, not a 3D destination, so only three rooms exist.
 *
 * Positions are spread along distinct world axes far from the
 * formation cube (which spans ±400). 1500-unit offsets keep the
 * rooms well clear of the formation and of each other while leaving
 * room to refine layout in later phases.
 */
import { BackSide } from 'three';
import type { Vector3Tuple } from 'three';

interface RoomConfig {
  id: string;
  /** Route this room corresponds to. URL sync uses this in a later phase. */
  path: string;
  /** World-space center of the room cube. */
  position: Vector3Tuple;
  /** Section-tinted color — same hex as the matching portal pie. */
  color: string;
  /** Cube edge lengths along each axis. */
  dimensions: Vector3Tuple;
}

/** Default room cube size — smaller than the formation's 800-unit
 *  cube; rooms are intimate spaces rather than open worlds. */
const ROOM_SIZE: Vector3Tuple = [400, 400, 400];

export const ROOMS: ReadonlyArray<RoomConfig> = [
  {
    id: 'room-about',
    path: '/about',
    position: [1500, 0, 0],
    color: '#4169e1',
    dimensions: ROOM_SIZE,
  },
  {
    id: 'room-projects',
    path: '/projects',
    position: [-1500, 0, 0],
    color: '#ff6ec7',
    dimensions: ROOM_SIZE,
  },
  {
    id: 'room-writing',
    path: '/writing',
    position: [0, 0, 1500],
    color: '#ffcc66',
    dimensions: ROOM_SIZE,
  },
];

export function Rooms(): JSX.Element {
  return (
    <>
      {ROOMS.map((room) => (
        <Room
          key={room.id}
          position={room.position}
          color={room.color}
          dimensions={room.dimensions}
        />
      ))}
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
