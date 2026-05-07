/**
 * Remote-cascade orchestrator. For every remote player whose
 * `presence` reports an in-progress reveal, mounts a full
 * 12-sword `<RemotePlayerCascade>` driven off the broadcast
 * click geometry + camera pose.
 *
 * Per ADR-006: visuals are replicated; audio + camera shake
 * still come through the originator's own `sfx.playWorld` /
 * `triggerWorldImpactShake` broadcasts so the same wire path
 * powers both. The Sword component itself runs with
 * `context.isRemote = true` so it skips its own broadcast +
 * audio paths (which would create infinite loops).
 *
 * Subtle behaviour: a player who joins mid-cascade observes
 * the originator's current `revealState` via FullState's
 * entity props. Their cascade starts from that state — slightly
 * out of sync, but bounded (the visual catches up within one
 * state transition).
 */
import { useEffect, useMemo } from 'react';
import { useWorldStore } from '@/store';
import { Sword, type SwordContext } from '@/components/scene/reveal/Sword';
import { VIBE_SLOTS, FORMATION_SCALE } from '@/components/scene/reveal/vibeFormation';
import { buildPortalEndpoints } from '@/content/portals';
import type { Entity, EntityId } from './types';

/** Read presence-broadcast reveal fields off a remote entity's
 *  props bag. The server merges `PlayerInput.presence` into
 *  `entity.props`, so the wire contract here is "whatever
 *  `readLocalPresence` writes is what we read back." */
interface RevealPresence {
  reveal_state: string;
  click_hit_point: [number, number, number];
  click_hit_normal: [number, number, number];
  click_cam_pos: [number, number, number];
  click_cam_quat: [number, number, number, number];
}

/** Pull a typed reveal-presence bag out of an entity's props,
 *  returning null if any required field is missing or the
 *  state is idle. Defensive — a remote client could send a
 *  partial bag and we shouldn't crash. Exported for tests. */
export function readRevealPresence(entity: Entity): RevealPresence | null {
  const p = entity.props as Record<string, unknown>;
  const state = p.reveal_state;
  if (typeof state !== 'string' || state === 'idle') {
    return null;
  }
  const point = p.click_hit_point;
  const normal = p.click_hit_normal;
  const camPos = p.click_cam_pos;
  const camQuat = p.click_cam_quat;
  if (!isVec3(point) || !isVec3(normal) || !isVec3(camPos) || !isVec4(camQuat)) {
    return null;
  }
  return {
    reveal_state: state,
    click_hit_point: point,
    click_hit_normal: normal,
    click_cam_pos: camPos,
    click_cam_quat: camQuat,
  };
}

function isVec3(v: unknown): v is [number, number, number] {
  return (
    Array.isArray(v) &&
    v.length === 3 &&
    typeof v[0] === 'number' &&
    typeof v[1] === 'number' &&
    typeof v[2] === 'number'
  );
}

function isVec4(v: unknown): v is [number, number, number, number] {
  return (
    Array.isArray(v) &&
    v.length === 4 &&
    typeof v[0] === 'number' &&
    typeof v[1] === 'number' &&
    typeof v[2] === 'number' &&
    typeof v[3] === 'number'
  );
}

const VALID_REVEAL_STATES = new Set(['idle', 'armed', 'swinging', 'impact', 'revealed']);

export function RemotePlayerReveals(): JSX.Element {
  const entities = useWorldStore((s) => s.entities);
  const localPlayerId = useWorldStore((s) => s.localPlayerId);

  const revealing = useMemo(() => {
    const list: Array<{ id: EntityId; presence: RevealPresence }> = [];
    for (const [id, entity] of entities) {
      if (entity.kind !== 'player' || id === localPlayerId) {
        continue;
      }
      const presence = readRevealPresence(entity);
      if (!presence || !VALID_REVEAL_STATES.has(presence.reveal_state)) {
        continue;
      }
      list.push({ id, presence });
    }
    return list;
  }, [entities, localPlayerId]);

  return (
    <>
      {revealing.map(({ id, presence }) => (
        <RemotePlayerCascade key={id} actorId={id} presence={presence} />
      ))}
    </>
  );
}

interface RemotePlayerCascadeProps {
  actorId: EntityId;
  presence: RevealPresence;
}

function RemotePlayerCascade({ actorId, presence }: RemotePlayerCascadeProps): JSX.Element {
  // Materialize portal endpoints in the local store the moment
  // we observe the remote player's reveal hit `impact`. Mirrors
  // what `RevealOrchestrator` does locally: portals appear at
  // the click hit one beat before the formation settles. The
  // local `<Portals>` component picks them up from the store —
  // they're functional (clickable, navigable) for the local
  // player without any additional wiring.
  //
  // Multiplayer: tagging by `actorId` keeps each player's set
  // independent. `addPortalEndpoints` replaces only this
  // actor's portals — other players' clusters survive.
  useEffect(() => {
    if (presence.reveal_state !== 'impact' && presence.reveal_state !== 'revealed') {
      return;
    }
    const endpoints = buildPortalEndpoints(
      {
        point: presence.click_hit_point,
        normal: presence.click_hit_normal,
      },
      FORMATION_SCALE,
      actorId,
    );
    useWorldStore.getState().addPortalEndpoints(actorId, endpoints);
  }, [
    actorId,
    presence.reveal_state,
    presence.click_hit_point,
    presence.click_hit_normal,
  ]);

  // Clean up this actor's portals when the cascade unmounts —
  // either because the remote player reset their reveal (state
  // returns to idle, presence drops the reveal fields) or
  // because they disconnected (entity removed from store).
  // Without this, dead actors' portals would linger forever.
  useEffect(() => {
    return () => {
      useWorldStore.getState().removePortalEndpointsByActor(actorId);
    };
  }, [actorId]);

  // Each Sword reads from its own `context` prop; the context
  // is a fresh object per render so React detects the change
  // when the broadcast state advances. The clickHit + cam pose
  // are stable for the cascade's lifetime; revealState changes
  // through the phases.
  const context: SwordContext = useMemo(
    () => ({
      revealState: presence.reveal_state as SwordContext['revealState'],
      clickHit: {
        point: presence.click_hit_point,
        normal: presence.click_hit_normal,
      },
      cameraPos: presence.click_cam_pos,
      cameraQuat: presence.click_cam_quat,
      isRemote: true,
    }),
    [
      presence.reveal_state,
      presence.click_hit_point,
      presence.click_hit_normal,
      presence.click_cam_pos,
      presence.click_cam_quat,
    ],
  );

  return (
    <>
      {VIBE_SLOTS.map((slot, i) => (
        <Sword key={slot.id} slot={slot} staggerIndex={i} context={context} />
      ))}
    </>
  );
}
