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
import { FORMATION_SCALE, VIBE_SLOTS } from './vibeFormation';
import { sfx } from '../../audio/SfxManager';
import { ARMED_DURATION_MS, SWINGING_DURATION_MS, IMPACT_DURATION_MS } from './constants';
import { buildPortalEndpoints } from '@/content/portals';

export function RevealOrchestrator(): JSX.Element {
  const revealState = useWorldStore((s) => s.revealState);
  const advanceReveal = useWorldStore((s) => s.advanceReveal);
  const setClickHit = useWorldStore((s) => s.setClickHit);
  const setClickCamPose = useWorldStore((s) => s.setClickCamPose);
  const setRevealStateEnteredAt = useWorldStore((s) => s.setRevealStateEnteredAt);
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
      // Capture the click-time camera pose so remote viewers can
      // replicate the cascade with the originator's POV. Local
      // Sword.tsx still does its own first-frame capture from
      // useThree's camera; this store value exists for the wire
      // broadcast (rides on PlayerInput presence).
      setClickCamPose({
        position: [camera.position.x, camera.position.y, camera.position.z],
        quaternion: [
          camera.quaternion.x,
          camera.quaternion.y,
          camera.quaternion.z,
          camera.quaternion.w,
        ],
      });
      // Stamp the click moment so the receiver-side cascade can
      // compute "elapsed since click" using its own clock relative
      // to the wire-arrival timestamp.
      setRevealStateEnteredAt(performance.now() / 1000);
      useWorldStore.getState().advanceReveal();
    };

    window.addEventListener('click', onClick, { once: true });
    return () => window.removeEventListener('click', onClick);
  }, [revealState, camera, setClickHit, setClickCamPose, setRevealStateEnteredAt, cubeHalf]);

  useEffect(() => {
    // eslint-disable-next-line no-console
    console.log('[Reveal] state →', revealState);
    // Spatial low-frequency boom emitted at the wall hit point on the
    // moment of impact. The per-sword slams provide the higher-
    // frequency punch; this rumble adds weight to the wall itself.
    // playWorld so other connected players hear it spatially-positioned
    // at the impact (per ADR-006).
    if (revealState === 'impact' && clickHit) {
      sfx.playWorld('impactRumble', clickHit.point);
    }
  }, [revealState, clickHit]);

  // Populate runtime portal endpoints once the formation has landed.
  // The 4 formation portals depend on `clickHit` (positioned in the
  // wall plane); the 3 room-exit portals are static-by-room but
  // ride along in the same array for uniform consumption. We trigger
  // on `'impact'` (one beat before `'revealed'`) so the portals are
  // present when the formation visually settles. Cleared by
  // `resetReveal`.
  useEffect(() => {
    if (revealState === 'impact' && clickHit) {
      const endpoints = buildPortalEndpoints(clickHit, FORMATION_SCALE);
      useWorldStore.getState().setPortalEndpoints(endpoints);
    }
  }, [revealState, clickHit]);

  // Auto-advance the rest of the beats with timers.
  useEffect(() => {
    if (revealState === 'armed') {
      const id = window.setTimeout(advanceReveal, ARMED_DURATION_MS);
      return () => window.clearTimeout(id);
    }
    if (revealState === 'swinging') {
      const id = window.setTimeout(advanceReveal, SWINGING_DURATION_MS);
      return () => window.clearTimeout(id);
    }
    if (revealState === 'impact') {
      const id = window.setTimeout(advanceReveal, IMPACT_DURATION_MS);
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
  ARMED_TO_SWINGING_MS: ARMED_DURATION_MS,
  SWINGING_TO_IMPACT_MS: SWINGING_DURATION_MS,
  IMPACT_TO_REVEALED_MS: IMPACT_DURATION_MS,
} as const;
