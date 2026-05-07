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
import { cursorWorldPosition } from '@/components/scene/cursorWorldPosition';
import { useWorldStore } from '@/store';
import type { ClientMessage, Entity, EntityId, ServerMessage, Transform } from './types';
import { IDENTITY_TRANSFORM } from './types';
import { dropAllSnapshots, dropSnapshot, recordSnapshot } from './snapshotInterpolation';

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
    // is currently connected; sends when there is one and the
    // transform has changed since the last send.
    outboundTimer.current = window.setInterval(() => {
      const ws = socketRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        return;
      }
      const current = readLocalTransform();
      const route = useWorldStore.getState().currentRoute;
      if (transformsEqual(current, lastSentTransform.current) && route === lastSentRoute.current) {
        return;
      }
      lastSentTransform.current = current;
      lastSentRoute.current = route;
      const msg: ClientMessage = {
        type: 'player_input',
        transform: current,
        route,
      };
      ws.send(JSON.stringify(msg));
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
    case 'error':
      // eslint-disable-next-line no-console
      console.warn('[multiplayer] server error:', msg.message);
      break;
  }
}

/** Read the current local cursor world position into a Transform.
 *  Quaternion + scale are placeholders for now — the avatar's
 *  rotation isn't consumed by remote cube rendering yet. When
 *  remote-avatar-with-pose lands, wire a real quaternion source. */
function readLocalTransform(): Transform {
  return {
    position: [cursorWorldPosition.x, cursorWorldPosition.y, cursorWorldPosition.z],
    quaternion: [0, 0, 0, 1],
    scale: [1, 1, 1],
  };
}

/** Sub-millimetre threshold so float jitter from `cursorWorldPosition`
 *  reads doesn't trigger a network message every frame. The exact
 *  value is unimportant — anywhere from 1e-4 to 1e-2 is fine; the
 *  point is to coalesce "no actual movement" into "no message." */
export const POSITION_EPSILON = 0.001;

/** Pure equality check used by the outbound pump to skip sends
 *  when nothing changed. Quaternion / scale not compared because
 *  the hook doesn't (yet) source either from the client. Exported
 *  for tests. */
export function transformsEqual(a: Transform, b: Transform): boolean {
  return (
    Math.abs(a.position[0] - b.position[0]) <= POSITION_EPSILON &&
    Math.abs(a.position[1] - b.position[1]) <= POSITION_EPSILON &&
    Math.abs(a.position[2] - b.position[2]) <= POSITION_EPSILON
  );
}
