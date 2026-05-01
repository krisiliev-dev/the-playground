/**
 * Portals — the four interactable gateways inside the sword formation
 * that lead to each section of the portfolio.
 *
 * Three "section" portals (About, Projects, Writing) navigate via
 * react-router. The fourth, "Simple Experience", flips `documentMode`
 * to true instead — it's a *mode* toggle, not a route, and is
 * visually distinct (clean axis-aligned frame instead of the organic
 * glowing ring) to signal the fourth-wall break.
 *
 * Mounted only after `revealState === 'revealed'` so the formation
 * has finished its sword animation and the user is in avatar mode
 * with the controls hint dismissed (or about to dismiss it). The
 * existing useInteractable hook handles the crosshair-aim-and-click
 * interaction; navigation goes through `pendingNavigation` in the
 * store because react-router context doesn't reliably bridge across
 * R3F's reconciler.
 *
 * Phase 1: click-to-activate only, route lands on the existing
 * RoomPage overlay. Subsequent phases will add the click-lerp camera
 * animation, walk-through detection, and per-section 3D rooms.
 */
import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type { MeshStandardMaterial, Vector3Tuple } from 'three';
import { useInteractable } from './Interactable';
import { useWorldStore } from '@/store';

const PORTAL_RADIUS = 5;
const PORTAL_TUBE = 0.6;
const PORTAL_RING_SEGMENTS = 48;
const SE_FRAME_SEGMENTS = 4;
/** Anchor row z — just past the formation along the user's spawn axis,
 *  so a forward walk carries the avatar through them naturally. */
const PORTAL_Z = -340;
/** Eye-level y; matches the camera's default Y. */
const PORTAL_Y = 0;
/** Horizontal spacing. With radius 5, 30 units between centres
 *  leaves a comfortable gap between rings. */
const PORTAL_SPACING = 30;
/** Centred row of four portals → x extents are ±1.5 × spacing. */
const PORTAL_X = (i: number): number => (i - 1.5) * PORTAL_SPACING;

const HOVER_SCALE = 1.1;
const PRESS_SCALE = 0.95;
const SCALE_LERP_RATE = 12;
const IDLE_EMISSIVE = 0.7;
const HOVER_EMISSIVE = 1.5;
const PRESS_EMISSIVE = 2.5;

interface SectionPortalConfig {
  id: string;
  label: string;
  path: string;
  color: string;
  index: number;
}

const SECTION_PORTALS: ReadonlyArray<SectionPortalConfig> = [
  { id: 'portal-about', label: 'About', path: '/about', color: '#00ffcc', index: 0 },
  { id: 'portal-projects', label: 'Projects', path: '/projects', color: '#ff6ec7', index: 1 },
  { id: 'portal-writing', label: 'Writing', path: '/writing', color: '#ffcc66', index: 2 },
];

const SE_PORTAL_INDEX = 3;

export function Portals(): JSX.Element | null {
  const revealState = useWorldStore((s) => s.revealState);
  // Portals live inside the formation — only mount once the reveal
  // sequence has settled into 'revealed'. Earlier states have the
  // swords mid-flight, so the portals would be visually noisy.
  if (revealState !== 'revealed') {
    return null;
  }
  return (
    <>
      {SECTION_PORTALS.map((p) => (
        <SectionPortal
          key={p.id}
          id={p.id}
          path={p.path}
          color={p.color}
          position={[PORTAL_X(p.index), PORTAL_Y, PORTAL_Z]}
        />
      ))}
      <SimpleExperiencePortal position={[PORTAL_X(SE_PORTAL_INDEX), PORTAL_Y, PORTAL_Z]} />
    </>
  );
}

interface SectionPortalProps {
  id: string;
  path: string;
  color: string;
  position: Vector3Tuple;
}

function SectionPortal({ id, path, color, position }: SectionPortalProps): JSX.Element {
  const setPendingNavigation = useWorldStore((s) => s.setPendingNavigation);
  const { ref, isHovered, isPressed } = useInteractable({
    id,
    onInteract: () => setPendingNavigation(path),
  });
  const matRef = useRef<MeshStandardMaterial>(null);
  const renderedScale = useRef(1);

  useFrame((_state, delta) => {
    const mesh = ref.current;
    if (!mesh) {
      return;
    }
    const targetScale = isPressed ? PRESS_SCALE : isHovered ? HOVER_SCALE : 1;
    const k = 1 - Math.exp(-SCALE_LERP_RATE * delta);
    renderedScale.current += (targetScale - renderedScale.current) * k;
    mesh.scale.setScalar(renderedScale.current);

    const mat = matRef.current;
    if (mat) {
      mat.emissiveIntensity = isPressed
        ? PRESS_EMISSIVE
        : isHovered
          ? HOVER_EMISSIVE
          : IDLE_EMISSIVE;
    }
  });

  return (
    <mesh ref={ref} position={position}>
      <torusGeometry args={[PORTAL_RADIUS, PORTAL_TUBE, 16, PORTAL_RING_SEGMENTS]} />
      <meshStandardMaterial
        ref={matRef}
        color={color}
        emissive={color}
        emissiveIntensity={IDLE_EMISSIVE}
        metalness={0.4}
        roughness={0.3}
      />
    </mesh>
  );
}

interface SimpleExperiencePortalProps {
  position: Vector3Tuple;
}

/**
 * The Simple Experience portal. Visually a clean axis-aligned
 * square frame — torus with 4 tubular segments rotated 45° so the
 * sides line up with world axes. White, low-glow, metallic — reads
 * as a "frame" rather than an organic gateway. ADR-003 calls this
 * out as the fourth-wall-breaking element of the formation.
 */
function SimpleExperiencePortal({ position }: SimpleExperiencePortalProps): JSX.Element {
  const setDocumentMode = useWorldStore((s) => s.setDocumentMode);
  const { ref, isHovered, isPressed } = useInteractable({
    id: 'portal-simple-experience',
    onInteract: () => setDocumentMode(true),
  });
  const matRef = useRef<MeshStandardMaterial>(null);
  const renderedScale = useRef(1);

  useFrame((_state, delta) => {
    const mesh = ref.current;
    if (!mesh) {
      return;
    }
    const targetScale = isPressed ? PRESS_SCALE : isHovered ? HOVER_SCALE : 1;
    const k = 1 - Math.exp(-SCALE_LERP_RATE * delta);
    renderedScale.current += (targetScale - renderedScale.current) * k;
    mesh.scale.setScalar(renderedScale.current);

    const mat = matRef.current;
    if (mat) {
      // Lower emissive overall — the SE portal is a frame, not a glowing
      // gateway. Hover/press still modulate so the affordance reads.
      mat.emissiveIntensity = isPressed ? 0.6 : isHovered ? 0.3 : 0;
    }
  });

  return (
    <mesh ref={ref} position={position} rotation={[0, 0, Math.PI / 4]}>
      <torusGeometry args={[PORTAL_RADIUS + 0.5, 0.4, 8, SE_FRAME_SEGMENTS]} />
      <meshStandardMaterial
        ref={matRef}
        color="#e0fffa"
        emissive="#ffffff"
        emissiveIntensity={0}
        metalness={0.6}
        roughness={0.3}
      />
    </mesh>
  );
}
