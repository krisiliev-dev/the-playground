/**
 * Tests for `minPlayerDistance` — the cross-player proximity
 * aggregator used by the portal rim animation.
 *
 * Pure function over a Map<EntityId, Entity>; tests cover the
 * filter cases (kind, self-exclusion, empty map) and the
 * minimum-selection across multiple candidates.
 */
import { describe, it, expect } from 'vitest';
import { minPlayerDistance } from '@/multiplayer/playerProximity';
import type { Entity } from '@/multiplayer/types';
import { IDENTITY_TRANSFORM } from '@/multiplayer/types';

const target: [number, number, number] = [0, 0, 0];

function entity(
  id: string,
  kind: 'player' | 'portal' | 'model' | 'text',
  position: [number, number, number],
): Entity {
  return {
    id,
    kind,
    transform: { ...IDENTITY_TRANSFORM, position },
    props: {},
  };
}

function asMap(entities: Entity[]): Map<string, Entity> {
  return new Map(entities.map((e) => [e.id, e]));
}

describe('minPlayerDistance', () => {
  it('returns the local distance when there are no remote entities', () => {
    const result = minPlayerDistance(target, [3, 4, 0], asMap([]), null);
    expect(result).toBeCloseTo(5, 6); // 3-4-5 right triangle
  });

  it('takes the minimum across local + remote players', () => {
    const remoteFar = entity('a', 'player', [100, 0, 0]);
    const remoteClose = entity('b', 'player', [1, 0, 0]);
    const result = minPlayerDistance(
      target,
      [50, 0, 0], // local also far
      asMap([remoteFar, remoteClose]),
      null,
    );
    expect(result).toBeCloseTo(1, 6);
  });

  it('returns local distance if all remotes are further', () => {
    const remoteFar = entity('a', 'player', [100, 0, 0]);
    const result = minPlayerDistance(target, [2, 0, 0], asMap([remoteFar]), null);
    expect(result).toBeCloseTo(2, 6);
  });

  it('skips entities that are not kind=player', () => {
    const portal = entity('p', 'portal', [0.1, 0, 0]); // very close, but a portal
    const result = minPlayerDistance(target, [10, 0, 0], asMap([portal]), null);
    // Should return 10 (local), not 0.1 — portal entities don't count
    expect(result).toBeCloseTo(10, 6);
  });

  it('skips the entity matching localPlayerId (avoid double-counting self)', () => {
    const localEntity = entity('me', 'player', [0.1, 0, 0]);
    const realRemote = entity('them', 'player', [50, 0, 0]);
    // local position from camera says distance 10; the localEntity in
    // the map should be skipped (same id), so min comes from camera
    // position vs. realRemote.
    const result = minPlayerDistance(target, [10, 0, 0], asMap([localEntity, realRemote]), 'me');
    expect(result).toBeCloseTo(10, 6);
  });

  it('handles 3D distances correctly across x/y/z', () => {
    const remote = entity('a', 'player', [3, 4, 0]); // dist 5
    const result = minPlayerDistance(target, [100, 0, 0], asMap([remote]), null);
    expect(result).toBeCloseTo(5, 6);
  });

  it('returns 0 when a player is exactly at the target', () => {
    const remote = entity('a', 'player', [0, 0, 0]);
    const result = minPlayerDistance(target, [99, 0, 0], asMap([remote]), null);
    expect(result).toBe(0);
  });
});
