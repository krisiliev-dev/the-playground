/**
 * Tests for the portals registry constants. Pins:
 *
 *   - `MAX_PORTAL_RECURSION` is in a sensible range — past the level
 *     where perspective shrinkage makes nested portals sub-pixel,
 *     but well under the 8-bit stencil-buffer ceiling.
 *   - The default `PORTAL_ENDPOINTS` config is internally consistent
 *     (each `pairedWith` resolves; sizes are positive; quaternions
 *     are unit). The cascade math treats these as preconditions.
 */
import { describe, it, expect } from 'vitest';
import { MAX_PORTAL_RECURSION, PORTAL_ENDPOINTS, getPaired } from '@/content/portals';

describe('MAX_PORTAL_RECURSION', () => {
  it('is a positive integer', () => {
    expect(Number.isInteger(MAX_PORTAL_RECURSION)).toBe(true);
    expect(MAX_PORTAL_RECURSION).toBeGreaterThan(0);
  });

  it('is at most 255 (8-bit stencil buffer ceiling)', () => {
    // Higher would overflow the increment op and wrap to 0, breaking
    // the per-level mask. The cascade increments stencil once per
    // recursion level and decrements on the way out.
    expect(MAX_PORTAL_RECURSION).toBeLessThanOrEqual(255);
  });

  it('is high enough to render a visible "infinite tunnel"', () => {
    // Anything below ~8 makes the tunnel feel chopped. Pin a soft
    // floor so a future tweak doesn't accidentally drop visible
    // recursion below the design intent.
    expect(MAX_PORTAL_RECURSION).toBeGreaterThanOrEqual(8);
  });
});

describe('PORTAL_ENDPOINTS — registry self-consistency', () => {
  it('every endpoint has a pairedWith that resolves to another endpoint', () => {
    for (const ep of PORTAL_ENDPOINTS) {
      const paired = getPaired(ep.id);
      expect(paired, `${ep.id}.pairedWith=${ep.pairedWith} did not resolve`).not.toBeNull();
    }
  });

  it('each endpoint has a non-zero rectangle size', () => {
    for (const ep of PORTAL_ENDPOINTS) {
      expect(ep.size.width).toBeGreaterThan(0);
      expect(ep.size.height).toBeGreaterThan(0);
    }
  });

  it('each endpoint quaternion is unit-length (within tolerance)', () => {
    for (const ep of PORTAL_ENDPOINTS) {
      const [x, y, z, w] = ep.quaternion;
      const len = Math.hypot(x, y, z, w);
      expect(len).toBeCloseTo(1, 5);
    }
  });

  it('endpoint ids are unique', () => {
    const ids = PORTAL_ENDPOINTS.map((ep) => ep.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
