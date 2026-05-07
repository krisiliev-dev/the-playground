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
    }
  | {
      kind: 'asset_available';
      id: string;
      url: string;
      extension: string;
      size: number;
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
  /** Current reveal phase, broadcast continuously while a
   *  cascade is in progress. Receivers drive the remote
   *  cascade off this. Null/idle ⇒ no cascade. */
  reveal_state?: string | null;
  /** Wall-clock seconds (`performance.now() / 1000`) when the
   *  player's `reveal_state` last changed. Receivers use the
   *  *elapsed since first observation* to drive remote
   *  animation rather than mixing wall clocks across machines
   *  — the originator's `enteredAt` is opaque to us, but the
   *  *change moment* is observable on this side. */
  reveal_state_entered_at?: number | null;
  /** World-space click point on the cube wall (the centre of
   *  the impact ring). Frozen at click time, broadcast for the
   *  duration of the cascade so late joiners can compute
   *  geometry. Drives portal placement on receivers, too. */
  click_hit_point?: [number, number, number] | null;
  /** Inward-facing wall normal at the click. Pairs with
   *  `click_hit_point` to give receivers everything they need
   *  to construct the wall basis. */
  click_hit_normal?: [number, number, number] | null;
  /** Originator's camera world position at click time. The
   *  cascade's spawn + mid positions are camera-relative, so
   *  receivers must use the originator's POV (not their own) to
   *  reproduce the geometry. */
  click_cam_pos?: [number, number, number] | null;
  /** Originator's camera world quaternion at click time
   *  (x, y, z, w). Same rationale as `click_cam_pos`. */
  click_cam_quat?: [number, number, number, number] | null;
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
