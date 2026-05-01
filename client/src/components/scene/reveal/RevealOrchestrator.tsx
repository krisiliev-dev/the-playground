/**
 * RevealOrchestrator — Phase 4
 *
 * Mounts the visual + audio pieces and drives the state machine.
 * On the user's first click anywhere on the canvas, raycasts from the
 * camera through the click position into the cube to find the wall hit
 * point. Stores that point so the sword/cracks/VIBE all land there.
 */
import { useEffect, useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import { Raycaster, Vector2, Vector3 } from 'three';
import { useWorldStore } from '@/store';
import { intersectInsideCube } from '@/utils/cubeRaycast';
import { Portal } from './Portal';
import { Sword } from './Sword';
import { BulletTimeDirector } from './BulletTimeDirector';
import { VIBE_SLOTS } from './vibeFormation';
import { sfx } from '../../audio/SfxManager';

/** Armed phase doubles as the camera-pan window — 800ms gives enough
 *  time for the camera to swing toward the spawn direction so the user
 *  registers what's about to happen. */
const ARMED_TO_SWINGING_MS = 800;
/** Sword swing duration: 5.5s per-sword (3.5 pre + 1.2 mid + 0.8 post) +
 *  cascade tail (12 × 50ms = 0.6s). Total ≈ 6.1s; round to 6300ms with
 *  a small buffer. */
const SWINGING_TO_IMPACT_MS = 6300;
const IMPACT_TO_REVEALED_MS = 1450;

export function RevealOrchestrator(): JSX.Element {
  const revealState = useWorldStore((s) => s.revealState);
  const advanceReveal = useWorldStore((s) => s.advanceReveal);
  const setClickHit = useWorldStore((s) => s.setClickHit);
  const dimensions = useWorldStore((s) => s.environment.dimensions);
  const clickHit = useWorldStore((s) => s.clickHit);

  const { camera } = useThree();

  // Cube half-extents derived from the live store config — never stale.
  const cubeHalf = useMemo(
    () => new Vector3(dimensions[0] / 2, dimensions[1] / 2, dimensions[2] / 2),
    [dimensions],
  );

  // First click anywhere → raycast to cube wall, store hit, advance reveal.
  useEffect(() => {
    if (revealState !== 'idle') {
      return;
    }

    const onClick = (e: MouseEvent): void => {
      // Synchronous Safari audio unlock — MUST be the first thing in
      // the click handler. Creates the AudioContext + plays the silent
      // unlock buffer + resume() on this exact call stack, all before
      // any await. Without this, Safari keeps the context locked even
      // after later resume() calls succeed, and every cue is silent.
      sfx.unlock();

      if (useWorldStore.getState().revealState !== 'idle') {
        return;
      }

      const ndc = new Vector2(
        (e.clientX / window.innerWidth) * 2 - 1,
        -(e.clientY / window.innerHeight) * 2 + 1,
      );
      const raycaster = new Raycaster();
      raycaster.setFromCamera(ndc, camera);
      const hit = intersectInsideCube(raycaster.ray.origin, raycaster.ray.direction, cubeHalf);
      if (!hit) {
        return;
      }

      // eslint-disable-next-line no-console
      console.log('[Reveal] click registered at', hit.point);
      // Audio for the click itself is handled by the global mouse
      // feedback in App.tsx (mouseDown + mouseUp cues). The reveal
      // click handler just advances state.
      setClickHit({
        point: [hit.point.x, hit.point.y, hit.point.z],
        normal: [hit.normal.x, hit.normal.y, hit.normal.z],
      });
      useWorldStore.getState().advanceReveal();
    };

    window.addEventListener('click', onClick, { once: true });
    return () => window.removeEventListener('click', onClick);
  }, [revealState, camera, setClickHit, cubeHalf]);

  useEffect(() => {
    // eslint-disable-next-line no-console
    console.log('[Reveal] state →', revealState);
    // Spatial low-frequency boom emitted at the wall hit point on the
    // moment of impact. The per-sword slams provide the higher-
    // frequency punch; this rumble adds weight to the wall itself.
    if (revealState === 'impact' && clickHit) {
      void sfx.play('impactRumble', {
        position: { x: clickHit.point[0], y: clickHit.point[1], z: clickHit.point[2] },
      });
    }
  }, [revealState, clickHit]);

  // Auto-advance the rest of the beats with timers.
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
      {VIBE_SLOTS.map((slot, i) => (
        <Sword key={slot.id} slot={slot} staggerIndex={i} />
      ))}
      <BulletTimeDirector />
    </>
  );
}

export const REVEAL_TIMINGS = {
  ARMED_TO_SWINGING_MS,
  SWINGING_TO_IMPACT_MS,
  IMPACT_TO_REVEALED_MS,
} as const;
