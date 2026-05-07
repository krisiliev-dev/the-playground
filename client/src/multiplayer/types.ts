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
      type: 'error';
      message: string;
    };

// ─── Outbound (client → server) ───────────────────────────────

export type ClientMessage =
  | {
      type: 'player_input';
      transform: Transform;
      route: string;
    }
  | {
      type: 'entity_mutation';
      op: EntityOp;
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
