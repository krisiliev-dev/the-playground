/**
 * VibeText — Phase 4
 *
 * The word "VIBE" rendered as 3D text on the back wall, glowing through
 * the cracks once the fracture has spread. We use drei's `<Text>`
 * component because it's the cleanest path to a glyph mesh without
 * shipping a font file or wrestling with `TextGeometry`.
 *
 * Visibility is gated on `revealState`: hidden until `impact`, then a
 * ramped emissive grow that locks at full brightness during `revealed`.
 */
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Text } from '@react-three/drei';
import type { Mesh, MeshBasicMaterial } from 'three';
import { useWorldStore } from '@/store';
import { PORTAL_CONSTANTS } from './Portal';

const VIBE_COLOR = '#00ffcc';
const VIBE_TEXT = 'VIBE';

interface VibeTextProps {
  position?: [number, number, number];
  fontSize?: number;
}

export function VibeText({
  position = [0, 0, PORTAL_CONSTANTS.Z + 0.2],
  fontSize = 5,
}: VibeTextProps): JSX.Element | null {
  const meshRef = useRef<Mesh>(null);
  const revealState = useWorldStore((s) => s.revealState);

  // We track when the impact landed so the glow ramps in over ~1.5s
  // rather than popping.
  const impactAt = useRef<number | null>(null);
  useEffect(() => {
    if (revealState === 'impact' || revealState === 'revealed') {
      if (impactAt.current === null) {impactAt.current = performance.now() / 1000;}
    } else {
      impactAt.current = null;
    }
  }, [revealState]);

  // Memoise the white-text base. We boost a custom multiplier each frame
  // (above 1.0) on the colour to fake bloom-y intensity without needing
  // post-processing wired in.
  const baseColor = useMemo(() => VIBE_COLOR, []);

  useFrame((state) => {
    if (!meshRef.current) {return;}
    const mat = meshRef.current.material as MeshBasicMaterial | undefined;
    if (!mat) {return;}

    if (impactAt.current === null) {
      mat.opacity = 0;
      return;
    }

    const dt = state.clock.elapsedTime - impactAt.current;
    // Ramp 0 → 1 over 1.4s, then a slow breathe.
    const rampedIn = Math.min(1, dt / 1.4);
    const breathe = 0.85 + 0.15 * Math.sin(state.clock.elapsedTime * 1.8);
    mat.opacity = rampedIn * breathe;
    mat.transparent = true;
  });

  // Don't render the geometry at all until the wall has cracked —
  // drei's <Text> still mounts a font and we want the SDF prep to happen
  // ahead of the impact, so we keep it mounted but with opacity 0 from
  // the start. (i.e. always render; useFrame controls visibility.)

  return (
    <Text
      ref={meshRef}
      position={position}
      fontSize={fontSize}
      color={baseColor}
      anchorX="center"
      anchorY="middle"
      letterSpacing={0.08}
      fillOpacity={0}
      outlineColor={VIBE_COLOR}
      outlineOpacity={0.6}
      outlineWidth={0.04}
      outlineBlur={0.2}
    >
      {VIBE_TEXT}
    </Text>
  );
}

export const VIBE_CONSTANTS = {
  COLOR: VIBE_COLOR,
  TEXT: VIBE_TEXT,
} as const;
