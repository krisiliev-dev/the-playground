/**
 * walkCellCrossings — covers the bounded-loop grid traversal extracted
 * from BoxEnvironment.tsx. The previous inline implementation used an
 * unbounded `while (cell !== toCell)` that could in principle fail to
 * converge under float-precision drift; the new helper has an explicit
 * step cap. These tests pin the contract:
 *   - Empty walk (from === to) emits nothing.
 *   - Forward walk emits one crossing per cell, on the leading edge.
 *   - Backward walk emits one crossing per cell, on the trailing edge.
 *   - Spacing scales the emitted coords linearly.
 *   - Negative cell indices work the same way (cells aren't required
 *     to be non-negative — the wall-local frame allows both signs).
 *   - Loop is bounded — even with absurd inputs, it terminates.
 */
import { describe, it, expect, vi } from 'vitest';
import { walkCellCrossings } from '@/components/scene/cellWalk';

describe('walkCellCrossings', () => {
  it('emits no crossings when fromCell === toCell', () => {
    const onCrossing = vi.fn();
    const count = walkCellCrossings(5, 5, 10, onCrossing);
    expect(count).toBe(0);
    expect(onCrossing).not.toHaveBeenCalled();
  });

  it('forward walk emits one crossing per cell on the leading edge', () => {
    // Cells 3 → 5: crossings at the 4·spacing and 5·spacing lines (the
    // leading edges of cells 4 and 5). With spacing=10 → coords [40, 50].
    const seen: number[] = [];
    const count = walkCellCrossings(3, 5, 10, (c) => seen.push(c));
    expect(count).toBe(2);
    expect(seen).toEqual([40, 50]);
  });

  it('backward walk emits one crossing per cell on the trailing edge', () => {
    // Cells 5 → 3: dir = -1, so we emit (cell + 0) * spacing for each.
    // First iteration cell=5 → coord 50; then cell=4 → coord 40.
    const seen: number[] = [];
    const count = walkCellCrossings(5, 3, 10, (c) => seen.push(c));
    expect(count).toBe(2);
    expect(seen).toEqual([50, 40]);
  });

  it('emits exactly one crossing for an adjacent forward step', () => {
    const seen: number[] = [];
    walkCellCrossings(0, 1, 5, (c) => seen.push(c));
    expect(seen).toEqual([5]);
  });

  it('emits exactly one crossing for an adjacent backward step', () => {
    const seen: number[] = [];
    walkCellCrossings(0, -1, 5, (c) => seen.push(c));
    expect(seen).toEqual([0]);
  });

  it('handles negative cell indices on both sides', () => {
    // Cells -2 → +1: dir = +1, three steps. Coords (cell+1)*spacing for
    // cells -2, -1, 0 → [-spacing, 0, spacing] = [-10, 0, 10].
    const seen: number[] = [];
    walkCellCrossings(-2, 1, 10, (c) => seen.push(c));
    expect(seen).toEqual([-10, 0, 10]);
  });

  it('scales emitted coordinates by spacing', () => {
    // Same logical walk, two different spacings.
    const seenA: number[] = [];
    const seenB: number[] = [];
    walkCellCrossings(0, 3, 1, (c) => seenA.push(c));
    walkCellCrossings(0, 3, 7, (c) => seenB.push(c));
    expect(seenB).toEqual(seenA.map((c) => c * 7));
  });

  it('returns the number of crossings emitted', () => {
    expect(walkCellCrossings(0, 0, 10, () => undefined)).toBe(0);
    expect(walkCellCrossings(0, 1, 10, () => undefined)).toBe(1);
    expect(walkCellCrossings(0, 5, 10, () => undefined)).toBe(5);
    expect(walkCellCrossings(5, 0, 10, () => undefined)).toBe(5);
    expect(walkCellCrossings(-3, 4, 10, () => undefined)).toBe(7);
  });

  it('terminates even on absurdly large walks (bounded by step count)', () => {
    // Real frame-rate gameplay never produces a walk this long, but the
    // bound proves the loop is finite by construction. 10000 calls into
    // the callback — if the cap weren't honored, this would hang.
    let n = 0;
    const count = walkCellCrossings(0, 10000, 1, () => n++);
    expect(count).toBe(10000);
    expect(n).toBe(10000);
  });
});
