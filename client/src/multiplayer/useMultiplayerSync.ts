/**
 * `useMultiplayerSync` — opens a WebSocket to the authoritative
 * server, dispatches inbound `ServerMessage` events into the
 * Zustand multiplayer slice, and pushes outbound `PlayerInput`
 * at a steady rate from the local cursor's world position.
 *
 * Reconnect strategy: exponential backoff with a 30 s ceiling.
 * On reconnect we get a fresh `FullState` from the server, so
 * stale entity ids are naturally evicted via `clearAllEntities`
 * before the new state arrives.
 *
 * Per ADR-004 the server is authoritative — outbound input is
 * an INTENT (the server may reject or smooth). Local prediction
 * is owned by the existing CursorAvatar; this hook just relays.
 */
import { useEffect, useRef } from 'react';
import { cursorWorldPosition, cursorWorldQuaternion } from '@/components/scene/cursorWorldPosition';
import { useWorldStore } from '@/store';
import type {
  ClientMessage,
  Entity,
  EntityId,
  PlayerPresence,
  ServerMessage,
  Transform,
} from './types';
import { IDENTITY_TRANSFORM } from './types';
import { dropAllSnapshots, dropSnapshot, recordSnapshot } from './snapshotInterpolation';
import { dispatchSceneEvent, drainOutboundQueue } from './sceneEvents';

/** How often we push our local player transform to the server.
 *  Matches the server's tick rate; sending more often is just
 *  bandwidth waste since the server diffs. */
const OUTBOUND_HZ = 30;

const RECONNECT_INITIAL_MS = 500;
const RECONNECT_CEILING_MS = 30_000;

export interface MultiplayerOptions {
  /** Full WS URL incl. scheme. e.g. `ws://localhost:8080/ws`. */
  url: string;
  /** Optional admin token; appended as `?token=...` if set. */
  adminToken?: string;
  /** When false, the hook is a no-op (used to gate multiplayer
   *  during e.g. document mode or feature-flag rollout). */
  enabled?: boolean;
}

export function useMultiplayerSync(opts: MultiplayerOptions): void {
  const { url, adminToken, enabled = true } = opts;
  const upsertEntities = useWorldStore((s) => s.upsertEntities);
  const removeEntities = useWorldStore((s) => s.removeEntities);
  const setLocalPlayerId = useWorldStore((s) => s.setLocalPlayerId);
  const clearAllEntities = useWorldStore((s) => s.clearAllEntities);

  // Refs hold mutable values the effect needs without retriggering
  // on every render — `socket`, the reconnect timer, and the last
  // outbound transform (sent only when it differs to avoid
  // unconditional churn for stationary players).
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<number | null>(null);
  const outboundTimer = useRef<number | null>(null);
  const lastSentTransform = useRef<Transform>(IDENTITY_TRANSFORM);
  const lastSentRoute = useRef<string>('/');
  const lastSentPresence = useRef<PlayerPresence>({});

  useEffect(() => {
    if (!enabled) {
      // eslint-disable-next-line no-console
      console.info('[multiplayer] disabled — set VITE_MULTIPLAYER_URL to enable');
      return;
    }

    let backoffMs = RECONNECT_INITIAL_MS;
    let cancelled = false;

    const connect = (): void => {
      if (cancelled) {
        return;
      }
      const fullUrl = adminToken ? `${url}?token=${encodeURIComponent(adminToken)}` : url;
      // eslint-disable-next-line no-console
      console.info('[multiplayer] connecting →', fullUrl);
      const ws = new WebSocket(fullUrl);
      socketRef.current = ws;

      ws.addEventListener('open', () => {
        // eslint-disable-next-line no-console
        console.info('[multiplayer] connected');
        backoffMs = RECONNECT_INITIAL_MS;
      });

      ws.addEventListener('message', (event) => {
        if (typeof event.data !== 'string') {
          return;
        }
        let msg: ServerMessage;
        try {
          msg = JSON.parse(event.data) as ServerMessage;
        } catch {
          return;
        }
        dispatchServerMessage(msg, {
          upsertEntities,
          removeEntities,
          setLocalPlayerId,
          clearAllEntities,
        });
      });

      const scheduleReconnect = (): void => {
        clearAllEntities();
        dropAllSnapshots();
        socketRef.current = null;
        if (cancelled) {
          return;
        }
        // If the operator was kicked (server sent a
        // KickNotification then severed the WS), stay
        // disconnected. The kick overlay covers the canvas;
        // the only ways out are page reload or admin
        // intervention. Without this gate the reconnect loop
        // would run, the player would silently rejoin, and the
        // kick would feel like a 1-second hiccup.
        if (useWorldStore.getState().localPlayerKicked) {
          return;
        }
        reconnectTimer.current = window.setTimeout(() => {
          backoffMs = Math.min(backoffMs * 2, RECONNECT_CEILING_MS);
          connect();
        }, backoffMs);
      };

      ws.addEventListener('close', () => {
        // Only honour close events from the *currently active*
        // socket. Under React StrictMode the effect double-mounts:
        // WS_1 is opened, cleanup closes it (still CONNECTING),
        // second mount opens WS_2 — and only AFTER WS_2 is up does
        // WS_1's `close` event fire asynchronously. Without this
        // guard, WS_1's stale close handler runs `scheduleReconnect`
        // which clears entities and nulls `socketRef.current`,
        // leaving the active WS_2 unreachable from the outbound
        // pump (which is keyed off socketRef.current).
        if (socketRef.current !== ws) {
          return;
        }
        scheduleReconnect();
      });
      ws.addEventListener('error', () => {
        // Browsers fire `error` then `close`; close handles the
        // reconnect. We just close defensively here in case some
        // implementations don't follow that order.
        ws.close();
      });
    };

    // Outbound input pump. Ticks regardless of whether the socket
    // is currently connected; sends when there is one. Carries:
    //   - PlayerInput, when local transform or route changed.
    //   - Any pending scene events queued via emitSceneEvent.
    outboundTimer.current = window.setInterval(() => {
      const ws = socketRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        return;
      }
      // Player input — only when something changed.
      const current = readLocalTransform();
      const route = useWorldStore.getState().currentRoute;
      const presence = readLocalPresence();
      if (
        !transformsEqual(current, lastSentTransform.current) ||
        route !== lastSentRoute.current ||
        !presenceEqual(presence, lastSentPresence.current)
      ) {
        lastSentTransform.current = current;
        lastSentRoute.current = route;
        lastSentPresence.current = presence;
        const inputMsg: ClientMessage = {
          type: 'player_input',
          transform: current,
          route,
          presence,
        };
        ws.send(JSON.stringify(inputMsg));
      }
      // Scene events — drain anything emitted since last tick.
      // Sends one message per event for now; if we hit volume,
      // batch into a single `scene_events` array variant later.
      const queued = drainOutboundQueue();
      for (const event of queued) {
        const eventMsg: ClientMessage = { type: 'scene_event', event };
        ws.send(JSON.stringify(eventMsg));
      }
    }, 1000 / OUTBOUND_HZ);

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer.current !== null) {
        window.clearTimeout(reconnectTimer.current);
        reconnectTimer.current = null;
      }
      if (outboundTimer.current !== null) {
        window.clearInterval(outboundTimer.current);
        outboundTimer.current = null;
      }
      if (socketRef.current) {
        socketRef.current.close();
        socketRef.current = null;
      }
      clearAllEntities();
      dropAllSnapshots();
    };
  }, [
    url,
    adminToken,
    enabled,
    upsertEntities,
    removeEntities,
    setLocalPlayerId,
    clearAllEntities,
  ]);
}

export interface Dispatchers {
  upsertEntities: (entities: ReadonlyArray<Entity>) => void;
  removeEntities: (ids: ReadonlyArray<EntityId>) => void;
  setLocalPlayerId: (id: EntityId | null) => void;
  clearAllEntities: () => void;
}

/** Route an inbound `ServerMessage` to the correct dispatcher.
 *  Pure — exported for direct testing without spinning up a
 *  WebSocket. Errors are logged, not thrown, so a malformed
 *  message from a future server version doesn't kill the
 *  client (graceful degradation).
 *
 *  Also records snapshots into the interpolation buffer
 *  (side effect on the `snapshotInterpolation` module) when
 *  entities arrive, so remote rendering can sample smoothed
 *  transforms each frame. Snapshot recording uses
 *  `performance.now()` if available — otherwise `Date.now()` —
 *  so this function works in both the browser and (jsdom) tests.
 */
export function dispatchServerMessage(msg: ServerMessage, d: Dispatchers): void {
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  switch (msg.type) {
    case 'full_state':
      d.upsertEntities(msg.entities);
      d.setLocalPlayerId(msg.your_player_id);
      for (const e of msg.entities) {
        recordSnapshot(e.id, now, e.transform.position, e.transform.quaternion);
      }
      break;
    case 'entity_updates':
      d.upsertEntities(msg.entities);
      for (const e of msg.entities) {
        recordSnapshot(e.id, now, e.transform.position, e.transform.quaternion);
      }
      break;
    case 'entity_deleted':
      d.removeEntities(msg.ids);
      for (const id of msg.ids) {
        dropSnapshot(id);
      }
      break;
    case 'scene_event':
      dispatchSceneEvent(msg.event, msg.actor_id);
      break;
    case 'error':
      // eslint-disable-next-line no-console
      console.warn('[multiplayer] server error:', msg.message);
      break;
  }
}

/** Read the local player's current presence state from the
 *  central store. Per ADR-006: continuous duration-style state
 *  the receiver renders as third-person indicators. New fields
 *  add here as they're needed (slice 3b: `near` for proximity-
 *  based interactable highlights). */
export function readLocalPresence(): PlayerPresence {
  const state = useWorldStore.getState();
  // Only carry the reveal fields while the cascade is active.
  // Once the local player resets to 'idle' or completes
  // ('revealed'), we drop them so receivers can detect the
  // end-of-cascade. We send through 'revealed' so receivers
  // see the final settled state (portals appear there).
  const sendingReveal = state.revealState !== 'idle';
  const cascadePresence: Partial<PlayerPresence> = sendingReveal
    ? {
        reveal_state: state.revealState,
        reveal_state_entered_at: state.revealStateEnteredAt,
        click_hit_point: state.clickHit?.point ?? null,
        click_hit_normal: state.clickHit?.normal ?? null,
        click_cam_pos: state.clickCamPose?.position ?? null,
        click_cam_quat: state.clickCamPose?.quaternion ?? null,
        reveal_slot_index: state.revealSlotIndex,
      }
    : {};
  return {
    menu: state.menuOpen ? 'pause' : null,
    ...cascadePresence,
  };
}

/** Pure equality check on the presence bag — exported for tests.
 *  Compares only the keys the protocol cares about; new keys must
 *  be added here when introduced (the alternative — JSON.stringify
 *  comparison — is brittle to key ordering and silently expensive).
 *
 *  Vector fields use referential equality: presence is rebuilt
 *  from the store each tick, but the underlying tuples come
 *  straight from `clickHit` / `clickCamPose` and don't change
 *  identity between renders — a referential check correctly
 *  catches "same data" without per-tick array comparison cost. */
export function presenceEqual(a: PlayerPresence, b: PlayerPresence): boolean {
  return (
    a.menu === b.menu &&
    a.near === b.near &&
    a.reveal_state === b.reveal_state &&
    a.reveal_state_entered_at === b.reveal_state_entered_at &&
    a.click_hit_point === b.click_hit_point &&
    a.click_hit_normal === b.click_hit_normal &&
    a.click_cam_pos === b.click_cam_pos &&
    a.click_cam_quat === b.click_cam_quat &&
    a.reveal_slot_index === b.reveal_slot_index
  );
}

/** Read the current local cursor world pose into a Transform.
 *  Both `cursorWorldPosition` and `cursorWorldQuaternion` are
 *  written each frame by CursorAvatar's useFrame. Scale is held
 *  identity — the local avatar self-scales for animation
 *  effects (intro pan, hover/press lerp), but those are
 *  view-relative and shouldn't drive remote rendering. */
function readLocalTransform(): Transform {
  return {
    position: [cursorWorldPosition.x, cursorWorldPosition.y, cursorWorldPosition.z],
    quaternion: [
      cursorWorldQuaternion.x,
      cursorWorldQuaternion.y,
      cursorWorldQuaternion.z,
      cursorWorldQuaternion.w,
    ],
    scale: [1, 1, 1],
  };
}

/** Sub-millimetre threshold so float jitter from `cursorWorldPosition`
 *  reads doesn't trigger a network message every frame. The exact
 *  value is unimportant — anywhere from 1e-4 to 1e-2 is fine; the
 *  point is to coalesce "no actual movement" into "no message." */
export const POSITION_EPSILON = 0.001;

/** Quaternion components are bounded in [-1, 1] so a much smaller
 *  threshold makes sense — sub-degree rotation changes are visually
 *  meaningful for cursor pose and shouldn't be coalesced away. */
export const QUATERNION_EPSILON = 0.0005;

/** Pure equality check used by the outbound pump to skip sends
 *  when neither position nor rotation changed. Scale not compared
 *  — the hook doesn't source it from the client. Exported for
 *  tests. */
export function transformsEqual(a: Transform, b: Transform): boolean {
  if (
    Math.abs(a.position[0] - b.position[0]) > POSITION_EPSILON ||
    Math.abs(a.position[1] - b.position[1]) > POSITION_EPSILON ||
    Math.abs(a.position[2] - b.position[2]) > POSITION_EPSILON
  ) {
    return false;
  }
  return (
    Math.abs(a.quaternion[0] - b.quaternion[0]) <= QUATERNION_EPSILON &&
    Math.abs(a.quaternion[1] - b.quaternion[1]) <= QUATERNION_EPSILON &&
    Math.abs(a.quaternion[2] - b.quaternion[2]) <= QUATERNION_EPSILON &&
    Math.abs(a.quaternion[3] - b.quaternion[3]) <= QUATERNION_EPSILON
  );
}
