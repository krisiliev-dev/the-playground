/**
 * VIBE formation — choreography data integrity. These tests pin the
 * sword count, slot ID uniqueness, stroke-direction normalisation,
 * end-offset distribution (on a square perimeter), and per-letter
 * stroke counts. If the V/I/B/E stroke definitions change (e.g. someone
 * adds a serif), these tests fail with a clear "expected 12, got 13"
 * message instead of swords appearing in unexpected positions.
 */
import { describe, it, expect } from 'vitest';
import {
  VIBE_SLOTS,
  VIBE_SWORD_COUNT,
  WORD_CENTERING_FUDGE,
} from '@/components/scene/reveal/vibeFormation';

describe('vibeFormation', () => {
  it('exports 12 sword slots — V(2) + I(1) + B(5) + E(4)', () => {
    expect(VIBE_SWORD_COUNT).toBe(12);
    expect(VIBE_SLOTS.length).toBe(12);
  });

  it('every slot id is unique', () => {
    const ids = VIBE_SLOTS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every slot uses the same shared variant (one-mood word)', () => {
    const variants = new Set(VIBE_SLOTS.map((s) => s.variant));
    expect(variants.size).toBe(1);
  });

  it('mid-direction vectors are unit-length', () => {
    VIBE_SLOTS.forEach((s) => {
      const len = Math.hypot(s.midDir[0], s.midDir[1]);
      expect(len).toBeCloseTo(1, 5);
    });
  });

  it('end offsets land on the perimeter of an axis-aligned square', () => {
    // Every slot's offset must satisfy max(|x|, |y|) === SQUARE_HALF.
    // We don't depend on SQUARE_HALF being exported — read it back as
    // the max chebyshev radius across all slots.
    const chebyshevs = VIBE_SLOTS.map((s) =>
      Math.max(Math.abs(s.endOffset[0]), Math.abs(s.endOffset[1])),
    );
    const half = Math.max(...chebyshevs);
    expect(half).toBeGreaterThan(0);
    chebyshevs.forEach((c) => {
      expect(c).toBeCloseTo(half, 5);
    });
  });

  it('distributes the 12 swords with 3 per square side', () => {
    // Group offsets by which side they lie on. Side identity is
    // "the axis whose absolute coord equals SQUARE_HALF" + sign.
    const half = Math.max(
      ...VIBE_SLOTS.map((s) => Math.max(Math.abs(s.endOffset[0]), Math.abs(s.endOffset[1]))),
    );
    const counts = { right: 0, top: 0, left: 0, bottom: 0 };
    VIBE_SLOTS.forEach((s) => {
      const [x, y] = s.endOffset;
      if (Math.abs(x - half) < 1e-3) {
        counts.right++;
      } else if (Math.abs(x + half) < 1e-3) {
        counts.left++;
      } else if (Math.abs(y - half) < 1e-3) {
        counts.top++;
      } else if (Math.abs(y + half) < 1e-3) {
        counts.bottom++;
      }
    });
    expect(counts.right).toBe(3);
    expect(counts.top).toBe(3);
    expect(counts.left).toBe(3);
    expect(counts.bottom).toBe(3);
  });

  it('every letter (V, I, B, E) is represented', () => {
    const letters = new Set(VIBE_SLOTS.map((s) => s.id.split('_')[0]));
    expect(letters).toEqual(new Set(['V', 'I', 'B', 'E']));
  });

  it('stroke counts per letter match the spec', () => {
    const counts = VIBE_SLOTS.reduce<Record<string, number>>((acc, s) => {
      const letter = s.id.split('_')[0]!;
      acc[letter] = (acc[letter] ?? 0) + 1;
      return acc;
    }, {});
    expect(counts.V).toBe(2);
    expect(counts.I).toBe(1);
    expect(counts.B).toBe(5);
    expect(counts.E).toBe(4);
  });

  it('mid Y positions stay within the letter half-height (HALF_H = 5)', () => {
    VIBE_SLOTS.forEach((s) => {
      expect(Math.abs(s.midPos[1])).toBeLessThanOrEqual(5);
    });
  });

  it('exports the word-centering fudge as a positive constant', () => {
    expect(typeof WORD_CENTERING_FUDGE).toBe('number');
    expect(WORD_CENTERING_FUDGE).toBeGreaterThan(0);
  });

  it('slot ids follow the {LETTER}_{INDEX} pattern', () => {
    VIBE_SLOTS.forEach((s) => {
      expect(s.id).toMatch(/^[VIBE]_\d+$/);
    });
  });
});
