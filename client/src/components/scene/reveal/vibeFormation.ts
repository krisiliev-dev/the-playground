/**
 * VIBE formation — choreography data for the sword reveal.
 *
 * 12 swords spell out "VIBE" mid-flight using straight strokes (one stroke
 * per sword, blocky angular font). Each sword has three keyframes:
 *   - spawn: a slot on a circle behind the camera
 *   - mid:   a stroke position in the click-cam-relative "letter plane"
 *   - end:   a slot on a circle around the click point on the wall, sunk in
 *
 * Letter coordinate system: +X right, +Y up, origin at the centre of the
 * word. Each letter is 10 units tall (matching the sword length). Stroke
 * `dir` is a unit vector pointing from hilt to tip.
 */
export type SwordVariant = 'gold_sword_0' | '4D_sword_2' | 'root_sword_3' | 'demon_blood_sword_4';

export interface SwordSlot {
  /** Stable identifier — useful as React key + for debugging. */
  id: string;
  /** Which mesh variant inside the GLTF to show. */
  variant: SwordVariant;
  /** Stroke centre in the letter plane (world units). */
  midPos: readonly [number, number];
  /** Unit vector along the stroke (hilt → tip). */
  midDir: readonly [number, number];
  /** Angle around the end circle (radians, in wall right/up plane). */
  endAngle: number;
}

/** Single shared variant for every sword — keeps the formation visually
 *  cohesive (each letter reads as one shape, the word as one statement).
 *  Swap to any of the other GLTF variants below for a different mood. */
const SHARED_VARIANT: SwordVariant = 'root_sword_3';

/** Half-height of the letter box. Matches sword `TARGET_FULL_HEIGHT / 2`. */
const HALF_H = 5;

interface RawStroke {
  /** Stroke centre. */
  mid: readonly [number, number];
  /** Unit vector from hilt to tip. */
  dir: readonly [number, number];
}

function strokeFromEndpoints(
  hilt: readonly [number, number],
  tip: readonly [number, number],
): RawStroke {
  const dx = tip[0] - hilt[0];
  const dy = tip[1] - hilt[1];
  // No defensive `|| 1` — every defined stroke has distinct
  // endpoints, and a degenerate (hilt == tip) stroke is a bug we
  // want to surface as NaN, not silently rescue.
  const len = Math.hypot(dx, dy);
  return {
    mid: [(hilt[0] + tip[0]) / 2, (hilt[1] + tip[1]) / 2],
    dir: [dx / len, dy / len],
  };
}

/** V — two diagonals meeting at the bottom centre. */
const V_STROKES: readonly RawStroke[] = [
  strokeFromEndpoints([-3, +HALF_H], [0, -HALF_H]),
  strokeFromEndpoints([+3, +HALF_H], [0, -HALF_H]),
];

/** I — single vertical, tip pointing up. */
const I_STROKES: readonly RawStroke[] = [strokeFromEndpoints([0, -HALF_H], [0, +HALF_H])];

/** B — spine + two angled "loops". Each loop is two strokes meeting at a
 *  point on the right side, giving the B its double-bump silhouette
 *  without needing curves. Top loop meets at (+2.5, +2.5); bottom loop
 *  meets at (+2.5, -2.5). */
const B_STROKES: readonly RawStroke[] = [
  // Spine.
  strokeFromEndpoints([-2.5, -HALF_H], [-2.5, +HALF_H]),
  // Top loop (two strokes meeting at +2.5, +2.5).
  strokeFromEndpoints([-2.5, +HALF_H], [+2.5, +HALF_H / 2]),
  strokeFromEndpoints([-2.5, 0], [+2.5, +HALF_H / 2]),
  // Bottom loop (two strokes meeting at +2.5, -2.5).
  strokeFromEndpoints([-2.5, 0], [+2.5, -HALF_H / 2]),
  strokeFromEndpoints([-2.5, -HALF_H], [+2.5, -HALF_H / 2]),
];

/** E — spine + 3 horizontals (mid slightly shorter, classic E). */
const E_STROKES: readonly RawStroke[] = [
  strokeFromEndpoints([-2.5, -HALF_H], [-2.5, +HALF_H]),
  strokeFromEndpoints([-2.5, +HALF_H], [+2.5, +HALF_H]),
  strokeFromEndpoints([-2.5, 0], [+1.8, 0]),
  strokeFromEndpoints([-2.5, -HALF_H], [+2.5, -HALF_H]),
];

/** Per-letter widths used for layout. I is given a small width so its
 *  flanking gaps don't squash against the neighbouring letters. */
const LETTER_WIDTHS = { V: 6, I: 1, B: 5, E: 5 } as const;
const LETTER_GAP = 4.5;
/** Rightward shift applied to all letter offsets after centering — fudge
 *  for the perceived left-bias caused by V's diagonal strokes occupying
 *  more visual area on the left and B/E having more swords clustered
 *  near their right edges. Exported so the camera director can aim its
 *  lookAt at the actual visual centre of the word. */
export const WORD_CENTERING_FUDGE = 5;

/** Compute centred X-offsets for each letter so the word straddles x = 0. */
function computeLetterOffsets(): Record<keyof typeof LETTER_WIDTHS, number> {
  const order: Array<keyof typeof LETTER_WIDTHS> = ['V', 'I', 'B', 'E'];
  const offsets = {} as Record<keyof typeof LETTER_WIDTHS, number>;
  let cursor = 0;
  for (const letter of order) {
    const w = LETTER_WIDTHS[letter];
    offsets[letter] = cursor + w / 2;
    cursor += w + LETTER_GAP;
  }
  const wordWidth = cursor - LETTER_GAP;
  const wordCentre = wordWidth / 2;
  // Subtract less than wordCentre to shift the whole word rightward by
  // WORD_CENTERING_FUDGE, compensating for the visual left-bias.
  for (const letter of order) {
    offsets[letter] -= wordCentre - WORD_CENTERING_FUDGE;
  }
  return offsets;
}

const LETTER_OFFSETS = computeLetterOffsets();

interface NamedStroke {
  id: string;
  mid: readonly [number, number];
  dir: readonly [number, number];
}

function placeStrokes(
  letter: keyof typeof LETTER_WIDTHS,
  strokes: readonly RawStroke[],
): NamedStroke[] {
  const dx = LETTER_OFFSETS[letter];
  return strokes.map((s, i) => ({
    id: `${letter}_${i}`,
    mid: [s.mid[0] + dx, s.mid[1]],
    dir: s.dir,
  }));
}

const ALL_STROKES: readonly NamedStroke[] = [
  ...placeStrokes('V', V_STROKES),
  ...placeStrokes('I', I_STROKES),
  ...placeStrokes('B', B_STROKES),
  ...placeStrokes('E', E_STROKES),
];

export const VIBE_SWORD_COUNT = ALL_STROKES.length;

/** Final formation. End angles distribute the swords evenly around the
 *  click point on the wall; spawn position is derived from the mid pose
 *  in Sword.tsx (each sword spawns far in front of the camera, at a
 *  lateral offset proportional to where it'll end up in the letter). */
export const VIBE_SLOTS: readonly SwordSlot[] = ALL_STROKES.map((s, i) => ({
  id: s.id,
  variant: SHARED_VARIANT,
  midPos: s.mid,
  midDir: s.dir,
  endAngle: (i * 2 * Math.PI) / VIBE_SWORD_COUNT,
}));
