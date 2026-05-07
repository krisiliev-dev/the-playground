/**
 * Tests for the MultiplayerSlice on the central store.
 *
 * Locks the contract `useMultiplayerSync` relies on:
 *   - upsertEntities is additive (existing entities preserved)
 *   - removeEntities only removes the specified ids
 *   - clearAllEntities wipes both the map and localPlayerId
 *   - the entities Map identity changes on every mutation so
 *     Zustand shallow-equality fires for subscribers
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useWorldStore } from '@/store';
import type { Entity } from '@/multiplayer/types';
import { IDENTITY_TRANSFORM } from '@/multiplayer/types';

function player(id: string, route = '/'): Entity {
  return {
    id,
    kind: 'player',
    transform: IDENTITY_TRANSFORM,
    props: { route },
  };
}

describe('useWorldStore — MultiplayerSlice', () => {
  beforeEach(() => {
    useWorldStore.getState().clearAllEntities();
  });

  it('starts empty: entities is an empty Map and localPlayerId is null', () => {
    const s = useWorldStore.getState();
    expect(s.entities.size).toBe(0);
    expect(s.localPlayerId).toBeNull();
  });

  it('upsertEntities inserts new entities by id', () => {
    const a = player('id-a');
    const b = player('id-b');
    useWorldStore.getState().upsertEntities([a, b]);

    const s = useWorldStore.getState();
    expect(s.entities.size).toBe(2);
    expect(s.entities.get('id-a')).toEqual(a);
    expect(s.entities.get('id-b')).toEqual(b);
  });

  it('upsertEntities replaces existing entities at the same id', () => {
    const original = player('id-a', '/');
    const updated: Entity = {
      ...original,
      transform: {
        ...IDENTITY_TRANSFORM,
        position: [10, 20, 30],
      },
    };
    useWorldStore.getState().upsertEntities([original]);
    useWorldStore.getState().upsertEntities([updated]);

    expect(useWorldStore.getState().entities.get('id-a')?.transform.position).toEqual([10, 20, 30]);
  });

  it('upsertEntities preserves entities not in the upsert batch', () => {
    const a = player('id-a');
    const b = player('id-b');
    useWorldStore.getState().upsertEntities([a]);
    useWorldStore.getState().upsertEntities([b]);

    const entities = useWorldStore.getState().entities;
    expect(entities.size).toBe(2);
    expect(entities.has('id-a')).toBe(true);
    expect(entities.has('id-b')).toBe(true);
  });

  it('removeEntities removes only the given ids', () => {
    const a = player('id-a');
    const b = player('id-b');
    const c = player('id-c');
    useWorldStore.getState().upsertEntities([a, b, c]);
    useWorldStore.getState().removeEntities(['id-a', 'id-c']);

    const entities = useWorldStore.getState().entities;
    expect(entities.size).toBe(1);
    expect(entities.has('id-b')).toBe(true);
  });

  it('removeEntities is a no-op for unknown ids', () => {
    useWorldStore.getState().upsertEntities([player('id-a')]);
    useWorldStore.getState().removeEntities(['does-not-exist']);
    expect(useWorldStore.getState().entities.size).toBe(1);
  });

  it('setLocalPlayerId stores the id and accepts null to clear', () => {
    useWorldStore.getState().setLocalPlayerId('me');
    expect(useWorldStore.getState().localPlayerId).toBe('me');

    useWorldStore.getState().setLocalPlayerId(null);
    expect(useWorldStore.getState().localPlayerId).toBeNull();
  });

  it('clearAllEntities wipes both entities map and localPlayerId', () => {
    useWorldStore.getState().upsertEntities([player('id-a'), player('id-b')]);
    useWorldStore.getState().setLocalPlayerId('me');

    useWorldStore.getState().clearAllEntities();

    const s = useWorldStore.getState();
    expect(s.entities.size).toBe(0);
    expect(s.localPlayerId).toBeNull();
  });

  it('entities Map gets a fresh identity on every mutation', () => {
    // Critical invariant: Zustand uses Object.is for shallow eq;
    // mutating the map in place would skip subscriber updates.
    // Each action MUST allocate a new Map.
    useWorldStore.getState().upsertEntities([player('id-a')]);
    const map1 = useWorldStore.getState().entities;

    useWorldStore.getState().upsertEntities([player('id-b')]);
    const map2 = useWorldStore.getState().entities;

    useWorldStore.getState().removeEntities(['id-a']);
    const map3 = useWorldStore.getState().entities;

    expect(map1).not.toBe(map2);
    expect(map2).not.toBe(map3);
    expect(map1).not.toBe(map3);
  });
});
