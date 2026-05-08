/**
 * In-canvas receiver for `text_popup` SceneEvents — renders
 * floating, billboarded labels at world positions that fade
 * out over their `lifetime_ms`.
 *
 * Uses drei's `<Billboard>` to keep the text facing the camera
 * regardless of orbit, and `<Text>` (troika-three-text) for
 * crisp world-scaled SDF rendering.
 *
 * Mounted inside the canvas (in `World.tsx`).
 */
import { useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Billboard, Text } from '@react-three/drei';
import type { Mesh } from 'three';
import type { SceneEventOf } from './types';
import { useSceneEvent } from './sceneEvents';

type Event = SceneEventOf<'text_popup'>;

interface ActivePopup {
  id: number;
  event: Event;
  startedAt: number;
}

let nextId = 0;

export function TextPopups(): JSX.Element {
  const [active, setActive] = useState<ActivePopup[]>([]);

  useSceneEvent('text_popup', (event) => {
    nextId += 1;
    setActive((prev) => [
      ...prev,
      { id: nextId, event, startedAt: performance.now() / 1000 },
    ]);
  });

  // Sweep expired popups. Lifetime is in ms; we compare in
  // seconds so the rest of the math stays in the same unit as
  // the per-frame elapsed counters.
  useFrame(() => {
    const now = performance.now() / 1000;
    setActive((prev) => {
      const next = prev.filter(
        (p) => now - p.startedAt < p.event.lifetime_ms / 1000,
      );
      return next.length === prev.length ? prev : next;
    });
  });

  return (
    <>
      {active.map((p) => (
        <Popup key={p.id} popup={p} />
      ))}
    </>
  );
}

function Popup({ popup }: { popup: ActivePopup }): JSX.Element {
  const meshRef = useRef<Mesh>(null);
  const initialY = useMemo(() => popup.event.position[1], [popup.event.position]);

  // Per-frame: float the text up gently and fade alpha over
  // its lifetime. Material opacity is the standard <Text>
  // surface for fade-out; `position.y` drift gives the popup a
  // visible "rising note" motion that reads as the label
  // dissipating, not just disappearing.
  useFrame(() => {
    const m = meshRef.current;
    if (!m) {
      return;
    }
    const elapsed = performance.now() / 1000 - popup.startedAt;
    const lifeT = Math.min(1, elapsed / (popup.event.lifetime_ms / 1000));
    // Drift: `popup.event.size` units over the full lifetime.
    m.position.y = initialY + lifeT * popup.event.size;
    // Fade: fully opaque for the first 60%, then linearly to 0.
    const opacity = lifeT < 0.6 ? 1 : Math.max(0, 1 - (lifeT - 0.6) / 0.4);
    const mat = m.material as { opacity?: number; transparent?: boolean };
    if (typeof mat.opacity === 'number') {
      mat.opacity = opacity;
      mat.transparent = true;
    }
  });

  return (
    <Billboard
      position={[
        popup.event.position[0],
        popup.event.position[1],
        popup.event.position[2],
      ]}
    >
      <Text
        ref={meshRef}
        fontSize={popup.event.size}
        color={popup.event.color}
        anchorX="center"
        anchorY="middle"
        outlineWidth={popup.event.size * 0.04}
        outlineColor="#000000"
        outlineOpacity={0.6}
      >
        {popup.event.text}
      </Text>
    </Billboard>
  );
}
