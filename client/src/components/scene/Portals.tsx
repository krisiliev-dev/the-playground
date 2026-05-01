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
/** CircleGeometry radial segments — higher = smoother arc edge. */
const PORTAL_SEGMENTS = 64;
/** A full quarter of the disc. Pies butt up against each other
 *  (no angular gap); the radial spokes drawn on top form the
 *  visible boundary between adjacent quadrants. */
const QUARTER = Math.PI / 2;
/** Tube thickness for the per-pie outer arc rim. */
const RIM_TUBE = 0.18;
/** Tube thickness for the 4 white radial spokes. */
const SPOKE_TUBE = 0.12;
/** Slight z-offset for rim + spokes vs. the pie interior, to keep
 *  them visually on top without z-fighting. */
const RIM_Z_OFFSET = 0.04;

const HOVER_SCALE = 1.05;
const PRESS_SCALE = 0.97;
const SCALE_LERP_RATE = 12;
/** Pie interior emissive levels. The darkened body lets a subtle
 *  section-color glow seep through; hover/press just push that glow
 *  brighter. The "real" colored visual is the outer arc rim. */
const IDLE_EMISSIVE = 0.15;
const HOVER_EMISSIVE = 0.5;
const PRESS_EMISSIVE = 1.0;
const SE_IDLE_EMISSIVE = 0.05;
const SE_HOVER_EMISSIVE = 0.25;
const SE_PRESS_EMISSIVE = 0.5;

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
      {/* Four white spokes between adjacent pies, plus a center hub.
          Together with each pie's outer RimArc, they form the
          glowing four-quadrant frame the user described. */}
      {[0, 1, 2, 3].map((i) => (
        <RadialSpoke key={`spoke-${i}`} angle={i * QUARTER} />
      ))}
      <CenterHub />
    </group>
  );
}

/** Small glowing disc at the centre where all four pies meet — caps
 *  the radial spokes' inner ends so the joint reads as a clean hub
 *  rather than four overlapping cylinder ends. */
function CenterHub(): JSX.Element {
  return (
    <mesh position={[0, 0, RIM_Z_OFFSET]}>
      <circleGeometry args={[SPOKE_TUBE * 2, 16]} />
      <meshStandardMaterial color="#ffffff" emissive="#ffffff" emissiveIntensity={2.5} />
    </mesh>
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
    <group>
      {/* Pie interior — darkened so the rim reads as the bright
          element. The section colour seeps through as a low-intensity
          emissive glow, suggesting depth/atmosphere "through" the
          portal rather than a solid coloured panel. */}
      <mesh ref={meshRef}>
        <circleGeometry args={[PORTAL_RADIUS, PORTAL_SEGMENTS, thetaStart, QUARTER]} />
        <meshStandardMaterial
          ref={matRef}
          color="#0a0a12"
          emissive={emissive}
          emissiveIntensity={idleEmissive}
          metalness={0.5}
          roughness={0.5}
          side={2}
        />
      </mesh>
      {/* Outer arc rim — the per-pie colored glowing edge. Floats
          slightly forward of the interior so it visually crowns the
          pie without z-fighting. */}
      <RimArc thetaStart={thetaStart} color={color} />
    </group>
  );
}

interface RimArcProps {
  thetaStart: number;
  color: string;
}

/** A single quarter-arc tube hugging the outer edge of one pie.
 *  Default torusGeometry starts its arc at angle 0; we rotate the
 *  whole mesh by `thetaStart` to align the arc with the pie below. */
function RimArc({ thetaStart, color }: RimArcProps): JSX.Element {
  return (
    <mesh position={[0, 0, RIM_Z_OFFSET]} rotation={[0, 0, thetaStart]}>
      <torusGeometry args={[PORTAL_RADIUS, RIM_TUBE, 8, 24, QUARTER]} />
      <meshStandardMaterial color={color} emissive={color} emissiveIntensity={2.2} />
    </mesh>
  );
}

/** A single radial spoke — thin glowing line from disc centre out to
 *  the rim, sitting on top of the boundary between two adjacent pies.
 *  Four of these (at 0, 90, 180, 270) plus the four arc rims form a
 *  complete glowing frame around each pie quadrant. */
interface RadialSpokeProps {
  angle: number;
}

function RadialSpoke({ angle }: RadialSpokeProps): JSX.Element {
  // Default cylinderGeometry's axis is +Y. We need it pointing
  // outward at `angle`, so rotate by `angle - π/2` around Z (which
  // sends +Y → (cos angle, sin angle)) and translate the centre to
  // the spoke's midpoint.
  const half = PORTAL_RADIUS / 2;
  return (
    <mesh
      position={[Math.cos(angle) * half, Math.sin(angle) * half, RIM_Z_OFFSET]}
      rotation={[0, 0, angle - Math.PI / 2]}
    >
      <cylinderGeometry args={[SPOKE_TUBE, SPOKE_TUBE, PORTAL_RADIUS, 8]} />
      <meshStandardMaterial color="#ffffff" emissive="#ffffff" emissiveIntensity={1.8} />
    </mesh>
  );
}
