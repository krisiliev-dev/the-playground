/**
 * Wire protocol — TypeScript mirrors of `server/src/protocol.rs`.
 *
 * If you change a shape on the server, change it here too.
 * No code-gen yet; the protocol is small enough that handwritten
 * mirrors are clearer than tooling. Both ends use serde_json /
 * JSON.stringify, so wire-format compatibility is purely a
 * shape-matching exercise.
 *
 * Per ADR-004 the server is authoritative — ClientMessage is
 * intent (the server may reject), ServerMessage is truth.
 */
export type EntityId = string;

export type EntityKind = 'player' | 'portal' | 'model' | 'text';

export interface Transform {
  position: [number, number, number];
  /** (x, y, z, w) — Three.js / glTF convention. */
  quaternion: [number, number, number, number];
  scale: [number, number, number];
}

export interface Entity {
  id: EntityId;
  kind: EntityKind;
  transform: Transform;
  /** Kind-specific bag, treated as opaque on the wire. See
   *  `entity.rs` for per-kind shape conventions. */
  props: Record<string, unknown>;
}

export const IDENTITY_TRANSFORM: Transform = {
  position: [0, 0, 0],
  quaternion: [0, 0, 0, 1],
  scale: [1, 1, 1],
};

// ─── Scene events (per ADR-006) ───────────────────────────────

/** Discriminated union of every transient effect type. Mirror
 *  of `server/src/protocol.rs::SceneEventKind`. */
export type SceneEventKind =
  | {
      kind: 'sword_swing';
      from: [number, number, number];
      to: [number, number, number];
      strength: number;
    }
  | {
      kind: 'sword_impact';
      position: [number, number, number];
    }
  | {
      kind: 'audio';
      sound_id: string;
      position?: [number, number, number] | null;
      volume: number;
    }
  | {
      kind: 'camera_shake';
      position: [number, number, number];
      radius: number;
      intensity: number;
      duration_ms: number;
    };

/** String-tagged subset for `useSceneEvent`'s typed subscription. */
export type SceneEventName = SceneEventKind['kind'];

/** Helper: pick the variant of `SceneEventKind` whose tag is `K`. */
export type SceneEventOf<K extends SceneEventName> = Extract<SceneEventKind, { kind: K }>;

// ─── Inbound (server → client) ────────────────────────────────

export type ServerMessage =
  | {
      type: 'full_state';
      entities: Entity[];
      your_player_id: EntityId;
    }
  | {
      type: 'entity_updates';
      entities: Entity[];
    }
  | {
      type: 'entity_deleted';
      ids: EntityId[];
    }
  | {
      type: 'scene_event';
      actor_id: EntityId | null;
      event: SceneEventKind;
    }
  | {
      type: 'error';
      message: string;
    };

// ─── Outbound (client → server) ───────────────────────────────

/**
 * Presence-state bag that rides along on `PlayerInput`. Per
 * ADR-006: continuous duration-style state — what the player is
 * doing right now — that other clients render as third-person
 * indicators. Distinct from transient `SceneEvent`s.
 *
 * Open-ended object: new fields add without protocol changes.
 * Server treats this opaquely, merging into the player entity's
 * `props` bag. Receivers read specific fields off `entity.props`.
 */
export interface PlayerPresence {
  /** Pause/settings/etc. — non-null means the menu indicator
   *  should render in front of this player's cursor. */
  menu?: string | null;
  /** Reserved for slice 3b — id of the interactable the player
   *  is within proximity range of, so the *object* can react
   *  globally (rim spinning faster, etc.) by aggregating
   *  nearness across all players. */
  near?: string | null;
}

export type ClientMessage =
  | {
      type: 'player_input';
      transform: Transform;
      route: string;
      presence?: PlayerPresence | null;
    }
  | {
      type: 'entity_mutation';
      op: EntityOp;
    }
  | {
      type: 'scene_event';
      event: SceneEventKind;
    };

export type EntityOp =
  | {
      kind: 'create';
      entity: Entity;
    }
  | {
      kind: 'update';
      id: EntityId;
      transform?: Transform;
      props?: Record<string, unknown>;
    }
  | {
      kind: 'delete';
      id: EntityId;
    };
