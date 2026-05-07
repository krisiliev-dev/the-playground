/**
 * Tests for the pure helpers extracted from `useMultiplayerSync`.
 * The hook itself is harder to test (WebSocket + setInterval +
 * StrictMode interactions) but the transport-agnostic parts —
 * message routing, transform equality — should be locked down.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  dispatchServerMessage,
  presenceEqual,
  transformsEqual,
  POSITION_EPSILON,
  type Dispatchers,
} from '@/multiplayer/useMultiplayerSync';
import type { Entity, ServerMessage, Transform } from '@/multiplayer/types';
import { IDENTITY_TRANSFORM } from '@/multiplayer/types';
import {
  _bufferCountForTest,
  dropAllSnapshots,
  sampleSnapshot,
} from '@/multiplayer/snapshotInterpolation';

function makeDispatchers(): Dispatchers & {
  upsertCalls: Entity[][];
  removeCalls: string[][];
  setLocalCalls: (string | null)[];
  clearCalls: number;
} {
  const upsertCalls: Entity[][] = [];
  const removeCalls: string[][] = [];
  const setLocalCalls: (string | null)[] = [];
  let clearCalls = 0;
  return {
    upsertCalls,
    removeCalls,
    setLocalCalls,
    get clearCalls() {
      return clearCalls;
    },
    upsertEntities: (entities) => {
      upsertCalls.push([...entities]);
    },
    removeEntities: (ids) => {
      removeCalls.push([...ids]);
    },
    setLocalPlayerId: (id) => {
      setLocalCalls.push(id);
    },
    clearAllEntities: () => {
      clearCalls++;
    },
  };
}

const sampleEntity: Entity = {
  id: '11111111-1111-1111-1111-111111111111',
  kind: 'player',
  transform: IDENTITY_TRANSFORM,
  props: { route: '/' },
};

describe('dispatchServerMessage', () => {
  it('routes full_state to upsertEntities + setLocalPlayerId', () => {
    const d = makeDispatchers();
    const msg: ServerMessage = {
      type: 'full_state',
      entities: [sampleEntity],
      your_player_id: sampleEntity.id,
    };
    dispatchServerMessage(msg, d);

    expect(d.upsertCalls).toHaveLength(1);
    expect(d.upsertCalls[0]).toEqual([sampleEntity]);
    expect(d.setLocalCalls).toEqual([sampleEntity.id]);
    // FullState should NOT trigger a clear — clearing happens on
    // disconnect, not on every reseed (which would break the
    // "smooth reconnect" UX).
    expect(d.clearCalls).toBe(0);
  });

  it('routes entity_updates to upsertEntities only', () => {
    const d = makeDispatchers();
    dispatchServerMessage({ type: 'entity_updates', entities: [sampleEntity] }, d);
    expect(d.upsertCalls).toHaveLength(1);
    expect(d.setLocalCalls).toHaveLength(0);
    expect(d.removeCalls).toHaveLength(0);
  });

  it('routes entity_deleted to removeEntities only', () => {
    const d = makeDispatchers();
    dispatchServerMessage({ type: 'entity_deleted', ids: [sampleEntity.id] }, d);
    expect(d.removeCalls).toHaveLength(1);
    expect(d.removeCalls[0]).toEqual([sampleEntity.id]);
    expect(d.upsertCalls).toHaveLength(0);
  });

  it('logs and continues for error messages', () => {
    const d = makeDispatchers();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    dispatchServerMessage({ type: 'error', message: 'token rejected' }, d);
    expect(warnSpy).toHaveBeenCalledWith('[multiplayer] server error:', 'token rejected');
    expect(d.upsertCalls).toHaveLength(0);
    expect(d.removeCalls).toHaveLength(0);
    warnSpy.mockRestore();
  });

  it('does nothing for an unknown message type (forward-compat)', () => {
    const d = makeDispatchers();
    // Cast to satisfy TS — simulates a future server sending a
    // variant the client doesn't know about. Should be ignored.
    dispatchServerMessage({ type: 'future_variant' } as unknown as ServerMessage, d);
    expect(d.upsertCalls).toHaveLength(0);
    expect(d.removeCalls).toHaveLength(0);
    expect(d.setLocalCalls).toHaveLength(0);
  });
});

describe('presenceEqual', () => {
  it('treats two empty bags as equal', () => {
    expect(presenceEqual({}, {})).toBe(true);
  });

  it('returns true when menu matches', () => {
    expect(presenceEqual({ menu: 'pause' }, { menu: 'pause' })).toBe(true);
    expect(presenceEqual({ menu: null }, { menu: null })).toBe(true);
  });

  it('returns false when menu diverges', () => {
    expect(presenceEqual({ menu: null }, { menu: 'pause' })).toBe(false);
    expect(presenceEqual({ menu: 'pause' }, { menu: 'settings' })).toBe(false);
  });

  it('treats undefined and null as equal (both mean "no menu")', () => {
    expect(presenceEqual({}, { menu: null })).toBe(false);
    // ^ this asserts the strict comparison — undefined !== null. The
    // outbound pump always supplies one or the other; mixing both
    // means our writer side is buggy. The strict comparison catches
    // that bug rather than masking it.
  });

  it('also compares the near field', () => {
    expect(presenceEqual({ near: 'portal-A' }, { near: 'portal-A' })).toBe(true);
    expect(presenceEqual({ near: 'portal-A' }, { near: 'portal-B' })).toBe(false);
  });

  it('compares reveal_state', () => {
    expect(presenceEqual({ reveal_state: 'armed' }, { reveal_state: 'armed' })).toBe(true);
    expect(presenceEqual({ reveal_state: 'armed' }, { reveal_state: 'swinging' })).toBe(false);
  });

  it('compares click hit point referentially', () => {
    const point: [number, number, number] = [10, 5, -3];
    expect(
      presenceEqual({ click_hit_point: point }, { click_hit_point: point }),
    ).toBe(true);
    expect(
      presenceEqual(
        { click_hit_point: [10, 5, -3] },
        { click_hit_point: [10, 5, -3] },
      ),
    ).toBe(false);
  });

  it('returns false when reveal_state_entered_at diverges', () => {
    expect(
      presenceEqual(
        { reveal_state_entered_at: 1000 },
        { reveal_state_entered_at: 1001 },
      ),
    ).toBe(false);
  });
});

describe('dispatchServerMessage — snapshot side effects', () => {
  beforeEach(() => {
    dropAllSnapshots();
  });

  it('records a snapshot per entity in full_state', () => {
    const d = makeDispatchers();
    dispatchServerMessage(
      {
        type: 'full_state',
        entities: [sampleEntity, { ...sampleEntity, id: 'other' }],
        your_player_id: sampleEntity.id,
      },
      d,
    );
    // Two entities → two buffers in the registry.
    expect(_bufferCountForTest()).toBe(2);
    expect(sampleSnapshot(sampleEntity.id, performance.now() + 1)).not.toBeNull();
  });

  it('records a snapshot per entity in entity_updates', () => {
    const d = makeDispatchers();
    dispatchServerMessage({ type: 'entity_updates', entities: [sampleEntity] }, d);
    expect(_bufferCountForTest()).toBe(1);
  });

  it('drops snapshots on entity_deleted', () => {
    const d = makeDispatchers();
    dispatchServerMessage({ type: 'entity_updates', entities: [sampleEntity] }, d);
    expect(_bufferCountForTest()).toBe(1);

    dispatchServerMessage({ type: 'entity_deleted', ids: [sampleEntity.id] }, d);
    expect(_bufferCountForTest()).toBe(0);
  });
});

describe('transformsEqual', () => {
  const at = (x: number, y: number, z: number): Transform => ({
    position: [x, y, z],
    quaternion: [0, 0, 0, 1],
    scale: [1, 1, 1],
  });

  it('returns true for identical positions', () => {
    expect(transformsEqual(at(1, 2, 3), at(1, 2, 3))).toBe(true);
  });

  it('returns true for positions within epsilon (float jitter)', () => {
    expect(transformsEqual(at(1, 2, 3), at(1 + POSITION_EPSILON / 2, 2, 3))).toBe(true);
  });

  it('returns false when one component diverges past epsilon', () => {
    expect(transformsEqual(at(1, 2, 3), at(1 + POSITION_EPSILON * 10, 2, 3))).toBe(false);
    expect(transformsEqual(at(1, 2, 3), at(1, 2 + POSITION_EPSILON * 10, 3))).toBe(false);
    expect(transformsEqual(at(1, 2, 3), at(1, 2, 3 + POSITION_EPSILON * 10))).toBe(false);
  });

  it('returns false when quaternion diverges past epsilon', () => {
    const a: Transform = {
      position: [1, 2, 3],
      quaternion: [0, 0, 0, 1],
      scale: [1, 1, 1],
    };
    const b: Transform = {
      position: [1, 2, 3],
      quaternion: [0.5, 0.5, 0.5, 0.5],
      scale: [1, 1, 1],
    };
    expect(transformsEqual(a, b)).toBe(false);
  });

  it('ignores scale differences (scale is not synced)', () => {
    const a: Transform = {
      position: [1, 2, 3],
      quaternion: [0, 0, 0, 1],
      scale: [1, 1, 1],
    };
    const b: Transform = {
      position: [1, 2, 3],
      quaternion: [0, 0, 0, 1],
      scale: [9, 9, 9],
    };
    expect(transformsEqual(a, b)).toBe(true);
  });

  it('treats sub-epsilon quaternion jitter as equal', () => {
    const a: Transform = {
      position: [0, 0, 0],
      quaternion: [0, 0, 0, 1],
      scale: [1, 1, 1],
    };
    const b: Transform = {
      position: [0, 0, 0],
      quaternion: [0, 0.0001, 0, 1],
      scale: [1, 1, 1],
    };
    expect(transformsEqual(a, b)).toBe(true);
  });
});
