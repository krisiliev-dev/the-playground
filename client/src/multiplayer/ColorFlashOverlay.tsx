/**
 * DOM-overlay receiver for `color_flash` SceneEvents — pulses
 * a tinted full-screen layer when the local player is within
 * `radius` of the trigger position. Stronger pulse the closer
 * the player is.
 *
 * Lives outside the canvas (in `App.tsx` overlay layer) so it
 * renders ABOVE every 3D pixel — confetti, swords, portals,
 * etc. all get tinted by the flash uniformly.
 *
 * Multiple concurrent flashes blend additively (the layer's
 * `mix-blend-mode: screen` keeps them additive without DOM
 * stacking weirdness). Each flash has its own DOM node;
 * cleanup happens after `duration_ms`.
 */
import { useEffect, useState } from 'react';
import { cursorWorldPosition } from '@/components/scene/cursorWorldPosition';
import { useSceneEvent } from './sceneEvents';
import type { SceneEventOf } from './types';

type Event = SceneEventOf<'color_flash'>;

interface ActiveFlash {
  id: number;
  color: string;
  peakAlpha: number;
  duration: number;
  startedAt: number;
}

let nextId = 0;

export function ColorFlashOverlay(): JSX.Element {
  const [active, setActive] = useState<ActiveFlash[]>([]);

  useSceneEvent('color_flash', (event) => {
    handleFlash(event, setActive);
  });

  // Per-frame opacity ramp via a rAF loop. We avoid useFrame
  // here because this component is in the DOM tree, not the
  // R3F tree. requestAnimationFrame is the right hook for
  // outside-canvas animation.
  return (
    <>
      {active.map((f) => (
        <FlashLayer key={f.id} flash={f} onDone={() => removeFlash(f.id, setActive)} />
      ))}
    </>
  );
}

function handleFlash(
  event: Event,
  setActive: React.Dispatch<React.SetStateAction<ActiveFlash[]>>,
): void {
  // Distance attenuation: fully opaque at the trigger,
  // linear falloff to zero at `radius`. Outside the radius,
  // we don't render the flash at all.
  const dx = cursorWorldPosition.x - event.position[0];
  const dy = cursorWorldPosition.y - event.position[1];
  const dz = cursorWorldPosition.z - event.position[2];
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (event.radius > 0 && dist > event.radius) {
    return;
  }
  const falloff = event.radius > 0 ? 1 - dist / event.radius : 1;
  const peakAlpha = event.peak_alpha * Math.max(0, falloff);
  if (peakAlpha <= 0) {
    return;
  }
  nextId += 1;
  setActive((prev) => [
    ...prev,
    {
      id: nextId,
      color: event.color,
      peakAlpha,
      duration: event.duration_ms / 1000,
      startedAt: performance.now() / 1000,
    },
  ]);
}

function removeFlash(
  id: number,
  setActive: React.Dispatch<React.SetStateAction<ActiveFlash[]>>,
): void {
  setActive((prev) => prev.filter((f) => f.id !== id));
}

function FlashLayer({
  flash,
  onDone,
}: {
  flash: ActiveFlash;
  onDone: () => void;
}): JSX.Element {
  const [alpha, setAlpha] = useState(0);

  useEffect(() => {
    let raf = 0;
    const tick = (): void => {
      const elapsed = performance.now() / 1000 - flash.startedAt;
      const t = Math.min(1, elapsed / flash.duration);
      // Triangular envelope: ramp up to peakAlpha at t=0.3,
      // then linearly down to 0 at t=1. Reads as a "pulse"
      // rather than the hard fade-in / hard cut you'd get from
      // a single linear opacity sweep.
      let a: number;
      if (t < 0.3) {
        a = (t / 0.3) * flash.peakAlpha;
      } else {
        a = ((1 - t) / 0.7) * flash.peakAlpha;
      }
      setAlpha(Math.max(0, a));
      if (t >= 1) {
        onDone();
        return;
      }
      raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(raf);
  }, [flash, onDone]);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: flash.color,
        opacity: alpha,
        pointerEvents: 'none',
        mixBlendMode: 'screen',
        zIndex: 100,
        transition: 'none',
      }}
      aria-hidden="true"
    />
  );
}
