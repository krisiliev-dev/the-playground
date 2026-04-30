/**
 * useRevealAudio — Phase 4
 *
 * Plain `<HTMLAudioElement>` wrappers, one per beat. The hook fires
 * cues when the reveal state advances.
 *
 * NOTE (2026-04-25): The Mixkit files committed under client/public/audio/
 * were picked by the bootstrapping agent based on category URLs and
 * turned out to contain wrong content (water pour, crowd chatter). Audio
 * is currently silenced here — every cue's volume is forced to 0 — so the
 * reveal plays without sound. To re-enable, swap the MP3s under
 * client/public/audio/ for ones that actually match each beat (sword
 * swoosh, glass crack, low impact thud, etc.) and remove the AUDIO_MUTED
 * gate below.
 */
import { useEffect, useRef } from 'react';
import { useWorldStore, type RevealState } from '@/store';

const AUDIO_BASE = '/audio';

/** Set to true to silence all reveal SFX (e.g. when iterating). */
const AUDIO_MUTED = false;

const SOURCES = {
  portalHum: `${AUDIO_BASE}/portal-hum.mp3`,
  swordSummon: `${AUDIO_BASE}/sword-summon.mp3`,
  swordSwoosh: `${AUDIO_BASE}/sword-swoosh.mp3`,
  impact: `${AUDIO_BASE}/impact.mp3`,
  crack: `${AUDIO_BASE}/crack.mp3`,
  vibeHum: `${AUDIO_BASE}/vibe-hum.mp3`,
} as const;

type SoundId = keyof typeof SOURCES;

interface SoundConfig {
  loop?: boolean;
  volume?: number;
}

const CONFIG: Record<SoundId, SoundConfig> = {
  portalHum: { loop: true, volume: 0.22 },
  swordSummon: { loop: false, volume: 0.6 },
  swordSwoosh: { loop: false, volume: 0.7 },
  impact: { loop: false, volume: 0.85 },
  crack: { loop: false, volume: 0.65 },
  vibeHum: { loop: true, volume: 0.35 },
};

/**
 * Pre-create the audio elements once. They sit silent until played.
 * Returned object is keyed by SoundId and held in a ref so we don't
 * re-instantiate across renders.
 */
function createElements(): Record<SoundId, HTMLAudioElement> {
  const out = {} as Record<SoundId, HTMLAudioElement>;
  (Object.keys(SOURCES) as SoundId[]).forEach((id) => {
    const audio = new Audio(SOURCES[id]);
    audio.preload = 'auto';
    audio.loop = CONFIG[id].loop ?? false;
    audio.volume = AUDIO_MUTED ? 0 : (CONFIG[id].volume ?? 1);
    out[id] = audio;
  });
  return out;
}

/**
 * Wires the reveal state machine to the audio cues. Mounts inside the
 * R3F tree (or anywhere with access to the store) and fires-and-forgets
 * SFX as state advances.
 */
export function useRevealAudio(): void {
  const elementsRef = useRef<Record<SoundId, HTMLAudioElement> | null>(null);
  const previousState = useRef<RevealState>('idle');
  const revealState = useWorldStore((s) => s.revealState);

  // Lazy-init elements on first call (after mount). Browsers will still
  // require the first .play() to be triggered by a user gesture, so the
  // portalHum starts on `armed` not on mount.
  useEffect(() => {
    if (!elementsRef.current) {
      elementsRef.current = createElements();
    }
    return () => {
      const els = elementsRef.current;
      if (!els) {
        return;
      }
      Object.values(els).forEach((el) => {
        el.pause();
        el.src = '';
      });
      elementsRef.current = null;
    };
  }, []);

  useEffect(() => {
    const els = elementsRef.current;
    if (!els) {
      return;
    }
    const prev = previousState.current;
    previousState.current = revealState;

    // We only fire on a true transition, not on initial mount.
    if (prev === revealState) {
      return;
    }

    const play = (id: SoundId): void => {
      const el = els[id];
      el.currentTime = 0;
      // .play() returns a Promise; ignore rejections (autoplay blocked).
      void el.play().catch(() => {
        /* noop — autoplay policy */
      });
    };

    const stop = (id: SoundId): void => {
      const el = els[id];
      el.pause();
      el.currentTime = 0;
    };

    if (revealState === 'armed') {
      // First user gesture — kick off the ambient hum and the summon shing.
      play('portalHum');
      play('swordSummon');
    } else if (revealState === 'swinging') {
      play('swordSwoosh');
    } else if (revealState === 'impact') {
      play('impact');
      // Slight delay on the crack propagation for a layered feel.
      window.setTimeout(() => play('crack'), 120);
      stop('portalHum');
    } else if (revealState === 'revealed') {
      play('vibeHum');
    } else if (revealState === 'idle') {
      // Reset (e.g. test) — silence everything.
      (Object.keys(els) as SoundId[]).forEach((id) => stop(id));
    }
  }, [revealState]);
}

export const REVEAL_AUDIO_SOURCES = SOURCES;
