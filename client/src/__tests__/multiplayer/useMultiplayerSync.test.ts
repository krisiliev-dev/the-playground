/**
 * Tests for the pure helpers extracted from `useMultiplayerSync`.
 * The hook itself is harder to test (WebSocket + setInterval +
 * StrictMode interactions) but the transport-agnostic parts —
 * message routing, transform equality — should be locked down.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  dispatchServerMessage,
  transformsEqual,
  POSITION_EPSILON,
  type Dispatchers,
} from '@/multiplayer/useMultiplayerSync';
import type { Entity, ServerMessage, Transform } from '@/multiplayer/types';
import { IDENTITY_TRANSFORM } from '@/multiplayer/types';

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

  it('ignores quaternion + scale differences (only position is compared)', () => {
    const a: Transform = {
      position: [1, 2, 3],
      quaternion: [0, 0, 0, 1],
      scale: [1, 1, 1],
    };
    const b: Transform = {
      position: [1, 2, 3],
      quaternion: [0.5, 0.5, 0.5, 0.5],
      scale: [9, 9, 9],
    };
    expect(transformsEqual(a, b)).toBe(true);
  });
});
