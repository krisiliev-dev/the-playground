/**
 * RemotePlayers — renders one `<RemoteCursorAvatar>` per remote
 * player entity, smoothly interpolated from the snapshot buffer.
 *
 * Filtering:
 *   - kind === 'player'           (skip portals, models, text)
 *   - id !== localPlayerId        (don't double-render self)
 *   - currentRoute matches        (only render players who are
 *                                  in this client's current room)
 */
import { useMemo } from 'react';
import { useWorldStore } from '@/store';
import type { Entity, EntityId } from '@/multiplayer/types';
import { RemoteCursorAvatar } from './RemoteCursorAvatar';

/** Pure filter: which entities should render as remote-player
 *  cubes for a viewer at `currentRoute` whose own entity id is
 *  `localPlayerId`. Exported for direct testing — the rendering
 *  side is a thin wrapper over this. */
export function selectRemotePlayers(
  entities: ReadonlyMap<EntityId, Entity>,
  localPlayerId: EntityId | null,
  currentRoute: string,
): Entity[] {
  const list: Entity[] = [];
  for (const entity of entities.values()) {
    if (entity.kind !== 'player') {
      continue;
    }
    if (entity.id === localPlayerId) {
      continue;
    }
    const route = (entity.props as { route?: string }).route ?? '/';
    if (route !== currentRoute) {
      continue;
    }
    list.push(entity);
  }
  return list;
}

export function RemotePlayers(): JSX.Element {
  const entities = useWorldStore((s) => s.entities);
  const localPlayerId = useWorldStore((s) => s.localPlayerId);
  const currentRoute = useWorldStore((s) => s.currentRoute);

  const remotePlayers = useMemo(
    () => selectRemotePlayers(entities, localPlayerId, currentRoute),
    [entities, localPlayerId, currentRoute],
  );

  return (
    <>
      {remotePlayers.map((player) => (
        <RemoteCursorAvatar key={player.id} entity={player} />
      ))}
    </>
  );
}
