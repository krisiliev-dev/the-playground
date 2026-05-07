/**
 * Snapshot interpolation for remote entities.
 *
 * Server ticks at 30 Hz; clients render at 60–144 Hz. Naïvely
 * snapping to the latest tick produces visible staircase motion.
 * This module buffers the last few server snapshots per entity
 * and samples a smoothly-interpolated transform at render time.
 *
 * Standard "render-behind-by-one-tick" technique:
 *   - When an EntityUpdates arrives, `recordSnapshot` pushes the
 *     transform with a `performance.now()` timestamp.
 *   - Each render frame, `sampleSnapshot` is called with
 *     `performance.now() - INTERP_DELAY_MS`. By rendering ~one
 *     tick BEHIND live time, we always bracket the render time
 *     between two known snapshots and lerp between them. The
 *     trade is INTERP_DELAY_MS of perceived lag (~unnoticeable
 *     to the player) for guaranteed-smooth motion regardless of
 *     network jitter.
 *
 * Quaternion interpolation deferred — the client doesn't (yet)
 * source rotation from the local cursor, so all snapshots have
 * identity quaternion, and slerp would be a no-op. When real
 * pose lands, swap `lerpVec3` for slerp on the quaternion path.
 */
import type { EntityId } from './types';

/** How far behind live time to render. 100ms is conservative —
 *  3× the server's 33ms tick interval, giving enough headroom
 *  for typical network jitter. Drop to ~50ms once we have data
 *  on real-world jitter distributions. */
export const INTERP_DELAY_MS = 100;

/** Cap per-entity snapshot history. At 30 Hz that's ~1.3 s of
 *  buffer — far more than INTERP_DELAY_MS needs, but cheap to
 *  hold and useful if we later want long replay / catch-up. */
export const SNAPSHOT_BUFFER_MAX = 40;

export interface Snapshot {
  /** `performance.now()` at the moment the snapshot arrived. */
  time: number;
  position: readonly [number, number, number];
  quaternion: readonly [number, number, number, number];
}

export interface SampledTransform {
  position: [number, number, number];
  quaternion: [number, number, number, number];
}

/**
 * Per-entity ring of snapshots. Keeps the most-recent
 * `SNAPSHOT_BUFFER_MAX` entries; older fall off the front.
 *
 * Pure data structure — no React, no Three.js, no DOM. Tested
 * directly via `__tests__/multiplayer/snapshotInterpolation`.
 */
export class SnapshotBuffer {
  private readonly snapshots: Snapshot[] = [];

  push(snapshot: Snapshot): void {
    this.snapshots.push(snapshot);
    if (this.snapshots.length > SNAPSHOT_BUFFER_MAX) {
      this.snapshots.shift();
    }
  }

  /**
   * Sample at `renderTime` (an absolute `performance.now()` value).
   *
   * Behaviour:
   *   - Empty buffer → null. Caller decides what to do (typically:
   *     skip rendering, leave at last known position).
   *   - One snapshot → that snapshot's transform (no interpolation
   *     possible).
   *   - `renderTime` inside the buffered range → lerp between the
   *     two bracketing snapshots.
   *   - `renderTime` before earliest → clamp to earliest. Happens
   *     in the first ~100ms after an entity is added — by design.
   *   - `renderTime` after latest → clamp to latest. Indicates
   *     INTERP_DELAY_MS is too short for current jitter, or that
   *     no new snapshots have arrived (player went idle).
   */
  sample(renderTime: number): SampledTransform | null {
    const len = this.snapshots.length;
    if (len === 0) {
      return null;
    }
    if (len === 1) {
      return toSampled(this.snapshots[0]!);
    }

    const earliest = this.snapshots[0]!;
    const latest = this.snapshots[len - 1]!;

    // Strict comparison: if renderTime EQUALS earliest.time
    // (and there's a duplicate snapshot at the same time), let
    // the bracketing scan run so duplicate-time pairs resolve to
    // the newer one (span=0, t=1). Same logic at the latest end.
    if (renderTime < earliest.time) {
      return toSampled(earliest);
    }
    if (renderTime > latest.time) {
      return toSampled(latest);
    }

    // Find the bracketing pair. Scan from newest backward —
    // typical render time is just behind the latest snapshot.
    for (let i = len - 1; i > 0; i--) {
      const newer = this.snapshots[i]!;
      const older = this.snapshots[i - 1]!;
      if (older.time <= renderTime && renderTime <= newer.time) {
        const span = newer.time - older.time;
        const t = span === 0 ? 1 : (renderTime - older.time) / span;
        return {
          position: lerpVec3(older.position, newer.position, t),
          // Quaternion: NOT slerp yet. With identity quaternions
          // throughout, lerp is identical to slerp; once real
          // rotation lands, replace with three.js Quaternion.slerp.
          quaternion: lerpVec4(older.quaternion, newer.quaternion, t),
        };
      }
    }

    // Unreachable given the bounds checks above, but typed
    // exhaustiveness needs a return.
    return toSampled(latest);
  }

  /** For tests + diagnostics — never mutate via this. */
  size(): number {
    return this.snapshots.length;
  }
}

function toSampled(s: Snapshot): SampledTransform {
  return {
    position: [s.position[0], s.position[1], s.position[2]],
    quaternion: [s.quaternion[0], s.quaternion[1], s.quaternion[2], s.quaternion[3]],
  };
}

function lerpVec3(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  t: number,
): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function lerpVec4(
  a: readonly [number, number, number, number],
  b: readonly [number, number, number, number],
  t: number,
): [number, number, number, number] {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
    a[3] + (b[3] - a[3]) * t,
  ];
}

// ─── Module-scoped registry ────────────────────────────────────
// One buffer per entity id, allocated lazily on first snapshot.
// Lives outside React state so per-frame sampling has zero hook
// overhead — same pattern as `cursorWorldPosition`.

const buffers = new Map<EntityId, SnapshotBuffer>();

export function recordSnapshot(
  id: EntityId,
  time: number,
  position: readonly [number, number, number],
  quaternion: readonly [number, number, number, number],
): void {
  let buf = buffers.get(id);
  if (!buf) {
    buf = new SnapshotBuffer();
    buffers.set(id, buf);
  }
  buf.push({ time, position, quaternion });
}

export function sampleSnapshot(id: EntityId, renderTime: number): SampledTransform | null {
  return buffers.get(id)?.sample(renderTime) ?? null;
}

export function dropSnapshot(id: EntityId): void {
  buffers.delete(id);
}

export function dropAllSnapshots(): void {
  buffers.clear();
}

/** For tests — direct access to the buffer registry. Don't use
 *  from production code. */
export function _bufferCountForTest(): number {
  return buffers.size;
}
