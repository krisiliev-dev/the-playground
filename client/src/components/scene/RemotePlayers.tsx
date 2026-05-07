/**
 * RemotePlayers — renders one cube per remote player entity.
 *
 * MVP intentionally minimal: a small cyan cube at each remote
 * player's reported position. Full GLB cursor reuse + snapshot
 * interpolation is a follow-up slice — landing the data
 * pipeline first lets us verify two-tab presence without the
 * extra moving parts.
 *
 * Filtering:
 *   - kind === 'player'           (skip portals, models, text)
 *   - id !== localPlayerId        (don't double-render self)
 *   - currentRoute matches        (only render players who are
 *                                  in this client's current room)
 */
import { useMemo } from 'react';
import { useWorldStore } from '@/store';
import type { Entity } from '@/multiplayer/types';

// Placeholder marker for remote players — a small colored cube
// while the proper GLB cursor reuse is on the follow-up slice.
// `cursor_color` from the entity's props takes precedence so each
// player can have a distinct rim hue once the editor lets admins
// set it; the constant below is the fallback.
const REMOTE_CUBE_SIZE = 1.2;
const REMOTE_CUBE_COLOR = '#ff00ff';

export function RemotePlayers(): JSX.Element {
  const entities = useWorldStore((s) => s.entities);
  const localPlayerId = useWorldStore((s) => s.localPlayerId);
  const currentRoute = useWorldStore((s) => s.currentRoute);

  const remotePlayers = useMemo(() => {
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
  }, [entities, localPlayerId, currentRoute]);

  return (
    <>
      {remotePlayers.map((player) => (
        <RemotePlayerCube key={player.id} entity={player} />
      ))}
    </>
  );
}

interface RemotePlayerCubeProps {
  entity: Entity;
}

function RemotePlayerCube({ entity }: RemotePlayerCubeProps): JSX.Element {
  const [px, py, pz] = entity.transform.position;
  const color = (entity.props as { cursor_color?: string }).cursor_color ?? REMOTE_CUBE_COLOR;
  return (
    <mesh position={[px, py, pz]} frustumCulled={false}>
      <boxGeometry args={[REMOTE_CUBE_SIZE, REMOTE_CUBE_SIZE, REMOTE_CUBE_SIZE]} />
      <meshBasicMaterial color={color} />
    </mesh>
  );
}
