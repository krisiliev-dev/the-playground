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
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type { Mesh } from 'three';
import { useWorldStore } from '@/store';
import type { Entity, EntityId } from '@/multiplayer/types';
import { INTERP_DELAY_MS, sampleSnapshot } from '@/multiplayer/snapshotInterpolation';

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

  const remotePlayers = useMemo(
    () => selectRemotePlayers(entities, localPlayerId, currentRoute),
    [entities, localPlayerId, currentRoute],
  );

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
  const meshRef = useRef<Mesh>(null);
  const color = (entity.props as { cursor_color?: string }).cursor_color ?? REMOTE_CUBE_COLOR;

  // Per-frame interpolation: sample the snapshot buffer at
  // `now - INTERP_DELAY_MS` so we always lerp between two known
  // snapshots rather than extrapolate forward. Updates the mesh
  // imperatively — bypasses React's render cycle entirely, which
  // is the only way to hit 144 Hz with 30 Hz network input.
  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh) {
      return;
    }
    const sampled = sampleSnapshot(entity.id, performance.now() - INTERP_DELAY_MS);
    if (sampled) {
      mesh.position.set(sampled.position[0], sampled.position[1], sampled.position[2]);
      mesh.quaternion.set(
        sampled.quaternion[0],
        sampled.quaternion[1],
        sampled.quaternion[2],
        sampled.quaternion[3],
      );
    } else {
      // No snapshots yet (entity just arrived in this frame's
      // FullState but interpolation buffer hasn't been written
      // because the WS dispatch and render races). Fall back to
      // the entity's reported position to avoid a one-frame
      // flash at world origin.
      const [px, py, pz] = entity.transform.position;
      mesh.position.set(px, py, pz);
    }
  });

  return (
    <mesh ref={meshRef} frustumCulled={false}>
      <boxGeometry args={[REMOTE_CUBE_SIZE, REMOTE_CUBE_SIZE, REMOTE_CUBE_SIZE]} />
      <meshBasicMaterial color={color} />
    </mesh>
  );
}
