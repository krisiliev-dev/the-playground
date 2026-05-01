/**
 * Sfx manifest — every sound the app plays through SfxManager.
 *
 * Each entry can list multiple `variants`; SfxManager picks one at
 * random per `play()` call so repeated cues don't sound identical.
 *
 * Per-cue knobs:
 *   - `volume`: cue gain multiplier
 *   - `loop`: sustained beds (cube ambient, wind, sword flying)
 *   - `maxDurationMs`: hard cap so cascading tails don't smear
 *   - `playbackRate`: fixed pitch shift
 *   - `spatial`: PannerNode config — refDistance, rolloffFactor
 *   - `reverb.wet`: how much of the cue feeds the shared cube-room
 *     ConvolverNode (0 = dry, 1 = pure wet)
 */

export interface SfxEntry {
  /** One or more file URLs under `/audio/...`. SfxManager picks one at
   *  random per `play()` call. */
  variants: readonly string[];
  /** Per-cue gain (0..1). Multiplies with the master gain. */
  volume?: number;
  /** True for sustained beds (cube ambient, room tone). */
  loop?: boolean;
  /** Hard upper bound on playback length in ms. SfxManager applies a
   *  short fade-out before stopping so the cut isn't audible. Useful
   *  when source files have long reverb tails that overlap and smear
   *  together when many copies cascade (e.g. 12 sword slams within
   *  500ms, each with a 5s tail, would otherwise become one wash). */
  maxDurationMs?: number;
  /** Fixed pitch shift applied via `AudioBufferSourceNode.playbackRate`
   *  at start time (1.0 = original, 2.0 = octave up, 0.5 = octave
   *  down). Combines multiplicatively with `pitchJitter` if both are
   *  set. Useful when a sample is pitched off from the desired key
   *  but otherwise the right texture. */
  playbackRate?: number;
  /** Spatial-audio config. When `play({ position })` is called on this
   *  cue, a PannerNode is inserted in the chain and configured from
   *  these values. Distances are in world units (same scale as the
   *  cube dimensions). */
  spatial?: {
    /** Distance at which gain = 1.0. Closer than this stays at 1.0. */
    refDistance?: number;
    /** Distance beyond which no further attenuation. */
    maxDistance?: number;
    /** How aggressively gain falls off with distance (1.0 = inverse). */
    rolloffFactor?: number;
  };
  /** Cube-room reverb config. The cue is split into a dry path
   *  (straight to master) and a wet path (through the shared
   *  ConvolverNode whose IR models the cube's wall reflections + decay
   *  tail). `wet=0` disables reverb for this cue. Cues that already
   *  represent ambient sound (wind, drones) should stay at 0; point
   *  sources (clicks, slams, swords) feel more alive at 0.3–0.5. */
  reverb?: {
    /** Wet send level (0..1). 0 = pure dry. 1 = pure wet. */
    wet?: number;
  };
  /** Standard audio-engineering effects, applied per-cue between gain
   *  and panner. All native Web Audio nodes — no external library
   *  needed. Order in chain: gain → compressor → saturator → filter
   *  → panner. */
  effects?: {
    /** DynamicsCompressorNode — squeezes peaks down so transients hit
     *  harder relative to the average level. Pass `true` for an
     *  aggressive impact-cue preset, or an object to tune. */
    compress?:
      | boolean
      | {
          /** dB threshold above which compression kicks in. */
          threshold?: number;
          /** Compression ratio (1 = none, 8 = aggressive, ∞ = limit). */
          ratio?: number;
          /** Time in seconds to react to a peak. */
          attack?: number;
          /** Time in seconds to release the gain reduction. */
          release?: number;
          /** dB knee width for soft compression around the threshold. */
          knee?: number;
        };
    /** WaveShaperNode soft saturation amount (0..1). Adds harmonic
     *  content + warmth — useful for making impacts feel weightier
     *  without just turning up the volume. */
    saturate?: number;
    /** BiquadFilterNode for tone shaping. Per-fire random gain can
     *  be passed via `playOpts.filterGain` to vary timbre per hit
     *  (e.g. one slam bright, one dark) — that's how cascading
     *  impacts read as 12 distinct events instead of 12 takes of
     *  the same sample. */
    filter?: {
      /** Filter type. 'highshelf' boosts/cuts above frequency,
       *  'lowshelf' below, 'peaking' around it. */
      type?: 'highshelf' | 'lowshelf' | 'peaking';
      /** Centre frequency in Hz. */
      freq?: number;
      /** Static dB gain — overridden by `playOpts.filterGain` if
       *  provided. */
      gain?: number;
      /** Q factor for peaking filters (sharpness). */
      q?: number;
    };
  };
}

export const SFX = {
  /** Wall-proximity ambient — low electrical drone that fades in as
   *  the avatar approaches a cube wall and back to silence when they
   *  retreat to the centre. CursorAvatar drives the volume each frame
   *  via `sfx.setLoopVolume('wallAmbient', v)`. The loop is started
   *  the first frame the avatar enters the proximity zone. */
  wallAmbient: {
    variants: ['/audio/ambient/cube-drone.flac'],
    volume: 0.5,
    loop: true,
  },
  /** Avatar-mode transition cue — fires the moment the cursor turns
   *  into a 3rd-person avatar (controls hint dismissed). */
  uiClick: {
    variants: ['/audio/ui/click.wav'],
    volume: 0.4,
    reverb: { wet: 0.12 },
  },
  /** Mouse-button-down cue — fires globally on every mousedown, so
   *  the user gets immediate audio feedback the instant they press.
   *  Paired with `mouseUp` (fires on release) for a complete two-part
   *  click sound design. The first mousedown also serves as the
   *  audio-unlock gesture for Safari. */
  mouseDown: {
    variants: ['/audio/cursor/mouse_down.wav'],
    volume: 0.9,
    reverb: { wet: 0.15 },
  },
  /** Mouse-button-up cue — fires on every mouseup, completing the
   *  click pair. Slightly different timbre from mouseDown for
   *  natural press-release contrast. */
  mouseUp: {
    variants: ['/audio/cursor/mouse_up.wav'],
    volume: 0.9,
    reverb: { wet: 0.15 },
  },
  /** Per-sword spawn — a distinct sound per sword (11 fired in
   *  staggered cascade) so the moment of materialisation reads as 11
   *  individual events stacking up rather than one ramp. Spatial:
   *  emits from each sword's spawn point. Big refDistance + gentle
   *  rolloff so spawns 80 world units in front of the camera (the
   *  default spawn depth) still play near full volume. Volume bumped
   *  to 1.6 because the source file's mean level is -24 dB — even at
   *  full panner gain it sat under the swordFlying loop. maxDuration
   *  extended to 400 ms so the body of the spawn (which has a slow
   *  attack) actually plays before the cap cuts it off. */
  spawnFlash: {
    variants: ['/audio/sword/spawn.wav'],
    volume: 2.5,
    maxDurationMs: 500,
    spatial: { refDistance: 100, rolloffFactor: 0.4, maxDistance: 500 },
    reverb: { wet: 0.12 },
  },
  /** Per-sword flying loop — a flat whoosh that plays the entire
   *  duration each sword is in flight. Per-sword positional loop with
   *  panner.position tracking the sword's mesh each frame; on top of
   *  the panner's distance attenuation, Sword.tsx drives setVolume +
   *  setPlaybackRate from the sword's per-frame velocity, so faster
   *  passes are louder + slightly higher-pitched (Doppler-style). 11
   *  simultaneous instances are fine — each gets its own panner. */
  swordFlying: {
    variants: ['/audio/sword/flying.wav'],
    volume: 0.5,
    loop: true,
    spatial: { refDistance: 30, rolloffFactor: 1.6, maxDistance: 400 },
    reverb: { wet: 0.1 },
  },
  /** Layered low-frequency boom played at the moment of wall slam.
   *  Spatial: emits from the click hit point. Heavy wet so the rumble
   *  fills the cube. Compression glues the low-end transient. */
  impactRumble: {
    variants: ['/audio/impact/rumble-low.wav'],
    volume: 0.8,
    spatial: { refDistance: 12, rolloffFactor: 0.6 },
    reverb: { wet: 0.28 },
    effects: {
      compress: { threshold: -22, ratio: 6, attack: 0.002, release: 0.15 },
    },
  },
  /** Per-sword slam — single source variant, pitch-jittered ±60% per
   *  fire (Sword.tsx widens this further on velocity) so the 11
   *  cascading hits land at noticeably different fundamental
   *  frequencies. Short cap (180ms) so each slam is gone before the
   *  next 6 fire on top of it; with a 50ms stagger, this means at
   *  most ~4 slams overlap instead of all 11. Reverb wet kept low
   *  (0.10) for the same reason — the convolver was previously
   *  receiving 11 cumulative wet sends and smearing the cascade into
   *  a single wash. Spatial position is jittered ±3 units around the
   *  wall hit point in Sword.tsx so each slam pans to a slightly
   *  different stereo location. */
  swordSlam: {
    variants: ['/audio/impact/slam.wav'],
    volume: 1.15,
    maxDurationMs: 180,
    spatial: { refDistance: 10, rolloffFactor: 0.8 },
    reverb: { wet: 0.1 },
    effects: {
      compress: { threshold: -18, ratio: 10, attack: 0.001, release: 0.08 },
      saturate: 0.35,
      // High-shelf filter at 3 kHz with per-fire random gain (driven
      // by Sword.tsx via playOpts.filterGain) — half the slams get a
      // brightness boost, the other half a cut, so the cascade has
      // timbral variation on top of pitch jitter. The slam.wav is
      // low-end heavy; without this, all 12 hits sit in the same
      // frequency band and the ear can't separate them.
      filter: { type: 'highshelf', freq: 3000, gain: 0 },
    },
  },
  /** Cursor-movement wind — constant wind whoosh loop while any WASD
   *  key is held. Reads as "thing in motion through space" rather
   *  than the chiptune waka we tried first. Source is a 7-min field
   *  recording (Sonniss/Hzandbits "Wind In Trees"); we trimmed an 11s
   *  middle chunk and built a 10s seamless loop where the first 1s is
   *  a crossfade seam (head fade-in summed with tail fade-out) and
   *  the remaining 9s is the unmodified middle. The loop boundary is
   *  sample-continuous because end-of-output = start-of-output =
   *  chunk[10s mark]. Stored as FLAC (not MP3) because MP3 encoders
   *  bake ~26ms of priming/padding silence into the decoded buffer,
   *  which becomes an audible gap on every loop boundary; FLAC is
   *  gapless. CursorAvatar starts/stops based on aggregate WASD key
   *  state. */
  cursorMove: {
    variants: ['/audio/cursor/wind.flac'],
    volume: 0.7,
    loop: true,
  },
} as const satisfies Record<string, SfxEntry>;

export type SfxId = keyof typeof SFX;
