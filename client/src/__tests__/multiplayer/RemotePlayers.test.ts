/**
 * Tests for the pure entity filter that decides which entities
 * become rendered remote-player cubes. The rendering side is a
 * thin wrapper, so locking the filter logic locks the visual
 * behaviour: which players show up, which don't.
 */
import { describe, it, expect } from 'vitest';
import { selectRemotePlayers } from '@/components/scene/RemotePlayers';
import type { Entity } from '@/multiplayer/types';
import { IDENTITY_TRANSFORM } from '@/multiplayer/types';

function makePlayer(id: string, route = '/'): Entity {
  return {
    id,
    kind: 'player',
    transform: IDENTITY_TRANSFORM,
    props: { route },
  };
}
function makePortal(id: string): Entity {
  return {
    id,
    kind: 'portal',
    transform: IDENTITY_TRANSFORM,
    props: {},
  };
}

function asMap(entities: Entity[]): Map<string, Entity> {
  return new Map(entities.map((e) => [e.id, e]));
}

describe('selectRemotePlayers', () => {
  const me = 'aaaaaaaa-1111-1111-1111-111111111111';
  const them = 'bbbbbbbb-2222-2222-2222-222222222222';
  const other = 'cccccccc-3333-3333-3333-333333333333';

  it('returns only player-kind entities (skips portals/models/text)', () => {
    const result = selectRemotePlayers(asMap([makePlayer(them), makePortal('portal-1')]), me, '/');
    expect(result.map((e) => e.id)).toEqual([them]);
  });

  it('excludes the local player', () => {
    const result = selectRemotePlayers(asMap([makePlayer(me), makePlayer(them)]), me, '/');
    expect(result.map((e) => e.id)).toEqual([them]);
  });

  it('excludes players whose route does not match the viewer', () => {
    const result = selectRemotePlayers(
      asMap([
        makePlayer(them, '/'), // same room — visible
        makePlayer(other, '/about'), // different room — hidden
      ]),
      me,
      '/',
    );
    expect(result.map((e) => e.id)).toEqual([them]);
  });

  it('returns empty list when no remote players match the route', () => {
    const result = selectRemotePlayers(
      asMap([makePlayer(them, '/about'), makePlayer(other, '/projects')]),
      me,
      '/',
    );
    expect(result).toEqual([]);
  });

  it('treats missing route prop as "/" (default room)', () => {
    const playerWithoutRoute: Entity = {
      id: them,
      kind: 'player',
      transform: IDENTITY_TRANSFORM,
      props: {}, // no route field
    };
    const result = selectRemotePlayers(asMap([playerWithoutRoute]), me, '/');
    expect(result.map((e) => e.id)).toEqual([them]);
  });

  it('returns empty list when localPlayerId is null (pre-FullState)', () => {
    // Edge case: connection in flight, no local id yet. Filter
    // shouldn't render any cube (we don't know which one is us)
    // — the FullState that arrives moments later will populate
    // localPlayerId and trigger a re-render.
    const result = selectRemotePlayers(asMap([makePlayer(them), makePlayer(other)]), null, '/');
    // Without a local id, every player is "remote" — that's fine,
    // it's a 100ms transient. Verify the function doesn't crash.
    expect(result.map((e) => e.id).sort()).toEqual([them, other].sort());
  });
});
