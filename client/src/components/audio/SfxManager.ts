/**
 * SfxManager — Web Audio API singleton.
 *
 * Why Web Audio over `<audio>` elements:
 * - One decoded `AudioBuffer` per file, replayed via cheap source nodes,
 *   so overlapping plays of the same cue don't fight for a single
 *   element's playback head (HTMLAudioElement is single-instance).
 * - Cheap to randomize playback rate per fire (pitch jitter) without
 *   touching the original buffer.
 * - Browsers gate AudioContext behind a user gesture; we lazily resume
 *   it on the first `play()` call (which is always inside the reveal
 *   click handler).
 *
 * Routing graph:
 *
 *   per cue:  source → cueGain → [panner if spatial] → splitPoint
 *                                                        ↓
 *                                          ┌─ dryGain ───┘
 *                                          └─ wetGain → cubeReverb
 *   masterGain ←┐ ←┐
 *               │  └── cubeReverb (shared ConvolverNode, IR modeled
 *               │      from the cube dimensions: direct + first/second
 *               │      order wall reflections + diffuse decay tail)
 *               └── dryGain (per cue)
 *   masterGain → ctx.destination
 *
 * Per-cue `reverb: { wet }` controls how much of that cue's signal goes
 * to the room vs. straight to dry. The convolver itself is shared so
 * 12 swords flying simultaneously all reverb through the same room.
 *
 * Looped cues (cube ambient) keep their source node + gain node so we
 * can stop them later with `stop(id)`. Per-instance positional loops
 * (sword flying audio) get a `PositionalLoopHandle` instead.
 */
import { SFX, type SfxEntry, type SfxId } from './sfxManifest';

interface PlayOpts {
  /** Multiplied with the cue's manifest volume (0..1+). */
  volumeMultiplier?: number;
  /** Random pitch jitter range — actual rate = 1 ± jitter*0.5.
   *  e.g. 0.1 → playbackRate sampled from [0.95, 1.05]. */
  pitchJitter?: number;
  /** World-space position. When provided, a PannerNode is inserted
   *  between the source and the master gain, and the cue's manifest
   *  `spatial` config drives distance attenuation. The listener pose
   *  is updated each frame by `SpatialAudioListener` to match the
   *  camera. */
  position?: { x: number; y: number; z: number };
  /** Per-fire override for the manifest's `effects.filter.gain` (dB).
   *  Used to randomize EQ per fire on cascading cues (e.g. each
   *  swordSlam gets a different high-shelf gain so 12 hits don't
   *  share the same timbre). No-op if the cue has no filter config. */
  filterGain?: number;
}

interface LoopHandle {
  source: AudioBufferSourceNode;
  gain: GainNode;
}

/** Handle for a per-instance positional loop (e.g. each sword's
 *  flying-whoosh). Unlike `play()` for loops which is keyed by SfxId
 *  (one per id), this returns a fresh handle every call so 12 swords
 *  can each have their own moving emitter. */
export interface PositionalLoopHandle {
  /** Move the emitter to a new world-space position. Called each frame
   *  by the owning component to track its mesh. */
  setPosition(x: number, y: number, z: number): void;
  /** Adjust this instance's volume multiplier in real time. Multiplies
   *  with the cue's manifest volume. */
  setVolume(v: number): void;
  /** Adjust this instance's pitch in real time. 1.0 = original,
   *  2.0 = octave up, 0.5 = octave down. Useful for velocity-driven
   *  Doppler-style effects: faster movement → higher pitch. */
  setPlaybackRate(rate: number): void;
  /** Stop the loop. Optional fade-out (ms) avoids a hard cut. */
  stop(fadeMs?: number): void;
}

const DEFAULT_ROOM_SIZE = 80;
/** Speed of sound in m/s — used to compute first-reflection delay
 *  from the cube's edge length. */
const SOUND_SPEED = 343;
/** Cap the audio-room edge length (in world units) used for the IR.
 *  The world cube is 800 units across; literal physics give a 2.3 s
 *  first reflection, which the ear hears as a separate echo, not room
 *  ambience. Clamping to 15 yields ~87 ms first reflection — well
 *  inside the "fused with source" perceptual window for indoor
 *  reverb. The cube still *looks* huge; only the audio's room model
 *  is scaled. */
const MAX_AUDIO_ROOM_SIZE = 15;

class SfxManager {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  /** Shared convolver applying cube room acoustics (direct + early
   *  reflections + diffuse decay) to every cue with `reverb.wet > 0`.
   *  Buffer is regenerated when `setRoomSize` is called. */
  private cubeReverb: ConvolverNode | null = null;
  private roomSize = DEFAULT_ROOM_SIZE;
  /** iOS silent-switch workaround. iOS routes Web Audio through the
   *  same audio category as the ringer/notification stream, which
   *  the side mute switch silences — even when the AudioContext
   *  reports `running`. Playing a continuously-looping HTMLAudio
   *  element shifts the page into the "media playback" category,
   *  which respects the volume buttons and ignores the silent
   *  switch. The audio itself is silent (volume 0) so it has no
   *  effect on what the user hears; the *act* of the element being
   *  in a playing state is what matters to iOS. */
  private silenceUnlockAudio: HTMLAudioElement | null = null;
  /** Decoded buffers per cue id. */
  private readonly buffers = new Map<SfxId, AudioBuffer[]>();
  /** Active singleton-loop sources per cue id, so we can stop them. */
  private readonly loops = new Map<SfxId, LoopHandle>();
  /** True after the first `play()` call decoded everything. */
  private loaded = false;
  /** Promise of the in-flight load, if any, so concurrent `play()` calls
   *  await the same load instead of triggering N parallel fetches. */
  private loadPromise: Promise<void> | null = null;

  /** Lazy: create the AudioContext + decode all buffers. Browsers
   *  require this to be inside a user gesture, so we defer until the
   *  first explicit `play()`. */
  private async ensureLoaded(): Promise<void> {
    if (this.loaded) {
      return;
    }
    if (this.loadPromise) {
      return this.loadPromise;
    }
    this.loadPromise = this.load();
    return this.loadPromise;
  }

  private async load(): Promise<void> {
    // ctx may have already been created by `unlock()` (the
    // synchronous-from-gesture path that Safari requires). If not,
    // try to create it here too — for non-Safari paths where the
    // first `play()` happens in code without going through unlock().
    if (!this.ctx) {
      this.unlock();
    }
    if (!this.ctx) {
      // unlock() short-circuits in test/jsdom; mark loaded so play()
      // calls become no-ops.
      this.loaded = true;
      return;
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume().catch(() => {
        /* expected when called from preload (no gesture) */
      });
    }

    const ctx = this.ctx;
    // Decode every variant of every cue in parallel. allSettled so a
    // missing/0-byte/undecodable file silently drops out instead of
    // poisoning every other cue — useful when a single asset 404s in
    // dev or hasn't finished syncing yet.
    const tasks: Array<Promise<{ id: SfxId; buffer: AudioBuffer; src: string }>> = [];
    (Object.entries(SFX) as Array<[SfxId, SfxEntry]>).forEach(([id, entry]) => {
      entry.variants.forEach((src) => {
        tasks.push(
          fetch(src)
            .then((res) => {
              if (!res.ok) {
                throw new Error(`fetch ${src}: ${res.status}`);
              }
              return res.arrayBuffer();
            })
            .then((arr) => ctx.decodeAudioData(arr))
            .then((buffer) => ({ id, buffer, src })),
        );
      });
    });

    const results = await Promise.allSettled(tasks);
    results.forEach((r) => {
      if (r.status === 'fulfilled') {
        const arr = this.buffers.get(r.value.id) ?? [];
        arr.push(r.value.buffer);
        this.buffers.set(r.value.id, arr);
      } else {
        // eslint-disable-next-line no-console
        console.warn('[sfx] failed to load variant:', r.reason);
      }
    });
    this.loaded = true;
  }

  /** Synthesize an impulse response that models a cube room of the given
   *  edge length. Comprises:
   *   - A direct-sound spike at t=0
   *   - First-order wall reflections clustered around 2L/c (sound's
   *     round-trip time across the cube), with small per-tap jitter so
   *     the cluster reads as a "wash" rather than a ringing comb filter
   *   - Second-order reflections at twice that delay
   *   - A diffuse decaying-noise tail
   *  Stereo channels get independent randomisation for natural width.
   *  `sideLength` is clamped to `MAX_AUDIO_ROOM_SIZE` so the world's
   *  visual scale doesn't translate into multi-second echo delays.
   *
   *  RNG is seeded from `sideLength + sampleRate + channel` (mulberry32)
   *  so the same room always yields the same IR — reverb stays stable
   *  reload-to-reload, and tests can pin sample values. The two
   *  channels still get independent seeds for natural stereo width. */
  private makeCubeImpulseResponse(ctx: AudioContext, sideLength: number): AudioBuffer {
    const sr = ctx.sampleRate;
    const audioSize = Math.min(sideLength, MAX_AUDIO_ROOM_SIZE);
    const firstReflectDelay = (2 * audioSize) / SOUND_SPEED;
    // Total IR length: long enough to capture two wall round-trips plus
    // a ~1.5s diffuse tail.
    const decayTime = Math.max(2.0, firstReflectDelay * 2 + 1.5);
    const length = Math.floor(sr * decayTime);
    const buf = ctx.createBuffer(2, length, sr);

    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      // Per-channel seed: `sideLength * 1000` quantises sub-unit room
      // changes, sampleRate disambiguates 44.1k vs 48k contexts, channel
      // index gives left/right independent decorrelation.
      const rand = mulberry32((Math.floor(sideLength * 1000) ^ sr) + ch * 2654435761);

      // Direct sound (impulse at t=0).
      data[0] = 1.0;

      // First-order: 6 wall reflections with small time/amplitude jitter.
      for (let i = 0; i < 6; i++) {
        const jitter = (rand() - 0.5) * 0.04;
        const idx = Math.floor((firstReflectDelay + jitter) * sr);
        if (idx >= 0 && idx < length) {
          data[idx] = (data[idx] ?? 0) + 0.45 * (0.8 + rand() * 0.4);
        }
      }

      // Second-order: more taps, lower amplitude, wider time spread.
      for (let i = 0; i < 18; i++) {
        const jitter = (rand() - 0.5) * 0.08;
        const idx = Math.floor((2 * firstReflectDelay + jitter) * sr);
        if (idx >= 0 && idx < length) {
          data[idx] = (data[idx] ?? 0) + 0.18 * (0.8 + rand() * 0.4);
        }
      }

      // Diffuse tail from first reflection onward — exponential decay
      // on white noise. Decay constant tuned so the tail is mostly gone
      // by `decayTime`.
      const diffuseStart = Math.floor(firstReflectDelay * sr);
      for (let i = diffuseStart; i < length; i++) {
        const tSec = (i - diffuseStart) / sr;
        const env = Math.exp(-tSec * 1.5);
        data[i] = (data[i] ?? 0) + (rand() * 2 - 1) * env * 0.15;
      }
    }
    return buf;
  }

  /** Connect an end-of-chain node to master, splitting into dry and
   *  wet sends if the cue's manifest has `reverb.wet > 0`. Returns the
   *  per-instance dry/wet gain nodes (for cleanup) so callers can
   *  disconnect them when the source ends. */
  private connectToOutput(finalNode: AudioNode, entry: SfxEntry): AudioNode[] {
    const extraNodes: AudioNode[] = [];
    if (!this.ctx || !this.masterGain) {
      return extraNodes;
    }
    const wet = entry.reverb?.wet ?? 0;
    if (wet <= 0 || !this.cubeReverb) {
      finalNode.connect(this.masterGain);
      return extraNodes;
    }
    if (wet >= 1) {
      finalNode.connect(this.cubeReverb);
      return extraNodes;
    }
    const dryGain = this.ctx.createGain();
    dryGain.gain.value = 1 - wet;
    const wetGain = this.ctx.createGain();
    wetGain.gain.value = wet;
    finalNode.connect(dryGain).connect(this.masterGain);
    finalNode.connect(wetGain).connect(this.cubeReverb);
    extraNodes.push(dryGain, wetGain);
    return extraNodes;
  }

  /** Build the source + gain + effects + optional panner chain for a
   *  cue. Returns the nodes so callers (one-shot or loop) can wire
   *  start/stop + cleanup in their own way. Effect chain (when
   *  configured): source → gain → [compressor] → [saturator] → [panner]. */
  private buildSourceChain(
    id: SfxId,
    opts: PlayOpts,
  ): {
    source: AudioBufferSourceNode;
    gain: GainNode;
    panner: PannerNode | null;
    entry: SfxEntry;
    finalNode: AudioNode;
    effectNodes: AudioNode[];
  } | null {
    const ctx = this.ctx;
    if (!ctx) {
      return null;
    }
    const variants = this.buffers.get(id);
    if (!variants || variants.length === 0) {
      return null;
    }
    const buffer = variants[Math.floor(Math.random() * variants.length)];
    if (!buffer) {
      return null;
    }
    const entry: SfxEntry = SFX[id];

    const source = ctx.createBufferSource();
    source.buffer = buffer;

    const gain = ctx.createGain();
    gain.gain.value = (entry.volume ?? 1) * (opts.volumeMultiplier ?? 1);

    const baseRate = entry.playbackRate ?? 1;
    const jitter = opts.pitchJitter ?? 0;
    if (baseRate !== 1 || jitter > 0) {
      source.playbackRate.value = baseRate * (1 + (Math.random() - 0.5) * jitter);
    }

    source.connect(gain);

    // Effect chain — sits between gain and the spatial / output stage.
    let chainTail: AudioNode = gain;
    const effectNodes: AudioNode[] = [];
    if (entry.effects?.compress) {
      const cfg = typeof entry.effects.compress === 'object' ? entry.effects.compress : {};
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = cfg.threshold ?? -20;
      comp.ratio.value = cfg.ratio ?? 8;
      comp.attack.value = cfg.attack ?? 0.001;
      comp.release.value = cfg.release ?? 0.1;
      comp.knee.value = cfg.knee ?? 6;
      chainTail.connect(comp);
      chainTail = comp;
      effectNodes.push(comp);
    }
    if (entry.effects?.saturate !== undefined && entry.effects.saturate > 0) {
      const ws = ctx.createWaveShaper();
      ws.curve = makeSaturationCurve(entry.effects.saturate);
      ws.oversample = '2x';
      chainTail.connect(ws);
      chainTail = ws;
      effectNodes.push(ws);
    }
    if (entry.effects?.filter) {
      const fcfg = entry.effects.filter;
      const filter = ctx.createBiquadFilter();
      filter.type = fcfg.type ?? 'peaking';
      filter.frequency.value = fcfg.freq ?? 1000;
      // Per-fire override beats the manifest's static value — that's
      // how cascading cues randomize their timbre per hit.
      filter.gain.value = opts.filterGain ?? fcfg.gain ?? 0;
      filter.Q.value = fcfg.q ?? 1;
      chainTail.connect(filter);
      chainTail = filter;
      effectNodes.push(filter);
    }

    let panner: PannerNode | null = null;
    let finalNode: AudioNode = chainTail;
    if (opts.position) {
      panner = ctx.createPanner();
      panner.panningModel = 'HRTF';
      panner.distanceModel = 'inverse';
      panner.refDistance = entry.spatial?.refDistance ?? 5;
      panner.maxDistance = entry.spatial?.maxDistance ?? 100;
      panner.rolloffFactor = entry.spatial?.rolloffFactor ?? 1;
      const t = ctx.currentTime;
      panner.positionX.setValueAtTime(opts.position.x, t);
      panner.positionY.setValueAtTime(opts.position.y, t);
      panner.positionZ.setValueAtTime(opts.position.z, t);
      chainTail.connect(panner);
      finalNode = panner;
    }

    return { source, gain, panner, entry, finalNode, effectNodes };
  }

  /** Play a one-shot or start a singleton loop. Variants are randomized;
   *  loops pick the first-fired variant and remember the source so
   *  `stop()` can end them. Call this from inside a user-gesture
   *  callback the first time so the AudioContext is allowed to start.
   *
   *  All errors are caught and logged — audio failures must never
   *  propagate into the calling component (e.g. an effect handler that
   *  also drives gameplay state). The whole chain (load → decode →
   *  connect → start) is wrapped so any failure surfaces as a console
   *  error pointing at the cue id, which is what we need to diagnose
   *  the rare WebGL-context-loss-coupled audio failures. */
  async play(id: SfxId, opts: PlayOpts = {}): Promise<void> {
    // SYNCHRONOUS resume path — must run before any await, otherwise
    // we exit Safari's user-gesture window. If the ctx already exists
    // (e.g. preload ran), kick a resume immediately. The async branch
    // below also retries after ensureLoaded for the first-call case
    // where ctx is created inside ensureLoaded itself.
    if (this.ctx?.state === 'suspended') {
      void this.ctx.resume();
    }
    try {
      await this.ensureLoaded();
      const ctx = this.ctx;
      if (!ctx || !this.masterGain) {
        return;
      }
      // Async resume retry — covers the case where ctx was just
      // created by ensureLoaded() and the synchronous resume above
      // saw a null ctx. Safari still accepts this because we're
      // already inside the gesture-handler microtask chain.
      if (ctx.state === 'suspended') {
        try {
          await ctx.resume();
        } catch {
          /* still no gesture; subsequent plays will retry */
        }
      }
      // Loop cues: only one instance at a time. Re-calling play() while
      // already playing is a no-op so callers don't have to track state.
      const entryPreview: SfxEntry = SFX[id];
      if (entryPreview.loop && this.loops.has(id)) {
        return;
      }

      const built = this.buildSourceChain(id, opts);
      if (!built) {
        // eslint-disable-next-line no-console
        console.warn('[sfx] play skipped: no source chain for', id);
        return;
      }
      const { source, gain, panner, entry, finalNode, effectNodes } = built;
      const extraNodes = this.connectToOutput(finalNode, entry);

      if (entry.loop) {
        source.loop = true;
        this.loops.set(id, { source, gain });
      } else {
        source.onended = (): void => {
          gain.disconnect();
          effectNodes.forEach((n) => n.disconnect());
          panner?.disconnect();
          extraNodes.forEach((n) => n.disconnect());
        };
      }

      source.start();

      // Optional hard duration cap: schedule a quick gain ramp to 0
      // then stop the source. Used to keep cues with long reverb tails
      // (sword slams, spawn flashes) from overlapping into a single
      // smeared wash when many copies cascade.
      if (!entry.loop && entry.maxDurationMs && entry.maxDurationMs > 0) {
        const now = ctx.currentTime;
        const cutoff = now + entry.maxDurationMs / 1000;
        const fadeStart = Math.max(now, cutoff - 0.04);
        gain.gain.setValueAtTime(gain.gain.value, fadeStart);
        gain.gain.linearRampToValueAtTime(0, cutoff);
        source.stop(cutoff);
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[sfx] play failed for', id, e);
    }
  }

  /** Start a per-instance positional loop. Returns a handle whose
   *  `setPosition` is meant to be called every frame so the panner
   *  follows a moving emitter (e.g. each sword's mesh during flight).
   *  Unlike `play()` for loops which is keyed by id (one per id), this
   *  creates a fresh source+gain+panner each call, so 12 instances can
   *  run side by side. */
  playPositionalLoop(
    id: SfxId,
    position: { x: number; y: number; z: number },
    opts: PlayOpts = {},
  ): PositionalLoopHandle {
    const state = {
      pos: { x: position.x, y: position.y, z: position.z },
      volumeMul: opts.volumeMultiplier ?? 1,
      stopped: false,
      nodes: null as null | {
        source: AudioBufferSourceNode;
        gain: GainNode;
        panner: PannerNode;
        extras: AudioNode[];
      },
    };

    void this.ensureLoaded()
      .then(async () => {
        if (state.stopped || !this.ctx || !this.masterGain) {
          return;
        }
        // Same resume retry as in `play()` — the loop is started from
        // a user-gesture path (sword spawn during reveal), so this
        // catches the case where preload-time resume() didn't take.
        if (this.ctx.state === 'suspended') {
          try {
            await this.ctx.resume();
          } catch {
            /* fall through; source.start() will be silent until
               another user gesture triggers a resume */
          }
        }
        if (state.stopped) {
          return;
        }
        const built = this.buildSourceChain(id, {
          ...opts,
          volumeMultiplier: state.volumeMul,
          position: state.pos,
        });
        if (!built || !built.panner) {
          // eslint-disable-next-line no-console
          console.warn('[sfx] playPositionalLoop skipped: no source chain for', id);
          return;
        }
        const { source, gain, panner, entry, finalNode, effectNodes } = built;
        source.loop = true;
        const outputExtras = this.connectToOutput(finalNode, entry);
        source.start();
        state.nodes = {
          source,
          gain,
          panner,
          extras: [...effectNodes, ...outputExtras],
        };
      })
      .catch((e: unknown) => {
        // eslint-disable-next-line no-console
        console.error('[sfx] playPositionalLoop failed for', id, e);
      });

    return {
      setPosition: (x, y, z): void => {
        state.pos.x = x;
        state.pos.y = y;
        state.pos.z = z;
        if (state.nodes && this.ctx) {
          const t = this.ctx.currentTime;
          state.nodes.panner.positionX.setValueAtTime(x, t);
          state.nodes.panner.positionY.setValueAtTime(y, t);
          state.nodes.panner.positionZ.setValueAtTime(z, t);
        }
      },
      setVolume: (v): void => {
        state.volumeMul = v;
        if (state.nodes) {
          const entry: SfxEntry = SFX[id];
          state.nodes.gain.gain.value = (entry.volume ?? 1) * v;
        }
      },
      setPlaybackRate: (rate): void => {
        if (state.nodes && this.ctx) {
          // Use setTargetAtTime so velocity-driven changes don't
          // produce zipper noise on small per-frame jitter.
          state.nodes.source.playbackRate.setTargetAtTime(
            Math.max(0.1, rate),
            this.ctx.currentTime,
            0.05,
          );
        }
      },
      stop: (fadeMs = 0): void => {
        state.stopped = true;
        if (!state.nodes || !this.ctx) {
          return;
        }
        const ctx = this.ctx;
        const now = ctx.currentTime;
        const { source, gain, panner, extras } = state.nodes;
        if (fadeMs > 0) {
          gain.gain.cancelScheduledValues(now);
          gain.gain.setValueAtTime(gain.gain.value, now);
          gain.gain.linearRampToValueAtTime(0, now + fadeMs / 1000);
          source.stop(now + fadeMs / 1000);
        } else {
          source.stop();
        }
        // Disconnect after the source fully stops to avoid clipping the
        // fade. The source.onended handler is the canonical place but
        // we also schedule it explicitly for the fade case.
        const cleanup = (): void => {
          gain.disconnect();
          panner.disconnect();
          extras.forEach((n) => n.disconnect());
        };
        source.onended = cleanup;
      },
    };
  }

  /** Stop a singleton-loop cue. No-op for non-loops or already-stopped
   *  cues. For per-instance positional loops, use the handle's stop()
   *  instead. */
  stop(id: SfxId, fadeMs = 0): void {
    const looper = this.loops.get(id);
    if (!looper) {
      return;
    }
    const ctx = this.ctx;
    if (!ctx) {
      return;
    }
    const now = ctx.currentTime;
    if (fadeMs > 0) {
      looper.gain.gain.cancelScheduledValues(now);
      looper.gain.gain.setValueAtTime(looper.gain.gain.value, now);
      looper.gain.gain.linearRampToValueAtTime(0, now + fadeMs / 1000);
      looper.source.stop(now + fadeMs / 1000);
    } else {
      looper.source.stop();
    }
    this.loops.delete(id);
  }

  /** Adjust the gain of a currently-playing singleton loop in real
   *  time. No-op if the loop isn't running. */
  setLoopVolume(id: SfxId, volume: number): void {
    const looper = this.loops.get(id);
    if (!looper || !this.ctx) {
      return;
    }
    const target = Math.max(0, volume);
    looper.gain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.05);
  }

  /** True if a singleton loop with this id is currently active. */
  isLoopActive(id: SfxId): boolean {
    return this.loops.has(id);
  }

  /** Update the AudioContext's listener pose so spatial cues pan +
   *  attenuate correctly relative to the camera. Called each frame by
   *  `SpatialAudioListener`. Forward and up vectors should be the
   *  camera's local -Z and +Y axes rotated into world space. */
  setListenerPose(
    posX: number,
    posY: number,
    posZ: number,
    fwdX: number,
    fwdY: number,
    fwdZ: number,
    upX: number,
    upY: number,
    upZ: number,
  ): void {
    if (!this.ctx) {
      return;
    }
    const listener = this.ctx.listener;
    const t = this.ctx.currentTime;
    listener.positionX.setValueAtTime(posX, t);
    listener.positionY.setValueAtTime(posY, t);
    listener.positionZ.setValueAtTime(posZ, t);
    listener.forwardX.setValueAtTime(fwdX, t);
    listener.forwardY.setValueAtTime(fwdY, t);
    listener.forwardZ.setValueAtTime(fwdZ, t);
    listener.upX.setValueAtTime(upX, t);
    listener.upY.setValueAtTime(upY, t);
    listener.upZ.setValueAtTime(upZ, t);
  }

  /** Update the cube room IR. Called when the world dimensions change
   *  so the first-reflection delay matches the actual cube. No-op if
   *  the convolver isn't initialised (no AudioContext yet — will use
   *  this size when the context comes up). */
  setRoomSize(sideLength: number): void {
    this.roomSize = sideLength;
    if (this.ctx && this.cubeReverb) {
      this.cubeReverb.buffer = this.makeCubeImpulseResponse(this.ctx, sideLength);
    }
  }

  /** Expose the AudioContext + master gain for other audio modules
   *  that want to share the same routing graph. Only valid after
   *  `unlock()` has run (i.e. inside a user gesture). */
  getContext(): { ctx: AudioContext; masterGain: GainNode } | null {
    if (!this.ctx || !this.masterGain) {
      return null;
    }
    return { ctx: this.ctx, masterGain: this.masterGain };
  }

  /** Master mute — useful for a future "audio off" toggle. */
  setMasterVolume(v: number): void {
    if (this.masterGain) {
      this.masterGain.gain.value = Math.max(0, Math.min(1, v));
    }
  }

  /** Synchronous Safari-friendly audio unlock. MUST be called as the
   *  first line of any user-gesture handler (click, keypress, touch)
   *  before any `play()` calls. Idempotent — subsequent calls are
   *  no-ops once the context exists.
   *
   *  Why this is its own method instead of being inside `play()`:
   *  Safari's gesture rule isn't satisfied by the synchronous portion
   *  of an async function alone — it needs the context creation +
   *  unlock buffer + resume() call to be on the *literal* call stack
   *  of the gesture handler, no async hops between. Wrapping that in
   *  a sync method that handlers call first is the only reliable
   *  pattern. Once ctx is created here, subsequent `play()` calls
   *  (which can be async) work because the ctx is already unlocked. */
  unlock(): void {
    if (this.ctx) {
      // Already unlocked. Still nudge resume in case the OS
      // suspended us in the background.
      if (this.ctx.state === 'suspended') {
        // eslint-disable-next-line no-console
        console.log('[sfx-debug] unlock: ctx exists, state=suspended → resume()');
        void this.ctx.resume().then(() => {
          // eslint-disable-next-line no-console
          console.log('[sfx-debug] resume resolved, state=', this.ctx?.state);
        });
      }
      return;
    }
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (typeof Ctor !== 'function') {
      // eslint-disable-next-line no-console
      console.warn('[sfx-debug] unlock: no AudioContext constructor');
      return;
    }
    this.ctx = new Ctor();
    // eslint-disable-next-line no-console
    console.log('[sfx-debug] unlock: ctx created, state=', this.ctx.state);

    // iOS silent-switch bypass — see `silenceUnlockAudio` declaration.
    // Use a real silent WAV file (not a data URL) because iOS Safari
    // rejects zero-data data URLs silently in some versions, without
    // firing the `play()` rejection handler. Volume slightly above
    // zero so iOS recognises it as actively playing media.
    if (!this.silenceUnlockAudio) {
      const a = new Audio('/audio/silence.wav');
      a.loop = true;
      a.volume = 0.0001;
      a.play()
        .then(() => {
          // eslint-disable-next-line no-console
          console.log('[sfx-debug] silenceUnlockAudio playing — iOS bypass active');
        })
        .catch((e: unknown) => {
          // eslint-disable-next-line no-console
          console.warn('[sfx-debug] silenceUnlockAudio play() rejected:', e);
        });
      this.silenceUnlockAudio = a;
    }

    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 1;
    this.masterGain.connect(this.ctx.destination);
    // Build the shared cube-room convolver.
    this.cubeReverb = this.ctx.createConvolver();
    this.cubeReverb.buffer = this.makeCubeImpulseResponse(this.ctx, this.roomSize);
    this.cubeReverb.connect(this.masterGain);
    // Silent unlock buffer — Safari needs an actual `source.start()`
    // call inside the gesture window before any other audio will
    // produce sound, even after `resume()` succeeds.
    const unlock = this.ctx.createBufferSource();
    unlock.buffer = this.ctx.createBuffer(1, 256, this.ctx.sampleRate);
    unlock.connect(this.masterGain);
    unlock.start(0);
    // Synchronous resume on the gesture stack.
    void this.ctx.resume().then(() => {
      // eslint-disable-next-line no-console
      console.log('[sfx-debug] resume resolved, state=', this.ctx?.state);
    });
  }

  /** Pure HTTP prefetch — pulls every cue's bytes into the browser
   *  cache without creating an AudioContext. Critical for Safari: if
   *  the AudioContext is created outside a user gesture, Safari may
   *  permanently treat it as locked. Deferring ctx creation to
   *  `unlock()` (called from a user-gesture handler) keeps Safari
   *  happy; we still get the bandwidth benefit because bytes are in
   *  cache when ctx-creation-then-decode finally runs. */
  async preload(): Promise<void> {
    const urls = new Set<string>();
    for (const entry of Object.values(SFX) as SfxEntry[]) {
      for (const url of entry.variants) {
        urls.add(url);
      }
    }
    await Promise.allSettled(Array.from(urls).map((url) => fetch(url).catch(() => undefined)));
  }
}

export const sfx = new SfxManager();

/** Tiny seedable PRNG (mulberry32). Returns values in [0, 1). Used by
 *  `makeCubeImpulseResponse` so reverb is reproducible per session and
 *  test snapshots stay stable. Exported for the IR test. */
export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Build a soft-saturation transfer curve for `WaveShaperNode`. The
 *  curve is a tanh-shaped soft clipper: linear-ish near zero, gently
 *  flattens toward ±1 as input grows. `amount` (0..1) controls drive —
 *  0 is identity, 1 is heavy saturation. The curve is sampled at 1024
 *  points; WaveShaperNode interpolates between them. */
function makeSaturationCurve(amount: number): Float32Array<ArrayBuffer> {
  const n = 1024;
  // Allocate via an explicit ArrayBuffer so the result type narrows to
  // Float32Array<ArrayBuffer>, which is what WaveShaperNode.curve
  // expects in current lib.dom (the default `new Float32Array(n)` ctor
  // returns Float32Array<ArrayBufferLike>).
  const curve = new Float32Array(new ArrayBuffer(n * 4));
  // Drive scales tanh's input range. amount=0 → drive=0 (identity);
  // amount=1 → drive=4 (deeply soft-clipped).
  const drive = Math.max(0, Math.min(1, amount)) * 4;
  if (drive === 0) {
    for (let i = 0; i < n; i++) {
      curve[i] = (i / (n - 1)) * 2 - 1;
    }
    return curve;
  }
  const norm = Math.tanh(drive); // so output stays in [-1, 1]
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(drive * x) / norm;
  }
  return curve;
}
