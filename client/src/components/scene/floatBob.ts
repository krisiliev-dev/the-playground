/**
 * Float bob helpers — vertical sine motion applied to a RoomBox.
 *
 * Each `RoomBox` declares its own `BobConfig` (or none); the box's
 * render transform reads `floatOffset(time, config)` each frame to
 * compute its current Y offset. The avatar deliberately lives
 * outside whichever group is bobbing, so its world position drifts
 * relative to the cube's local frame — routing math compensates by
 * subtracting the same `floatOffset` before doing bbox tests.
 *
 * Pure functions, no side effects — safe to share across the
 * render path and the routing path without coupling them.
 */
import type { BobConfig } from '@/content/routes';

/** Signed Y offset (in world units) of a box bobbing with `config`
 *  at `time` seconds. Returns 0 when `config` is undefined — the
 *  "no bob" case — so callers can pass an optional config without
 *  branching. */
export function floatOffset(time: number, config: BobConfig | undefined): number {
  if (!config) {
    return 0;
  }
  return Math.sin((time / config.period) * Math.PI * 2) * config.amplitude;
}
