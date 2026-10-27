/**
 * Predefined reveal-spawn slots distributed across the main
 * cube's 4 side walls, plus matching room-exit offsets.
 *
 * The previous design let each player click anywhere to choose
 * their click-hit point, which produced overlapping portal
 * clusters when two players happened to click near each other.
 * Switching to a fixed slot grid eliminates collisions and
 * gives each player a deterministic, predictable home on the
 * wall.
 *
 * Capacity goal: hundreds of simultaneous players. Generated
 * procedurally as a 10×10 grid on each of 4 walls — total 400
 * slots. Players past the 400th wrap modulo 400 and reveal at
 * the same position as an earlier slot (degraded but bounded).
 *
 * Slots are generated lazily: `getSpawnSlot(index)` returns the
 * slot for any index without materialising a 400-entry array.
 * That keeps boot fast and means we can crank `TOTAL_SLOTS` up
 * later (denser grid, more walls) without paying for unused
 * entries.
 */
import type { ClickHit } from '@/store';

export interface SpawnSlot {
  readonly index: number;
  /** Center of this slot's section — the wall point + inward
   *  normal. Used as the default click hit (before the user
   *  clicks) and as the origin for clamping a real click hit
   *  inside the section's wall-plane bounds. */
  readonly clickHit: ClickHit;
  /** Offset from a section room's wall center (room-local x, y)
   *  for THIS slot's room-exit portal. Distinct per slot so
   *  different players' room exits don't overlap. Sized to fit
   *  the 400-unit room wall comfortably. */
  readonly roomExitOffset: readonly [number, number];
  /** Wall-plane "right" axis. Pairs with `wallUp` so the click
   *  clamp can project a 3D hit point onto a 2D wall frame
   *  and clamp tangentially without recomputing the basis. */
  readonly wallRight: readonly [number, number, number];
  /** Wall-plane "up" axis. */
  readonly wallUp: readonly [number, number, number];
  /** Half-extents of the player's section on the wall, in
   *  wall-plane (right, up) units. A real click hit is clamped
   *  to within ±this from the section center — gives the
   *  player freedom of placement inside their patch without
   *  letting them stomp adjacent sections. */
  readonly sectionHalfExtent: readonly [number, number];
}

/** Half-extent of the main cube. Mirrors `routes.ts::CUBE_HALF`. */
const CUBE_HALF = 400;

/** Inset from each wall edge so cluster centers stay clear of
 *  the corners. Cluster occupies ~22 wall units at default
 *  formation scale, so an inset of 50 leaves comfortable
 *  clearance even at narrow viewports (FORMATION_SCALE clamps
 *  at 0.35 → cluster ~8 wide). */
const CUBE_WALL_INSET = 50;
const CUBE_USABLE_HALF = CUBE_HALF - CUBE_WALL_INSET;

/** Per-wall grid resolution. 10×10 = 100 slots per wall.
 *  Spacing between adjacent slot centres on a wall:
 *    `2 * CUBE_USABLE_HALF / (GRID - 1) ≈ 78`
 *  vs cluster diameter ~22 — leaves ~56 units of clearance
 *  between adjacent cluster outer corners. Plenty. */
const CUBE_GRID_COLS = 10;
const CUBE_GRID_ROWS = 10;
const SLOTS_PER_WALL = CUBE_GRID_COLS * CUBE_GRID_ROWS;

/** Half-extent of each player's clickable section on the wall.
 *  Adjacent slot centers are ~77.78 apart (`2 * 350 / 9`); the
 *  cluster has radius ~11 at default formation scale. A section
 *  half of 27 leaves: `77.78 - 2*27 - 2*11 ≈ 1.78` units of
 *  guaranteed clearance between worst-case adjacent clusters.
 *  Tight but enough to read as separate clusters. */
const SECTION_HALF = 27;

interface WallDef {
  /** World-space center of the wall plane. */
  readonly center: readonly [number, number, number];
  /** Inward normal (points from wall into cube interior). */
  readonly normal: readonly [number, number, number];
  /** Wall-plane "right" axis used for column offsets. */
  readonly right: readonly [number, number, number];
  /** Wall-plane "up" axis used for row offsets. */
  readonly up: readonly [number, number, number];
}

/** The 4 side walls of the cube. Floor + ceiling are excluded
 *  so the cascade always reads as a vertical wall reveal — the
 *  formation choreography assumes that. */
const CUBE_WALLS: ReadonlyArray<WallDef> = [
  // -Z back wall
  { center: [0, 0, -CUBE_HALF], normal: [0, 0, 1], right: [1, 0, 0], up: [0, 1, 0] },
  // +Z front wall (behind the avatar at the start)
  { center: [0, 0, CUBE_HALF], normal: [0, 0, -1], right: [-1, 0, 0], up: [0, 1, 0] },
  // -X left wall
  { center: [-CUBE_HALF, 0, 0], normal: [1, 0, 0], right: [0, 0, -1], up: [0, 1, 0] },
  // +X right wall
  { center: [CUBE_HALF, 0, 0], normal: [-1, 0, 0], right: [0, 0, 1], up: [0, 1, 0] },
];

/** Total slot count across all 4 walls. */
export const TOTAL_SLOTS = CUBE_WALLS.length * SLOTS_PER_WALL;

/** Room half-extent (rooms are 400×400×400 per `routes.ts`). */
const ROOM_HALF = 200;
const ROOM_WALL_INSET = 30;
const ROOM_USABLE_HALF = ROOM_HALF - ROOM_WALL_INSET;
/** Room exit grid — 6×6 = 36 distinct positions per room wall.
 *  Smaller than the cube grid because rooms are smaller and
 *  typically only a handful of players are in any one room at
 *  once. Slot indices ≥ 36 wrap. */
const ROOM_GRID_COLS = 6;
const ROOM_GRID_ROWS = 6;
const ROOM_TOTAL = ROOM_GRID_COLS * ROOM_GRID_ROWS;

function gridPos(
  wall: WallDef,
  col: number,
  row: number,
  cols: number,
  rows: number,
  usableHalf: number,
): [number, number, number] {
  // u, v in [-1, +1] across the usable wall extent.
  const u = cols > 1 ? (col / (cols - 1)) * 2 - 1 : 0;
  const v = rows > 1 ? (row / (rows - 1)) * 2 - 1 : 0;
  return [
    wall.center[0] + u * usableHalf * wall.right[0] + v * usableHalf * wall.up[0],
    wall.center[1] + u * usableHalf * wall.right[1] + v * usableHalf * wall.up[1],
    wall.center[2] + u * usableHalf * wall.right[2] + v * usableHalf * wall.up[2],
  ];
}

/**
 * Compute the slot data for a given index. Wraps modulo
 * `TOTAL_SLOTS` so out-of-range inputs (e.g., a stale broadcast
 * from a client running an older slot count) still resolve to
 * a valid slot.
 *
 * Index encoding: `wall = idx / SLOTS_PER_WALL`, then
 * `row = (idx % SLOTS_PER_WALL) / GRID_COLS`,
 * `col = idx % GRID_COLS`. Walls fill in their declared order
 * (back → front → left → right) so the first 100 players land
 * on the back wall.
 */
export function getSpawnSlot(index: number): SpawnSlot {
  const wrapped = ((index % TOTAL_SLOTS) + TOTAL_SLOTS) % TOTAL_SLOTS;
  const wallIdx = Math.floor(wrapped / SLOTS_PER_WALL);
  const local = wrapped % SLOTS_PER_WALL;
  const row = Math.floor(local / CUBE_GRID_COLS);
  const col = local % CUBE_GRID_COLS;
  const wall = CUBE_WALLS[wallIdx]!;
  const point = gridPos(wall, col, row, CUBE_GRID_COLS, CUBE_GRID_ROWS, CUBE_USABLE_HALF);

  // Room exit offset: independent grid in (x, y) within the
  // room wall, indexed by the wrapped slot index modulo
  // ROOM_TOTAL. Players past the 36th in a room get colliding
  // exits — acceptable because rooms are rarely that crowded.
  const roomLocal = wrapped % ROOM_TOTAL;
  const roomRow = Math.floor(roomLocal / ROOM_GRID_COLS);
  const roomCol = roomLocal % ROOM_GRID_COLS;
  const ru = ROOM_GRID_COLS > 1 ? (roomCol / (ROOM_GRID_COLS - 1)) * 2 - 1 : 0;
  const rv = ROOM_GRID_ROWS > 1 ? (roomRow / (ROOM_GRID_ROWS - 1)) * 2 - 1 : 0;

  return {
    index: wrapped,
    clickHit: {
      point,
      normal: [wall.normal[0], wall.normal[1], wall.normal[2]],
    },
    roomExitOffset: [ru * ROOM_USABLE_HALF, rv * ROOM_USABLE_HALF],
    wallRight: [wall.right[0], wall.right[1], wall.right[2]],
    wallUp: [wall.up[0], wall.up[1], wall.up[2]],
    sectionHalfExtent: [SECTION_HALF, SECTION_HALF],
  };
}

/**
 * Project a raw click hit (from a free-form raycast against the
 * cube wall) into the slot's section, clamping the tangential
 * displacement so the resulting point stays inside the player's
 * patch. The returned hit always lies on the slot's wall —
 * even if the user clicked on a different wall, the hit gets
 * collapsed to the section by tangential projection.
 *
 * Pure: no side effects, fresh return value. Tested in
 * `spawnSlots.test.ts`.
 */
export function clampHitToSlotSection(hit: ClickHit, slot: SpawnSlot): ClickHit {
  const cx = slot.clickHit.point[0];
  const cy = slot.clickHit.point[1];
  const cz = slot.clickHit.point[2];
  // Vector from slot center to hit, projected onto wall axes.
  const dx = hit.point[0] - cx;
  const dy = hit.point[1] - cy;
  const dz = hit.point[2] - cz;
  const tx = dx * slot.wallRight[0] + dy * slot.wallRight[1] + dz * slot.wallRight[2];
  const ty = dx * slot.wallUp[0] + dy * slot.wallUp[1] + dz * slot.wallUp[2];
  const halfX = slot.sectionHalfExtent[0];
  const halfY = slot.sectionHalfExtent[1];
  const cTx = Math.max(-halfX, Math.min(halfX, tx));
  const cTy = Math.max(-halfY, Math.min(halfY, ty));
  return {
    point: [
      cx + cTx * slot.wallRight[0] + cTy * slot.wallUp[0],
      cy + cTx * slot.wallRight[1] + cTy * slot.wallUp[1],
      cz + cTx * slot.wallRight[2] + cTy * slot.wallUp[2],
    ],
    // Always the slot's wall normal — even if the raw hit was
    // on a different wall, the clamp collapses it onto this one.
    normal: [slot.clickHit.normal[0], slot.clickHit.normal[1], slot.clickHit.normal[2]],
  };
}

/**
 * Deterministic slot assignment for a given actor among a
 * known peer set.
 *
 * Sort actor ids alphabetically, find the requested actor's
 * index, return that as the slot index (modulo wrap handled
 * inside `getSpawnSlot`). Determinism across clients is the
 * key contract: every viewer must compute the same slot for
 * a given actor without coordination.
 */
export function getSlotIndexForActor(actorId: string, peerActorIds: readonly string[]): number {
  const sorted = [...peerActorIds].sort();
  const idx = sorted.indexOf(actorId);
  if (idx < 0) {
    return 0;
  }
  return idx;
}
