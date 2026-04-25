/**
 * RevealOrchestrator — Phase 4
 *
 * Mounts the visual + audio pieces of the sword/VIBE reveal and drives
 * the state machine forward on the user's first click. After that we
 * auto-advance with timed `setTimeout`s through `swinging` → `impact` →
 * `revealed` so the choreography is deterministic and survives
 * OrbitControls (clicks-on-drag are filtered out by the canvas itself).
 *
 * Camera is owned by the parent — we don't move it. The whole sequence
 * is centred on the back wall along -Z.
 */
import { useEffect } from 'react';
import { useWorldStore } from '@/store';
import { Portal } from './Portal';
import { Sword } from './Sword';
import { Fracture } from './Fracture';
import { VibeText } from './VibeText';
import { useRevealAudio } from './useRevealAudio';

// Beat durations (ms) measured from when each transition starts.
const ARMED_TO_SWINGING_MS = 380;
const SWINGING_TO_IMPACT_MS = 540;
const IMPACT_TO_REVEALED_MS = 1450;

export function RevealOrchestrator(): JSX.Element {
  const revealState = useWorldStore((s) => s.revealState);
  const advanceReveal = useWorldStore((s) => s.advanceReveal);

  useRevealAudio();

  // First click anywhere → arm the reveal. After that, the timers below
  // step us through the rest of the choreography.
  useEffect(() => {
    if (revealState !== 'idle') {return;}

    const onClick = (): void => {
      // Use the live store ref to avoid stale closures.
      if (useWorldStore.getState().revealState === 'idle') {
        useWorldStore.getState().advanceReveal();
      }
    };
    window.addEventListener('click', onClick, { once: true });
    return () => window.removeEventListener('click', onClick);
  }, [revealState]);

  // Auto-advance the rest of the beats with timers. Each effect listens
  // to the current state and schedules the next step when entered.
  useEffect(() => {
    if (revealState === 'armed') {
      const id = window.setTimeout(advanceReveal, ARMED_TO_SWINGING_MS);
      return () => window.clearTimeout(id);
    }
    if (revealState === 'swinging') {
      const id = window.setTimeout(advanceReveal, SWINGING_TO_IMPACT_MS);
      return () => window.clearTimeout(id);
    }
    if (revealState === 'impact') {
      const id = window.setTimeout(advanceReveal, IMPACT_TO_REVEALED_MS);
      return () => window.clearTimeout(id);
    }
    return undefined;
  }, [revealState, advanceReveal]);

  return (
    <>
      <Portal />
      <Sword />
      <Fracture />
      <VibeText />
    </>
  );
}

export const REVEAL_TIMINGS = {
  ARMED_TO_SWINGING_MS,
  SWINGING_TO_IMPACT_MS,
  IMPACT_TO_REVEALED_MS,
} as const;
