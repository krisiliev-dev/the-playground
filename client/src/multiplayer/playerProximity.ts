/**
 * Cross-player proximity aggregation (per ADR-006 §"near" — slice 3b).
 *
 * The portal rim's "is anyone near me" check originally consulted
 * only the local camera's distance. With multiplayer, an
 * interactable should react when *any* player is in range — local
 * or remote — so a player walking toward a portal in tab A
 * causes the rim to glow for everyone watching.
 *
 * Implementation: pure helper that takes the local viewer's
 * position + the entities map + the local player's id and returns
 * the minimum distance across all player positions. Pure makes it
 * trivially testable; entity iteration cost is O(N) per portal per
 * frame, with N being connected players — negligible at our scale.
 */
import type { Entity, EntityId } from './types';

/**
 * Minimum distance from `targetPos` to any player position (local
 * cursor + every remote player entity in `entities` whose id
 * isn't `localPlayerId`).
 *
 * Uses raw component subtraction + sqrt rather than allocating a
 * Three.js Vector3 — this runs once per portal per frame, so the
 * micro-allocation matters at scale (12 portals × 60fps × 10
 * players = a lot of garbage). Three.js `distanceTo` does the
 * same math internally.
 */
export function minPlayerDistance(
  targetPos: readonly [number, number, number],
  localPos: readonly [number, number, number],
  entities: ReadonlyMap<EntityId, Entity>,
  localPlayerId: EntityId | null,
): number {
  let min = distanceBetween(targetPos, localPos);
  for (const entity of entities.values()) {
    if (entity.kind !== 'player') {
      continue;
    }
    if (entity.id === localPlayerId) {
      continue;
    }
    const d = distanceBetween(targetPos, entity.transform.position);
    if (d < min) {
      min = d;
    }
  }
  return min;
}

function distanceBetween(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}
