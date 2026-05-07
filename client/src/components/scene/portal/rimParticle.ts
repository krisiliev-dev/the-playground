/**
 * Pure helpers for the portal rim's particle field. Extracted from
 * `PortalCascade` so the spawn logic can be exercised without an R3F
 * scene. The rim component owns allocation and per-frame stepping;
 * this module just defines the data shape, the per-portal palette,
 * and the in-place respawn that the rim calls each time a particle
 * reaches end-of-life.
 *
 * The "outward bias" is the load-bearing trick: a fully-random
 * direction would scatter particles equally inward and outward, so
 * about half the cloud would dissolve into the cube interior.
 * Blending the random direction with the spawn edge's outward
 * normal keeps the cloud outside the rectangle, which reads as
 * "the rim is shedding light outward."
 */
import { Color, Vector3 } from 'three';

/** Edge length of a freshly-spawned particle. The rim component
 *  scales this toward 0 by end-of-life with a quadratic falloff. */
export const RIM_PARTICLE_BASE_SIZE = 2.4;
export const RIM_PARTICLE_LIFETIME_MIN = 0.5;
export const RIM_PARTICLE_LIFETIME_MAX = 1.3;
export const RIM_PARTICLE_SPEED_MIN = 4;
export const RIM_PARTICLE_SPEED_MAX = 9;
/** Outward bias: 0 = fully random direction, 1 = strictly along the
 *  spawn edge's outward normal. 0.6 reads as "scattering outward"
 *  while still letting some particles drift along the rim. */
export const RIM_PARTICLE_OUTWARD_BIAS = 0.6;

/** Which of a portal rectangle's 4 edges are allowed to spawn
 *  particles. Formation portals (the 2x2 cluster on the formation
 *  wall) only spawn on their *outer* edges so the inter-portal gaps
 *  stay clean of particle clutter; standalone portals spawn on all
 *  four edges by default. */
export interface RimEdgeMask {
  readonly top: boolean;
  readonly right: boolean;
  readonly bottom: boolean;
  readonly left: boolean;
}

/** Default mask — every edge active. Pure helper so the factory and
 *  tests have a canonical "all edges" value without re-creating
 *  object literals. */
export const RIM_ALL_EDGES: RimEdgeMask = {
  top: true,
  right: true,
  bottom: true,
  left: true,
};

export interface RimParticle {
  /** Spawn position in the rim's local frame. */
  readonly origin: Vector3;
  /** Outward velocity (units/sec) — fixed at spawn, drift =
   *  `origin + velocity * age`. */
  readonly velocity: Vector3;
  /** Color picked from the rim's per-portal palette. */
  readonly color: Color;
  age: number;
  lifetime: number;
}

/** Build the per-portal color palette from the rim's base color.
 *  Mostly the base color (six slots), with two lighter variants,
 *  two whites, and one complementary-hue accent — eleven slots
 *  total. The duplication is the weighting mechanism: a uniform
 *  index pick lands on the base color ~55% of the time. */
export function buildRimPalette(rimColor: string): Color[] {
  const base = new Color(rimColor);
  const light = base.clone().lerp(new Color('#ffffff'), 0.55);
  const white = new Color('#ffffff');
  const hsl = { h: 0, s: 0, l: 0 };
  base.getHSL(hsl);
  const accent = new Color().setHSL((hsl.h + 0.5) % 1, hsl.s, hsl.l);
  return [base, base, base, base, base, base, light, light, white, white, accent];
}

/**
 * Pick a fresh spawn position on the rectangle perimeter, an
 * outward-biased random velocity, a random lifetime, and a palette
 * color. Mutates `p` in-place — zero allocation.
 *
 * When `stagger` is true, the particle's initial age is randomized
 * within its lifetime so the first frame after pool construction
 * already looks like a steady-state cloud rather than a synchronized
 * burst at full size.
 *
 * `edges` restricts which edges of the rectangle are allowed to
 * spawn — defaults to all four. Disabled edges contribute zero
 * length to the perimeter walk, so the random pick is uniformly
 * distributed across only the enabled edges.
 *
 * The `random` parameter defaults to `Math.random` and exists so
 * tests can pass a deterministic generator and pin spawn positions /
 * velocities exactly.
 *
 * If `edges` has no enabled edges, falls back to all 4 edges — the
 * caller almost certainly meant the default but we don't want a
 * silently zero-length perimeter to NaN out the whole pool.
 */
export function respawnRimParticle(
  p: RimParticle,
  width: number,
  height: number,
  palette: ReadonlyArray<Color>,
  stagger: boolean,
  random: () => number = Math.random,
  edges: RimEdgeMask = RIM_ALL_EDGES,
): void {
  const halfW = width / 2;
  const halfH = height / 2;
  const effective = edgesOrDefault(edges);

  // Each edge contributes its own length to the active perimeter,
  // gated by the mask. Walking the random `t` across only the
  // enabled segments keeps the spawn distribution uniform across
  // whichever edges are turned on.
  const lengths = {
    top: effective.top ? width : 0,
    right: effective.right ? height : 0,
    bottom: effective.bottom ? width : 0,
    left: effective.left ? height : 0,
  };
  const perimeter = lengths.top + lengths.right + lengths.bottom + lengths.left;
  const t = random() * perimeter;

  let edgeNormalX = 0;
  let edgeNormalY = 0;
  if (t < lengths.top) {
    p.origin.set(-halfW + t, halfH, 0);
    edgeNormalY = 1;
  } else if (t < lengths.top + lengths.right) {
    const u = t - lengths.top;
    p.origin.set(halfW, halfH - u, 0);
    edgeNormalX = 1;
  } else if (t < lengths.top + lengths.right + lengths.bottom) {
    const u = t - lengths.top - lengths.right;
    p.origin.set(halfW - u, -halfH, 0);
    edgeNormalY = -1;
  } else {
    const u = t - lengths.top - lengths.right - lengths.bottom;
    p.origin.set(-halfW, -halfH + u, 0);
    edgeNormalX = -1;
  }

  // Random direction in 3D, mostly in-plane with a small z component.
  const angle = random() * Math.PI * 2;
  const elevation = (random() - 0.5) * 0.6;
  const cosE = Math.cos(elevation);
  const dirX = Math.cos(angle) * cosE;
  const dirY = Math.sin(angle) * cosE;
  const dirZ = Math.sin(elevation);

  // Blend with the spawn edge's outward normal so most particles
  // visibly flee the rim instead of slipping along it.
  const blend = RIM_PARTICLE_OUTWARD_BIAS;
  const inv = 1 - blend;
  const vx = edgeNormalX * blend + dirX * inv;
  const vy = edgeNormalY * blend + dirY * inv;
  const vz = dirZ * inv;
  const speed =
    RIM_PARTICLE_SPEED_MIN + random() * (RIM_PARTICLE_SPEED_MAX - RIM_PARTICLE_SPEED_MIN);
  p.velocity.set(vx, vy, vz).normalize().multiplyScalar(speed);

  p.lifetime =
    RIM_PARTICLE_LIFETIME_MIN + random() * (RIM_PARTICLE_LIFETIME_MAX - RIM_PARTICLE_LIFETIME_MIN);
  p.age = stagger ? random() * p.lifetime : 0;

  const idx = Math.floor(random() * palette.length);
  const picked = palette[idx]!;
  p.color.copy(picked);
}

/** Defensive fallback: a mask with all 4 edges off would collapse
 *  the perimeter to 0 and produce NaN positions. Treat that as a
 *  caller error and fall back to all-edges so the pool keeps
 *  rendering rather than silently exploding. */
function edgesOrDefault(edges: RimEdgeMask): RimEdgeMask {
  if (!edges.top && !edges.right && !edges.bottom && !edges.left) {
    return RIM_ALL_EDGES;
  }
  return edges;
}
