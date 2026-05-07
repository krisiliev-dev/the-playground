/**
 * RevealOrchestrator — Phase 4
 *
 * Mounts the visual + audio pieces and drives the state machine.
 * On the user's first click anywhere on the canvas, raycasts from the
 * camera through the click position into the cube to find the wall hit
 * point. Stores that point so the sword/cracks/VIBE all land there.
 */
import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { useWorldStore } from '@/store';
import { Portal } from './Portal';
import { Sword } from './Sword';
import { BulletTimeDirector } from './BulletTimeDirector';
import { FORMATION_SCALE, VIBE_SLOTS } from './vibeFormation';
import { sfx } from '../../audio/SfxManager';
import { ARMED_DURATION_MS, SWINGING_DURATION_MS, IMPACT_DURATION_MS } from './constants';
import { buildPortalEndpoints } from '@/content/portals';
import { getSlotIndexForActor, getSpawnSlot } from '@/content/spawnSlots';

export function RevealOrchestrator(): JSX.Element {
  const revealState = useWorldStore((s) => s.revealState);
  const advanceReveal = useWorldStore((s) => s.advanceReveal);
  const setClickHit = useWorldStore((s) => s.setClickHit);
  const setClickCamPose = useWorldStore((s) => s.setClickCamPose);
  const setRevealStateEnteredAt = useWorldStore((s) => s.setRevealStateEnteredAt);
  const setRevealSlotIndex = useWorldStore((s) => s.setRevealSlotIndex);
  const clickHit = useWorldStore((s) => s.clickHit);
  const revealSlotIndex = useWorldStore((s) => s.revealSlotIndex);

  const { camera } = useThree();

  // First click anywhere → raycast to cube wall, store hit, advance reveal.
  useEffect(() => {
    if (revealState !== 'idle') {
      return;
    }

    const onClick = (): void => {
      // Synchronous Safari audio unlock — MUST be the first thing in
      // the click handler. Creates the AudioContext + plays the silent
      // unlock buffer + resume() on this exact call stack, all before
      // any await. Without this, Safari keeps the context locked even
      // after later resume() calls succeed, and every cue is silent.
      sfx.unlock();

      if (useWorldStore.getState().revealState !== 'idle') {
        return;
      }

      // Multiplayer-aware spawn placement: instead of raycasting
      // wherever the player clicked, assign them a predetermined
      // slot on the cube wall based on their actor id ordering
      // among connected peers. This guarantees no two players'
      // clusters overlap (within the slot capacity), and gives
      // each player a consistent home across reconnects.
      const state = useWorldStore.getState();
      const localActorId = state.localPlayerId ?? 'local';
      const peerIds: string[] = [];
      for (const [id, ent] of state.entities) {
        if (ent.kind === 'player') {
          peerIds.push(id);
        }
      }
      // Single-player fallback: if no multiplayer is connected, the
      // peer list is empty (or contains only the synthetic 'local'
      // sentinel). `getSlotIndexForActor` returns 0 in that case,
      // which is the right answer — solo players land on slot 0.
      if (peerIds.length === 0 && localActorId === 'local') {
        peerIds.push('local');
      }
      const slotIndex = getSlotIndexForActor(localActorId, peerIds);
      const slot = getSpawnSlot(slotIndex);

      // eslint-disable-next-line no-console
      console.log('[Reveal] slot', slotIndex, '→', slot.clickHit.point);
      // Audio for the click itself is handled by the global mouse
      // feedback in App.tsx (mouseDown + mouseUp cues). The reveal
      // click handler just advances state.
      setClickHit(slot.clickHit);
      setRevealSlotIndex(slotIndex);
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
  }, [
    revealState,
    camera,
    setClickHit,
    setClickCamPose,
    setRevealStateEnteredAt,
    setRevealSlotIndex,
  ]);

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
  // present when the formation visually settles.
  //
  // Multiplayer: portals are tagged with the local actor id so a
  // remote player's reveal doesn't stomp our set (and vice versa).
  // `addPortalEndpoints` replaces only this actor's portals,
  // preserving any other actors' clusters in the scene.
  useEffect(() => {
    if (revealState === 'impact' && clickHit) {
      const localActorId = useWorldStore.getState().localPlayerId ?? 'local';
      const slot = getSpawnSlot(revealSlotIndex ?? 0);
      const endpoints = buildPortalEndpoints(
        clickHit,
        FORMATION_SCALE,
        localActorId,
        slot.roomExitOffset,
      );
      useWorldStore.getState().addPortalEndpoints(localActorId, endpoints);
    }
  }, [revealState, clickHit, revealSlotIndex]);

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
