/**
 * Portals — the four interactable gateways the swords "conjure" on the
 * wall they impacted. Visually a disc split into four pie-slice
 * quadrants centred on `clickHit.point`, each portal one quarter:
 *
 *   ╭───╮
 *   │NW │NE   ← top half: Projects (NW), About (NE)
 *   ├───┤
 *   │SW │SE   ← bottom half: Writing (SW), Simple Experience (SE)
 *   ╰───╯
 *
 * Three "section" portals (About, Projects, Writing) navigate via
 * react-router; the fourth, Simple Experience, flips `documentMode`
 * to true and is colored neutrally to read as a fourth-wall break.
 *
 * The whole disc lies flat on the cube wall the user clicked, with
 * a small offset along the wall's inward normal to avoid z-fighting.
 * A parent `<group>` carries the position + orientation; the four
 * pie children are `<circleGeometry>` meshes with `thetaStart` /
 * `thetaLength` set so the slices butt up against each other (with
 * a small angular GAP for visual cleanliness).
 *
 * Mounted only after `revealState === 'revealed'` and a non-null
 * `clickHit` is in the store — both gates always co-occur in
 * practice, but the explicit `clickHit` check keeps the type
 * narrowing clean.
 *
 * Phase 1: click trigger only. Click-lerp camera animation,
 * walk-through detection, and per-section 3D rooms come in
 * subsequent phases.
 */
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Quaternion, Vector3, type Group, type MeshStandardMaterial } from 'three';
import { useInteractable } from './Interactable';
import { useWorldStore } from '@/store';

/** Disc radius — fills roughly the visual extent of the VIBE
 *  formation. Tunable; 10 is a reasonable starting point. */
const PORTAL_RADIUS = 10;
/** Distance along the wall's inward normal to position the disc.
 *  Just enough to avoid z-fighting against the wall geometry. */
const PORTAL_NORMAL_OFFSET = 0.1;
/** Angular gap (radians) between pie slices, so they read as four
 *  distinct portals rather than a single solid disc. */
const PORTAL_GAP = 0.04;
/** CircleGeometry radial segments — higher = smoother arc edge. */
const PORTAL_SEGMENTS = 64;
/** A full quarter of the disc, less the angular gap on each side. */
const QUARTER = Math.PI / 2;

const HOVER_SCALE = 1.05;
const PRESS_SCALE = 0.97;
const SCALE_LERP_RATE = 12;
const IDLE_EMISSIVE = 0.7;
const HOVER_EMISSIVE = 1.5;
const PRESS_EMISSIVE = 2.5;
const SE_IDLE_EMISSIVE = 0;
const SE_HOVER_EMISSIVE = 0.3;
const SE_PRESS_EMISSIVE = 0.6;

interface PieConfig {
  id: string;
  /** Lower-left corner of the quarter in radians (counter-clockwise
   *  from +X). Each pie covers `[thetaStart, thetaStart + QUARTER]`. */
  thetaStart: number;
  /** Hex color for both `color` and `emissive`. */
  color: string;
}

const SECTION_PIES: ReadonlyArray<PieConfig & { path: string }> = [
  // NE quadrant (top-right): About.
  { id: 'portal-about', path: '/about', thetaStart: 0, color: '#00ffcc' },
  // NW quadrant (top-left): Projects.
  { id: 'portal-projects', path: '/projects', thetaStart: QUARTER, color: '#ff6ec7' },
  // SW quadrant (bottom-left): Writing.
  { id: 'portal-writing', path: '/writing', thetaStart: 2 * QUARTER, color: '#ffcc66' },
];

const SE_PIE: PieConfig = {
  id: 'portal-simple-experience',
  // SE quadrant (bottom-right) — picks up the layout's compass
  // mnemonic at the same time as the Simple Experience name. Neutral
  // off-white color so the slice reads as "different in kind" from
  // the three section quadrants.
  thetaStart: 3 * QUARTER,
  color: '#e0fffa',
};

export function Portals(): JSX.Element | null {
  const revealState = useWorldStore((s) => s.revealState);
  const clickHit = useWorldStore((s) => s.clickHit);

  // Disc lives where the swords landed. Both gates fire together in
  // practice — `revealState='revealed'` is set by RevealOrchestrator
  // only after `clickHit` was written — but the explicit clickHit
  // check narrows the type and short-circuits if state ever drifts.
  if (revealState !== 'revealed' || !clickHit) {
    return null;
  }

  return <PortalsDisc clickHit={clickHit} />;
}

interface PortalsDiscProps {
  clickHit: NonNullable<ReturnType<typeof useWorldStore.getState>['clickHit']>;
}

function PortalsDisc({ clickHit }: PortalsDiscProps): JSX.Element {
  // Position + orientation derive deterministically from clickHit.
  // We apply them imperatively via a ref instead of declarative props
  // because R3F's `quaternion` prop trips the eslint
  // `react/no-unknown-property` rule, and converting to Euler angles
  // every render is more code than just copying into the Group.
  const groupRef = useRef<Group>(null);
  const transform = useMemo(() => {
    const point = new Vector3(...clickHit.point);
    const normal = new Vector3(...clickHit.normal);
    // Float the disc a hair inward from the wall to dodge z-fighting.
    const pos = point.clone().addScaledVector(normal, PORTAL_NORMAL_OFFSET);
    // CircleGeometry's surface normal is +Z; rotate to point along
    // the wall's inward normal so the disc sits flat on the wall.
    const quat = new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), normal);
    return { position: pos, quaternion: quat };
  }, [clickHit.point, clickHit.normal]);

  useEffect(() => {
    const g = groupRef.current;
    if (!g) {
      return;
    }
    g.position.copy(transform.position);
    g.quaternion.copy(transform.quaternion);
  }, [transform]);

  return (
    <group ref={groupRef}>
      {SECTION_PIES.map((pie) => (
        <SectionPortalPie
          key={pie.id}
          id={pie.id}
          thetaStart={pie.thetaStart}
          color={pie.color}
          path={pie.path}
        />
      ))}
      <SimpleExperiencePortalPie thetaStart={SE_PIE.thetaStart} color={SE_PIE.color} />
    </group>
  );
}

interface SectionPortalPieProps {
  id: string;
  thetaStart: number;
  color: string;
  path: string;
}

function SectionPortalPie({ id, thetaStart, color, path }: SectionPortalPieProps): JSX.Element {
  const setPendingNavigation = useWorldStore((s) => s.setPendingNavigation);
  const { ref, isHovered, isPressed } = useInteractable({
    id,
    onInteract: () => setPendingNavigation(path),
  });

  return (
    <PortalPieMesh
      meshRef={ref}
      thetaStart={thetaStart}
      color={color}
      emissive={color}
      isHovered={isHovered}
      isPressed={isPressed}
      idleEmissive={IDLE_EMISSIVE}
      hoverEmissive={HOVER_EMISSIVE}
      pressEmissive={PRESS_EMISSIVE}
    />
  );
}

interface SimpleExperiencePortalPieProps {
  thetaStart: number;
  color: string;
}

/** The Simple Experience pie. Same geometry as the section pies, but
 *  toggles `documentMode` instead of routing and uses neutral white
 *  with no idle glow — telegraphs that this slice exits the 3D
 *  experience rather than navigating within it. */
function SimpleExperiencePortalPie({
  thetaStart,
  color,
}: SimpleExperiencePortalPieProps): JSX.Element {
  const setDocumentMode = useWorldStore((s) => s.setDocumentMode);
  const { ref, isHovered, isPressed } = useInteractable({
    id: SE_PIE.id,
    onInteract: () => setDocumentMode(true),
  });

  return (
    <PortalPieMesh
      meshRef={ref}
      thetaStart={thetaStart}
      color={color}
      emissive="#ffffff"
      isHovered={isHovered}
      isPressed={isPressed}
      idleEmissive={SE_IDLE_EMISSIVE}
      hoverEmissive={SE_HOVER_EMISSIVE}
      pressEmissive={SE_PRESS_EMISSIVE}
    />
  );
}

interface PortalPieMeshProps {
  meshRef: ReturnType<typeof useInteractable>['ref'];
  thetaStart: number;
  color: string;
  emissive: string;
  isHovered: boolean;
  isPressed: boolean;
  idleEmissive: number;
  hoverEmissive: number;
  pressEmissive: number;
}

/** Shared mesh body — both portal kinds use the same pie geometry
 *  and the same hover/press feedback math. The only differences are
 *  the colors + emissive intensities, which are passed in as props. */
function PortalPieMesh({
  meshRef,
  thetaStart,
  color,
  emissive,
  isHovered,
  isPressed,
  idleEmissive,
  hoverEmissive,
  pressEmissive,
}: PortalPieMeshProps): JSX.Element {
  const matRef = useRef<MeshStandardMaterial>(null);
  const renderedScale = useRef(1);

  useFrame((_state, delta) => {
    const mesh = meshRef.current;
    if (!mesh) {
      return;
    }
    const targetScale = isPressed ? PRESS_SCALE : isHovered ? HOVER_SCALE : 1;
    const k = 1 - Math.exp(-SCALE_LERP_RATE * delta);
    renderedScale.current += (targetScale - renderedScale.current) * k;
    mesh.scale.setScalar(renderedScale.current);

    const mat = matRef.current;
    if (mat) {
      mat.emissiveIntensity = isPressed ? pressEmissive : isHovered ? hoverEmissive : idleEmissive;
    }
  });

  return (
    <mesh ref={meshRef}>
      <circleGeometry
        args={[PORTAL_RADIUS, PORTAL_SEGMENTS, thetaStart + PORTAL_GAP / 2, QUARTER - PORTAL_GAP]}
      />
      <meshStandardMaterial
        ref={matRef}
        color={color}
        emissive={emissive}
        emissiveIntensity={idleEmissive}
        metalness={0.4}
        roughness={0.3}
        side={2}
      />
    </mesh>
  );
}
