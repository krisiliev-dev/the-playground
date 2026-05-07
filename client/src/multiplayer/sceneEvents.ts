/**
 * Scene event bus — per ADR-006.
 *
 * Two-way module-scoped pub/sub over the WebSocket:
 *   - `emitSceneEvent(event)` — sends to the server, which
 *     validates and rebroadcasts to other clients. Also runs
 *     local subscribers (the originator's own components react
 *     immediately, e.g. cleanup or instrumentation).
 *   - `useSceneEvent(kind, handler)` — React hook that subscribes
 *     to events of a given kind. Handlers receive (event,
 *     actor_id) so they can position effects relative to the
 *     originating actor's entity.
 *
 * Receive path: `useMultiplayerSync`'s message dispatcher calls
 * `dispatchSceneEvent` for every inbound `scene_event` message —
 * subscribers fire with the event payload.
 *
 * Send path: `emitSceneEvent` writes to a shared queue that the
 * sync hook drains each tick. We can't import the WebSocket from
 * here (circular dep + the socket lives inside the hook's
 * effect), so the queue is the seam.
 *
 * Per ADR-006 §validation: events are optimistic-local. The
 * originator runs their own subscribers immediately AND queues
 * the event for server forwarding; if the server later drops it,
 * other clients simply never receive it (silent failure on the
 * non-originator side).
 */
import { useEffect, useRef } from 'react';
import type { EntityId, SceneEventKind, SceneEventName, SceneEventOf } from './types';

export type SceneEventHandler<K extends SceneEventName> = (
  event: SceneEventOf<K>,
  actorId: EntityId | null,
) => void;

/** Per-kind subscriber sets. Keyed by `SceneEventKind['kind']` so
 *  the type system enforces correct-shape handlers. */
type SubscriberMap = {
  [K in SceneEventName]?: Set<SceneEventHandler<K>>;
};

const subscribers: SubscriberMap = {};

/** Queue of events the sync hook should send to the server on
 *  its next outbound tick. The hook drains this; tests and the
 *  hook itself are the only legitimate consumers. */
const outboundQueue: SceneEventKind[] = [];

/** Drain the outbound queue, returning the events to send.
 *  Internal — `useMultiplayerSync` calls this; production code
 *  should use `emitSceneEvent`. */
export function drainOutboundQueue(): SceneEventKind[] {
  if (outboundQueue.length === 0) {
    return [];
  }
  const drained = [...outboundQueue];
  outboundQueue.length = 0;
  return drained;
}

/** Dispatch an inbound event to all matching local subscribers.
 *  Called by `useMultiplayerSync.dispatchServerMessage`. */
export function dispatchSceneEvent(event: SceneEventKind, actorId: EntityId | null): void {
  const map = subscribers as { [P in SceneEventName]?: Set<unknown> };
  const set = map[event.kind];
  if (!set) {
    return;
  }
  for (const handler of set as Set<(e: SceneEventKind, a: EntityId | null) => void>) {
    // Per-handler try/catch so one bad handler doesn't break
    // the rest. Errors are logged but not rethrown.
    try {
      handler(event, actorId);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[multiplayer] scene event handler threw:', err);
    }
  }
}

/**
 * Queue a scene event for broadcast to other connected clients.
 *
 * Critical contract: this does NOT run local subscribers. The
 * caller is responsible for triggering the local effect directly
 * (typically via a wrapper API like `sfx.playWorld` or
 * `cameraShake.world` that does both jobs). Without this rule,
 * the originator would double-trigger their own effect — once
 * from the wrapper's direct call, once from the receiver
 * subscribing to its own emitted event.
 *
 * Per ADR-006 optimistic-local: the originator already played
 * the effect by the time this call happens. The server validates
 * + fans out to others; receivers run their subscribers from
 * inbound network events only (via `dispatchSceneEvent` called
 * by `useMultiplayerSync`). The server's self-echo filter
 * (`filter_self_echo` in handlers.rs) ensures the originator
 * never receives their own event back.
 *
 * Calling this when multiplayer is disabled (no WS) is safe —
 * the queue accumulates harmlessly; entries are dropped when
 * the dispatcher's cleanup runs.
 */
export function emitSceneEvent(event: SceneEventKind): void {
  outboundQueue.push(event);
}

/**
 * Subscribe to scene events of a given kind. Handler receives
 * the typed event variant + the originator's entity id (or null
 * if the event was originated locally via `emitSceneEvent`).
 *
 * Multiple components can subscribe to the same kind; each gets
 * called per inbound event. Order is unspecified.
 */
export function useSceneEvent<K extends SceneEventName>(
  kind: K,
  handler: SceneEventHandler<K>,
): void {
  // Keep a ref to the latest handler so we can register a stable
  // wrapper in subscribers. Without this, every render would
  // re-subscribe with a new closure — fine for correctness but
  // noisy churn for the subscriber Set.
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const wrapper = (event: SceneEventOf<K>, actorId: EntityId | null): void => {
      handlerRef.current(event, actorId);
    };
    // Subscriber map is heterogeneous (different K per kind);
    // cast to a shared narrow type to insert without TS losing
    // its mind on the existential.
    const map = subscribers as { [P in SceneEventName]?: Set<unknown> };
    let set = map[kind];
    if (!set) {
      set = new Set();
      map[kind] = set;
    }
    set.add(wrapper);
    return () => {
      set?.delete(wrapper);
    };
  }, [kind]);
}

/** Test helper — drops every subscriber so cross-test bleed is
 *  impossible. Production code should never call this. */
export function _resetSceneEventBusForTest(): void {
  for (const key of Object.keys(subscribers) as SceneEventName[]) {
    delete subscribers[key];
  }
  outboundQueue.length = 0;
}
