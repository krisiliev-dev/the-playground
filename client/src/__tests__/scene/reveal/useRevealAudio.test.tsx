import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRevealAudio, REVEAL_AUDIO_SOURCES } from '@/components/scene/reveal/useRevealAudio';
import { useWorldStore } from '@/store';

// Replace the global Audio constructor with a tracking stub so we can
// assert that the right cue was triggered for each beat.
type Stub = {
  src: string;
  loop: boolean;
  volume: number;
  preload: string;
  currentTime: number;
  paused: boolean;
  playCount: number;
  pauseCount: number;
  play: () => Promise<void>;
  pause: () => void;
};
let createdAudios: Stub[] = [];

beforeEach(() => {
  createdAudios = [];
  const FakeAudio = function FakeAudio(this: Stub, src: string) {
    this.src = src;
    this.loop = false;
    this.volume = 1;
    this.preload = '';
    this.currentTime = 0;
    this.paused = true;
    this.playCount = 0;
    this.pauseCount = 0;
    this.play = (): Promise<void> => {
      this.playCount++;
      this.paused = false;
      return Promise.resolve();
    };
    this.pause = (): void => {
      this.pauseCount++;
      this.paused = true;
    };
    createdAudios.push(this);
    return this;
  } as unknown as typeof Audio;
  // jsdom doesn't ship a usable Audio — install the stub.
  (globalThis as { Audio: typeof Audio }).Audio = FakeAudio;
  useWorldStore.getState().resetReveal();
});

afterEach(() => {
  useWorldStore.getState().resetReveal();
});

describe('useRevealAudio', () => {
  it('creates one audio element per source on mount', () => {
    renderHook(() => useRevealAudio());
    expect(createdAudios.length).toBe(Object.keys(REVEAL_AUDIO_SOURCES).length);
  });

  it('plays the summon + portalHum cues when transitioning to armed', () => {
    renderHook(() => useRevealAudio());
    act(() => {
      useWorldStore.getState().advanceReveal(); // → armed
    });
    const summon = createdAudios.find((a) => a.src.endsWith('sword-summon.mp3'));
    const hum = createdAudios.find((a) => a.src.endsWith('portal-hum.mp3'));
    expect(summon?.playCount).toBeGreaterThan(0);
    expect(hum?.playCount).toBeGreaterThan(0);
  });

  it('plays the impact cue and stops the portal hum on impact', () => {
    renderHook(() => useRevealAudio());
    act(() => {
      const { advanceReveal } = useWorldStore.getState();
      advanceReveal(); // armed
      advanceReveal(); // swinging
      advanceReveal(); // impact
    });
    const impact = createdAudios.find((a) => a.src.endsWith('impact.mp3'));
    const hum = createdAudios.find((a) => a.src.endsWith('portal-hum.mp3'));
    expect(impact?.playCount).toBeGreaterThan(0);
    expect(hum?.pauseCount).toBeGreaterThan(0);
  });
});
