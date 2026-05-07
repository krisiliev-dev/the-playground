/**
 * Tests for snapshot interpolation — the math that turns 30 Hz
 * server ticks into smooth 60–144 Hz remote-entity motion.
 *
 * Locks the contract:
 *   - empty / single-snapshot buffer behaviour
 *   - clamp at boundaries (before earliest / after latest)
 *   - mid-bracket lerp at fractional t
 *   - max-length eviction
 *   - module-scoped registry: record/sample/drop pairing
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  SnapshotBuffer,
  SNAPSHOT_BUFFER_MAX,
  recordSnapshot,
  sampleSnapshot,
  dropSnapshot,
  dropAllSnapshots,
  _bufferCountForTest,
} from '@/multiplayer/snapshotInterpolation';

const Q_IDENT: [number, number, number, number] = [0, 0, 0, 1];

describe('SnapshotBuffer', () => {
  it('returns null on empty buffer', () => {
    const buf = new SnapshotBuffer();
    expect(buf.sample(0)).toBeNull();
    expect(buf.size()).toBe(0);
  });

  it('returns the lone snapshot when only one is buffered', () => {
    const buf = new SnapshotBuffer();
    buf.push({ time: 100, position: [1, 2, 3], quaternion: Q_IDENT });
    const out = buf.sample(50);
    expect(out?.position).toEqual([1, 2, 3]);

    // Same result regardless of renderTime — single snapshot has
    // no other point to interpolate against.
    expect(buf.sample(200)?.position).toEqual([1, 2, 3]);
  });

  it('clamps to earliest when renderTime is before any snapshot', () => {
    const buf = new SnapshotBuffer();
    buf.push({ time: 100, position: [0, 0, 0], quaternion: Q_IDENT });
    buf.push({ time: 200, position: [10, 0, 0], quaternion: Q_IDENT });

    // renderTime 50 is before earliest (100) — clamp to earliest.
    expect(buf.sample(50)?.position).toEqual([0, 0, 0]);
  });

  it('clamps to latest when renderTime is after any snapshot', () => {
    const buf = new SnapshotBuffer();
    buf.push({ time: 100, position: [0, 0, 0], quaternion: Q_IDENT });
    buf.push({ time: 200, position: [10, 0, 0], quaternion: Q_IDENT });

    // renderTime 300 is past latest (200) — clamp to latest.
    expect(buf.sample(300)?.position).toEqual([10, 0, 0]);
  });

  it('lerps midway between two snapshots', () => {
    const buf = new SnapshotBuffer();
    buf.push({ time: 100, position: [0, 0, 0], quaternion: Q_IDENT });
    buf.push({ time: 200, position: [10, 20, -30], quaternion: Q_IDENT });

    const mid = buf.sample(150);
    expect(mid?.position).toEqual([5, 10, -15]);
  });

  it('lerps at fractional t (3/4 of the way)', () => {
    const buf = new SnapshotBuffer();
    buf.push({ time: 0, position: [0, 0, 0], quaternion: Q_IDENT });
    buf.push({ time: 100, position: [100, 0, 0], quaternion: Q_IDENT });

    const out = buf.sample(75);
    expect(out?.position[0]).toBeCloseTo(75, 6);
  });

  it('finds the correct bracketing pair when many snapshots are buffered', () => {
    const buf = new SnapshotBuffer();
    for (let i = 0; i <= 10; i++) {
      buf.push({ time: i * 100, position: [i * 10, 0, 0], quaternion: Q_IDENT });
    }
    // renderTime 750 is between snapshots at t=700 (pos 70) and t=800 (pos 80).
    const out = buf.sample(750);
    expect(out?.position[0]).toBeCloseTo(75, 6);
  });

  it('nlerps quaternions and normalises the result onto the unit hyper-sphere', () => {
    const buf = new SnapshotBuffer();
    // Identity → 90° around Y. Halfway should be 45° around Y,
    // i.e. (0, sin(22.5°), 0, cos(22.5°)) ≈ (0, 0.3827, 0, 0.9239).
    // Strict slerp would give that. nlerp produces (0, 0.5, 0, 0.5)
    // before normalising → (0, ~0.707, 0, ~0.707). For 90° deltas
    // the difference between nlerp and slerp is visible, but at the
    // per-tick deltas this hook actually sees (~few degrees) it's
    // imperceptible. The contract this test locks: the *result is
    // normalised* (length=1), regardless of which interpolation
    // we use, so downstream Three.js stays well-defined.
    buf.push({ time: 0, position: [0, 0, 0], quaternion: [0, 0, 0, 1] });
    buf.push({ time: 100, position: [0, 0, 0], quaternion: [0, 1, 0, 0] });

    const out = buf.sample(50);
    const q = out!.quaternion;
    const len = Math.sqrt(q[0] ** 2 + q[1] ** 2 + q[2] ** 2 + q[3] ** 2);
    expect(len).toBeCloseTo(1, 6);
    // The y and w components should each be ~0.707 (since the
    // raw lerp would give 0.5 each; normalising scales by sqrt(2)).
    expect(q[1]).toBeCloseTo(Math.SQRT1_2, 4);
    expect(q[3]).toBeCloseTo(Math.SQRT1_2, 4);
  });

  it('takes the short arc when quaternions are on opposite hyper-spheres', () => {
    // q and -q represent the same rotation. Naïve component-wise
    // lerp would interpolate the *long* way around the unit
    // hyper-sphere — visually a 360° spin during a static pose.
    // nlerp with sign correction lerps to the short arc.
    const buf = new SnapshotBuffer();
    buf.push({ time: 0, position: [0, 0, 0], quaternion: [0, 0, 0, 1] });
    buf.push({ time: 100, position: [0, 0, 0], quaternion: [0, 0, 0, -1] });

    const out = buf.sample(50);
    // Short-arc midpoint of (0,0,0,1) and (0,0,0,-1) is
    // (0,0,0,1) — they're the same rotation.
    expect(out!.quaternion[3]).toBeCloseTo(1, 6);
  });

  it('handles zero-time-span snapshots without dividing by zero', () => {
    // Two snapshots arrived in the same tick (rare but possible
    // if the WS delivers two messages in one event-loop turn).
    const buf = new SnapshotBuffer();
    buf.push({ time: 100, position: [0, 0, 0], quaternion: Q_IDENT });
    buf.push({ time: 100, position: [10, 0, 0], quaternion: Q_IDENT });

    // Should pick the newer one (the bracketing scan finds them
    // and span === 0 → t = 1).
    const out = buf.sample(100);
    expect(out?.position).toEqual([10, 0, 0]);
  });

  it('evicts oldest snapshots when length exceeds SNAPSHOT_BUFFER_MAX', () => {
    const buf = new SnapshotBuffer();
    for (let i = 0; i < SNAPSHOT_BUFFER_MAX + 10; i++) {
      buf.push({ time: i, position: [i, 0, 0], quaternion: Q_IDENT });
    }
    expect(buf.size()).toBe(SNAPSHOT_BUFFER_MAX);

    // Earliest 10 should be gone — ask for a renderTime that
    // would have been bracketed by them, expect clamp to the new
    // earliest (which has time = 10).
    const out = buf.sample(5);
    expect(out?.position).toEqual([10, 0, 0]);
  });
});

describe('module-scoped snapshot registry', () => {
  beforeEach(() => {
    dropAllSnapshots();
  });

  it('lazily allocates a buffer per entity id', () => {
    expect(_bufferCountForTest()).toBe(0);
    recordSnapshot('entity-a', 100, [0, 0, 0], Q_IDENT);
    recordSnapshot('entity-b', 100, [0, 0, 0], Q_IDENT);
    expect(_bufferCountForTest()).toBe(2);
  });

  it('appends successive snapshots into the same buffer', () => {
    recordSnapshot('entity-a', 100, [0, 0, 0], Q_IDENT);
    recordSnapshot('entity-a', 200, [10, 0, 0], Q_IDENT);
    expect(_bufferCountForTest()).toBe(1); // still one buffer

    const sample = sampleSnapshot('entity-a', 150);
    expect(sample?.position).toEqual([5, 0, 0]);
  });

  it('returns null for entities that have never been recorded', () => {
    expect(sampleSnapshot('never-seen', 100)).toBeNull();
  });

  it('dropSnapshot removes the entity from the registry', () => {
    recordSnapshot('entity-a', 100, [0, 0, 0], Q_IDENT);
    expect(_bufferCountForTest()).toBe(1);

    dropSnapshot('entity-a');
    expect(_bufferCountForTest()).toBe(0);
    expect(sampleSnapshot('entity-a', 100)).toBeNull();
  });

  it('dropAllSnapshots wipes everything', () => {
    recordSnapshot('a', 100, [0, 0, 0], Q_IDENT);
    recordSnapshot('b', 100, [0, 0, 0], Q_IDENT);
    recordSnapshot('c', 100, [0, 0, 0], Q_IDENT);
    expect(_bufferCountForTest()).toBe(3);

    dropAllSnapshots();
    expect(_bufferCountForTest()).toBe(0);
  });
});
