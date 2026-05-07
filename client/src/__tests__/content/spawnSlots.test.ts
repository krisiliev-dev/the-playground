/**
 * Tests for the spawn-slot grid + actor-to-slot assignment.
 *
 * Coverage:
 *   - Slot positions stay inside the cube interior (no clipping
 *     into the wall).
 *   - Slot index wraps around past TOTAL_SLOTS.
 *   - Distinct indices produce distinct cube-wall positions
 *     (within the unwrapped range).
 *   - Slot assignment is deterministic across viewers — sorting
 *     the same peer set gives the same answer.
 *   - The first 100 slots all land on the back wall (sanity
 *     check that wall ordering is stable).
 */
import { describe, it, expect } from 'vitest';
import {
  TOTAL_SLOTS,
  getSpawnSlot,
  getSlotIndexForActor,
  clampHitToSlotSection,
} from '@/content/spawnSlots';

const CUBE_HALF = 400;

describe('getSpawnSlot', () => {
  it('positions every slot strictly inside the cube interior', () => {
    for (let i = 0; i < TOTAL_SLOTS; i++) {
      const slot = getSpawnSlot(i);
      const [x, y, z] = slot.clickHit.point;
      expect(Math.abs(x)).toBeLessThanOrEqual(CUBE_HALF + 0.01);
      expect(Math.abs(y)).toBeLessThanOrEqual(CUBE_HALF + 0.01);
      expect(Math.abs(z)).toBeLessThanOrEqual(CUBE_HALF + 0.01);
    }
  });

  it('places every slot on a wall (one coordinate is ±CUBE_HALF)', () => {
    for (let i = 0; i < TOTAL_SLOTS; i++) {
      const [x, y, z] = getSpawnSlot(i).clickHit.point;
      const onAWall =
        Math.abs(Math.abs(x) - CUBE_HALF) < 0.01 ||
        Math.abs(Math.abs(y) - CUBE_HALF) < 0.01 ||
        Math.abs(Math.abs(z) - CUBE_HALF) < 0.01;
      expect(onAWall).toBe(true);
    }
  });

  it('wraps modulo TOTAL_SLOTS — index N produces same slot as index N + TOTAL_SLOTS', () => {
    const a = getSpawnSlot(7);
    const b = getSpawnSlot(7 + TOTAL_SLOTS);
    expect(b.clickHit.point).toEqual(a.clickHit.point);
    expect(b.roomExitOffset).toEqual(a.roomExitOffset);
  });

  it('returns distinct cube-wall positions for distinct indices in [0, TOTAL_SLOTS)', () => {
    const seen = new Set<string>();
    for (let i = 0; i < TOTAL_SLOTS; i++) {
      const [x, y, z] = getSpawnSlot(i).clickHit.point;
      const key = `${x.toFixed(3)}|${y.toFixed(3)}|${z.toFixed(3)}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it('handles negative indices via the modulo wrap', () => {
    const slot = getSpawnSlot(-1);
    expect(slot.index).toBe(TOTAL_SLOTS - 1);
  });

  it('sets the inward normal to a unit vector along ±X or ±Z', () => {
    for (let i = 0; i < TOTAL_SLOTS; i++) {
      const [nx, ny, nz] = getSpawnSlot(i).clickHit.normal;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
      expect(len).toBeCloseTo(1, 5);
      // Floor + ceiling are skipped, so y component is always 0.
      expect(ny).toBe(0);
    }
  });

  it('lands the first 100 slots on the back wall (-Z)', () => {
    for (let i = 0; i < 100; i++) {
      const slot = getSpawnSlot(i);
      expect(slot.clickHit.point[2]).toBeCloseTo(-CUBE_HALF, 5);
      expect(slot.clickHit.normal).toEqual([0, 0, 1]);
    }
  });
});

describe('getSlotIndexForActor', () => {
  it('assigns slot 0 to the first sorted actor id', () => {
    const peers = ['xyz', 'abc', 'mno'];
    expect(getSlotIndexForActor('abc', peers)).toBe(0);
  });

  it('is deterministic regardless of input order', () => {
    const a = getSlotIndexForActor('mno', ['abc', 'xyz', 'mno']);
    const b = getSlotIndexForActor('mno', ['xyz', 'mno', 'abc']);
    expect(a).toBe(b);
  });

  it('returns 0 when the actor is not in the peer list (defensive fallback)', () => {
    expect(getSlotIndexForActor('ghost', ['a', 'b', 'c'])).toBe(0);
  });

  it('assigns distinct slot indices to up to TOTAL_SLOTS unique actors', () => {
    const peers = Array.from({ length: 50 }, (_, i) => `actor-${String(i).padStart(3, '0')}`);
    const indexes = peers.map((id) => getSlotIndexForActor(id, peers));
    expect(new Set(indexes).size).toBe(50);
  });
});

describe('clampHitToSlotSection', () => {
  it('passes through a hit at the slot center unchanged', () => {
    const slot = getSpawnSlot(0);
    const center = slot.clickHit;
    const clamped = clampHitToSlotSection(center, slot);
    expect(clamped.point[0]).toBeCloseTo(center.point[0], 5);
    expect(clamped.point[1]).toBeCloseTo(center.point[1], 5);
    expect(clamped.point[2]).toBeCloseTo(center.point[2], 5);
  });

  it('clamps a hit far past the section edge to the section boundary', () => {
    const slot = getSpawnSlot(0);
    const halfX = slot.sectionHalfExtent[0];
    // Hit 9999 units to the right of the slot center along the
    // wall plane → should land at the +halfX boundary.
    const farRight = {
      point: [
        slot.clickHit.point[0] + 9999 * slot.wallRight[0],
        slot.clickHit.point[1] + 9999 * slot.wallRight[1],
        slot.clickHit.point[2] + 9999 * slot.wallRight[2],
      ] as [number, number, number],
      normal: slot.clickHit.normal,
    };
    const clamped = clampHitToSlotSection(farRight, slot);
    // Distance from slot center along right axis should equal halfX.
    const dx = clamped.point[0] - slot.clickHit.point[0];
    const dy = clamped.point[1] - slot.clickHit.point[1];
    const dz = clamped.point[2] - slot.clickHit.point[2];
    const tx =
      dx * slot.wallRight[0] + dy * slot.wallRight[1] + dz * slot.wallRight[2];
    expect(tx).toBeCloseTo(halfX, 5);
  });

  it('keeps a hit inside the section unchanged', () => {
    const slot = getSpawnSlot(0);
    // 5 units along right axis (well inside the section).
    const inside = {
      point: [
        slot.clickHit.point[0] + 5 * slot.wallRight[0],
        slot.clickHit.point[1] + 5 * slot.wallRight[1],
        slot.clickHit.point[2] + 5 * slot.wallRight[2],
      ] as [number, number, number],
      normal: slot.clickHit.normal,
    };
    const clamped = clampHitToSlotSection(inside, slot);
    expect(clamped.point[0]).toBeCloseTo(inside.point[0], 5);
    expect(clamped.point[1]).toBeCloseTo(inside.point[1], 5);
    expect(clamped.point[2]).toBeCloseTo(inside.point[2], 5);
  });

  it('always returns the slot wall normal (collapses cross-wall clicks)', () => {
    // Slot 100 lives on the front wall (+Z normal = -Z). Suppose the
    // user's raycast hit the back wall instead: the clamp should
    // still yield the slot's wall normal, not the back wall's.
    const slot = getSpawnSlot(100);
    const wrongWallHit = {
      point: [10, 5, -400] as [number, number, number],
      normal: [0, 0, 1] as [number, number, number],
    };
    const clamped = clampHitToSlotSection(wrongWallHit, slot);
    expect(clamped.normal).toEqual(slot.clickHit.normal);
  });

  it('two adjacent slots clamping to their facing edges still leave a clearance', () => {
    // Cluster radius is FORMATION_QUADRANT_OFFSET + DEFAULT_PORTAL_SIZE/2 ≈ 11.
    // Adjacent slot centers on the back wall are ~78 apart along
    // wallRight. Each section has halfExtent 28, so worst-case
    // adjacent clusters land at displacement +28 / -28 from their
    // slot centers — distance between cluster centers becomes
    // 78 - 28 - 28 = 22, which is exactly 2 * cluster radius. The
    // safety buffer (4-unit gap between slots) makes the actual
    // clearance ≥ 0.
    const a = getSpawnSlot(0);
    const b = getSpawnSlot(1);
    expect(b.clickHit.point[0]).toBeGreaterThan(a.clickHit.point[0]);
    const slotSpacing = b.clickHit.point[0] - a.clickHit.point[0];
    const minDistance = slotSpacing - 2 * a.sectionHalfExtent[0];
    const clusterDiameter = 22; // 2 * (FORMATION_QUADRANT_OFFSET + DEFAULT_PORTAL_SIZE/2)
    expect(minDistance).toBeGreaterThanOrEqual(clusterDiameter - 0.001);
  });
});
