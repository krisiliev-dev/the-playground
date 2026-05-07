/**
 * Pure-function tests for the portal rim particle helpers. Pins:
 *
 *   - Spawn position lies on the rectangle perimeter (no interior
 *     spawns, no off-edge drift).
 *   - Velocity is biased outward from the spawn edge — the load-
 *     bearing property that keeps the cloud from dissolving inward.
 *   - Speed and lifetime stay inside their declared ranges.
 *   - `stagger=true` puts initial age inside `[0, lifetime)`,
 *     `stagger=false` resets it to 0.
 *   - `buildRimPalette` produces the expected weighted distribution
 *     (base color dominates, with white sparkles + accent).
 */
import { describe, it, expect } from 'vitest';
import { Color, Vector3 } from 'three';
import {
  buildRimPalette,
  RIM_PARTICLE_LIFETIME_MAX,
  RIM_PARTICLE_LIFETIME_MIN,
  RIM_PARTICLE_OUTWARD_BIAS,
  RIM_PARTICLE_SPEED_MAX,
  RIM_PARTICLE_SPEED_MIN,
  type RimParticle,
  respawnRimParticle,
} from '@/components/scene/portal/rimParticle';

const WIDTH = 60;
const HEIGHT = 80;
const HALF_W = WIDTH / 2;
const HALF_H = HEIGHT / 2;

function makeParticle(): RimParticle {
  return {
    origin: new Vector3(),
    velocity: new Vector3(),
    color: new Color(),
    age: 0,
    lifetime: 1,
  };
}

/** Deterministic RNG: returns the values in `seq`, looping if exhausted.
 *  Lets each test pin every random draw exactly. */
function seq(values: number[]): () => number {
  let i = 0;
  return () => {
    const v = values[i % values.length]!;
    i += 1;
    return v;
  };
}

describe('buildRimPalette', () => {
  it('returns 11 colors (base ×6 + light ×2 + white ×2 + accent ×1)', () => {
    expect(buildRimPalette('#00ffcc')).toHaveLength(11);
  });

  it('the first six entries are the base color (the weighted dominant)', () => {
    const palette = buildRimPalette('#ff6ec7');
    const base = new Color('#ff6ec7');
    for (let i = 0; i < 6; i += 1) {
      expect(palette[i]!.equals(base)).toBe(true);
    }
  });

  it('white slots are pure white (#ffffff)', () => {
    const palette = buildRimPalette('#00ffcc');
    expect(palette[8]!.getHex()).toBe(0xffffff);
    expect(palette[9]!.getHex()).toBe(0xffffff);
  });

  it('the accent slot is the complementary hue (180° around the wheel)', () => {
    const palette = buildRimPalette('#00ffcc'); // cyan, hue ≈ 0.469
    const accent = palette[10]!;
    const baseHsl = { h: 0, s: 0, l: 0 };
    const accentHsl = { h: 0, s: 0, l: 0 };
    new Color('#00ffcc').getHSL(baseHsl);
    accent.getHSL(accentHsl);
    const expectedHue = (baseHsl.h + 0.5) % 1;
    expect(accentHsl.h).toBeCloseTo(expectedHue, 4);
  });

  it('the light variant is brighter than the base (no channel decreased, at least one up)', () => {
    const palette = buildRimPalette('#00ffcc');
    const base = new Color('#00ffcc'); // r=0, g=1, b=0.8
    const light = palette[6]!;
    // Lerp toward white never reduces a channel. Already-saturated
    // channels (g=1 here) stay at 1; the dark channel (r=0) is the
    // one that must visibly brighten.
    expect(light.r).toBeGreaterThanOrEqual(base.r);
    expect(light.g).toBeGreaterThanOrEqual(base.g);
    expect(light.b).toBeGreaterThanOrEqual(base.b);
    expect(light.r).toBeGreaterThan(base.r);
  });
});

describe('respawnRimParticle — spawn position', () => {
  const palette = buildRimPalette('#00ffcc');

  it('first quarter of the perimeter walks the top edge (y = +halfH)', () => {
    // perimeter = 2(60+80) = 280. t = 0.1 * 280 = 28 < width(60) → top edge,
    // x = -30 + 28 = -2.
    const p = makeParticle();
    respawnRimParticle(p, WIDTH, HEIGHT, palette, false, seq([0.1, 0, 0, 0, 0]));
    expect(p.origin.x).toBeCloseTo(-2, 6);
    expect(p.origin.y).toBeCloseTo(HALF_H, 6);
    expect(p.origin.z).toBe(0);
  });

  it('past width walks the right edge (x = +halfW)', () => {
    // t = 0.5 * 280 = 140; width(60) ≤ t < width+height(140) → right edge.
    // y = halfH - (t - width) = 40 - 80 = -40 (just hit the corner).
    const p = makeParticle();
    respawnRimParticle(p, WIDTH, HEIGHT, palette, false, seq([0.5, 0, 0, 0, 0]));
    expect(p.origin.x).toBeCloseTo(HALF_W, 6);
    expect(p.origin.y).toBeCloseTo(-HALF_H, 6);
  });

  it('past width+height walks the bottom edge (y = -halfH)', () => {
    // t = 200 → 140 ≤ t < 200 (= 2*60+80) → bottom edge,
    // x = halfW - (t - width - height) = 30 - 60 = -30. Wait — t at 0.6
    // gives 168, which is in the bottom-edge range [140, 200].
    // x = 30 - (168 - 140) = 30 - 28 = 2.
    const p = makeParticle();
    respawnRimParticle(p, WIDTH, HEIGHT, palette, false, seq([0.6, 0, 0, 0, 0]));
    expect(p.origin.x).toBeCloseTo(2, 6);
    expect(p.origin.y).toBeCloseTo(-HALF_H, 6);
  });

  it('last segment walks the left edge (x = -halfW)', () => {
    // t = 0.85 * 280 = 238, in [200, 280] → left edge.
    // y = -halfH + (t - 200) = -40 + 38 = -2.
    const p = makeParticle();
    respawnRimParticle(p, WIDTH, HEIGHT, palette, false, seq([0.85, 0, 0, 0, 0]));
    expect(p.origin.x).toBeCloseTo(-HALF_W, 6);
    expect(p.origin.y).toBeCloseTo(-2, 6);
  });

  it('a sweep over t lands every spawn on the rectangle perimeter', () => {
    // Property test: regardless of where on the perimeter we sample,
    // the spawn point is on one of the four edges (one coord at ±half).
    const p = makeParticle();
    for (let i = 0; i < 50; i += 1) {
      respawnRimParticle(p, WIDTH, HEIGHT, palette, false, seq([i / 50, 0, 0, 0, 0]));
      const onTopOrBottom = Math.abs(Math.abs(p.origin.y) - HALF_H) < 1e-6;
      const onLeftOrRight = Math.abs(Math.abs(p.origin.x) - HALF_W) < 1e-6;
      expect(onTopOrBottom || onLeftOrRight).toBe(true);
      // And the OTHER coord should be in-bounds.
      if (onTopOrBottom) {
        expect(Math.abs(p.origin.x)).toBeLessThanOrEqual(HALF_W + 1e-6);
      }
      if (onLeftOrRight) {
        expect(Math.abs(p.origin.y)).toBeLessThanOrEqual(HALF_H + 1e-6);
      }
    }
  });
});

describe('respawnRimParticle — velocity outward bias', () => {
  const palette = buildRimPalette('#00ffcc');

  it('a top-edge spawn carries a positive y-component (outward = +y)', () => {
    // t in [0, width) → top edge. Random direction at angle=0 (rightward
    // in-plane), elevation=0 (no z) blends with normal (0, +1, 0) at
    // weight RIM_PARTICLE_OUTWARD_BIAS=0.6:
    //   vx = 0*0.6 + 1*0.4 = 0.4
    //   vy = 1*0.6 + 0*0.4 = 0.6
    // After normalize-and-scale, vy/|v| = 0.6/sqrt(0.4²+0.6²) ≈ 0.832.
    const p = makeParticle();
    respawnRimParticle(
      p,
      WIDTH,
      HEIGHT,
      palette,
      false,
      // perimeter pick → 0 (top), angle → 0 rad, elevation → 0,
      // speed sample → 0.5, lifetime sample → 0.5, palette idx → 0.
      seq([0.0, 0.0, 0.5, 0.5, 0.5, 0]),
    );
    expect(p.velocity.y).toBeGreaterThan(0);
  });

  it('a bottom-edge spawn carries a negative y-component (outward = -y)', () => {
    // t = 0.6 * 280 = 168 → bottom edge, normal (0, -1, 0). Same draws
    // as above so the only difference is the flipped edge normal.
    const p = makeParticle();
    respawnRimParticle(p, WIDTH, HEIGHT, palette, false, seq([0.6, 0.0, 0.5, 0.5, 0.5, 0]));
    expect(p.velocity.y).toBeLessThan(0);
  });

  it('a left-edge spawn carries a negative x-component (outward = -x)', () => {
    // t = 0.85 * 280 = 238 → left edge.
    const p = makeParticle();
    respawnRimParticle(p, WIDTH, HEIGHT, palette, false, seq([0.85, 0.0, 0.5, 0.5, 0.5, 0]));
    expect(p.velocity.x).toBeLessThan(0);
  });

  it('every spawn has finite, normalized-then-scaled velocity (no NaN, no zero vector)', () => {
    const p = makeParticle();
    for (let i = 0; i < 100; i += 1) {
      respawnRimParticle(p, WIDTH, HEIGHT, palette, false);
      const len = p.velocity.length();
      expect(Number.isFinite(p.velocity.x)).toBe(true);
      expect(Number.isFinite(p.velocity.y)).toBe(true);
      expect(Number.isFinite(p.velocity.z)).toBe(true);
      // Speed must fall inside the declared range — that's the only
      // way to verify the helper isn't accidentally collapsing the
      // outward-blend vector to zero before normalization.
      expect(len).toBeGreaterThanOrEqual(RIM_PARTICLE_SPEED_MIN - 1e-6);
      expect(len).toBeLessThanOrEqual(RIM_PARTICLE_SPEED_MAX + 1e-6);
    }
  });

  it('outward-bias constant is reflected in the resulting velocity (sanity)', () => {
    // Just pin the constant in the test so a future tweak (e.g.
    // dropping bias to 0) makes its effect visible here.
    expect(RIM_PARTICLE_OUTWARD_BIAS).toBeGreaterThan(0);
    expect(RIM_PARTICLE_OUTWARD_BIAS).toBeLessThanOrEqual(1);
  });
});

describe('respawnRimParticle — lifetime + age', () => {
  const palette = buildRimPalette('#00ffcc');

  it('lifetime always lands inside [LIFETIME_MIN, LIFETIME_MAX]', () => {
    const p = makeParticle();
    for (let i = 0; i < 100; i += 1) {
      respawnRimParticle(p, WIDTH, HEIGHT, palette, false);
      expect(p.lifetime).toBeGreaterThanOrEqual(RIM_PARTICLE_LIFETIME_MIN);
      expect(p.lifetime).toBeLessThanOrEqual(RIM_PARTICLE_LIFETIME_MAX);
    }
  });

  it('stagger=false resets age to 0 (newborn at full size)', () => {
    const p = makeParticle();
    p.age = 999; // pre-poisoned
    respawnRimParticle(p, WIDTH, HEIGHT, palette, false);
    expect(p.age).toBe(0);
  });

  it('stagger=true puts age in [0, lifetime)', () => {
    const p = makeParticle();
    for (let i = 0; i < 50; i += 1) {
      respawnRimParticle(p, WIDTH, HEIGHT, palette, true);
      expect(p.age).toBeGreaterThanOrEqual(0);
      expect(p.age).toBeLessThan(p.lifetime);
    }
  });
});

describe('respawnRimParticle — color from palette', () => {
  it('picks the palette entry at index = floor(random * palette.length)', () => {
    const palette = buildRimPalette('#00ffcc');
    const p = makeParticle();
    // Perimeter pick → 0, angle → 0, elevation → 0, speed → 0,
    // lifetime → 0, palette pick → 0.99 → floor(0.99*11) = 10 (accent).
    respawnRimParticle(p, WIDTH, HEIGHT, palette, false, seq([0, 0, 0, 0, 0, 0.99]));
    expect(p.color.equals(palette[10]!)).toBe(true);
  });

  it('respects the dominant base weighting (idx 0..5 all = base color)', () => {
    const palette = buildRimPalette('#ff6ec7');
    const base = new Color('#ff6ec7');
    const p = makeParticle();
    // palette pick 0.4 → floor(0.4*11)=4 → still in base slots.
    respawnRimParticle(p, WIDTH, HEIGHT, palette, false, seq([0, 0, 0, 0, 0, 0.4]));
    expect(p.color.equals(base)).toBe(true);
  });
});
