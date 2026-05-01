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
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  Euler,
  Quaternion,
  Vector3,
  type Group,
  type MeshStandardMaterial,
  type Vector3Tuple,
} from 'three';
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
/** Per-pie rim emissive levels. The rim glows steadily at
 *  RIM_IDLE_EMISSIVE; hover/press push it brighter so the user gets
 *  a frame-level affordance in addition to the interior glow. */
const RIM_IDLE_EMISSIVE = 2.2;
const RIM_HOVER_EMISSIVE = 3.4;
const RIM_PRESS_EMISSIVE = 4.6;
/** Radial jitter applied to each particle's distance from center.
 *  Particles sit at PORTAL_RADIUS ± this; small enough that they
 *  cluster on the rim, large enough that they don't all line up. */
const PARTICLE_RADIAL_JITTER = 0.7;
/** Three particle layers per pie — varying counts, pixel sizes, and
 *  orbital speeds give a sense of depth + motion without needing a
 *  custom shader. The smallest layer dominates by count and moves
 *  the fastest (foreground sparkle); the largest layer is sparse
 *  and slow (anchor points). All sizes are screen-pixels with
 *  sizeAttenuation:false so they read as digital dots regardless
 *  of viewing distance. */
const PARTICLE_LAYERS: ReadonlyArray<{ count: number; size: number; speed: number }> = [
  { count: 60, size: 2, speed: 1.4 },
  { count: 35, size: 4, speed: 0.9 },
  { count: 15, size: 7, speed: 0.5 },
];

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

export const SECTION_PIES: ReadonlyArray<PieConfig & { path: string }> = [
  // NE quadrant (top-right): About — deep royal blue.
  { id: 'portal-about', path: '/about', thetaStart: 0, color: '#4169e1' },
  // NW quadrant (top-left): Projects.
  { id: 'portal-projects', path: '/projects', thetaStart: QUARTER, color: '#ff6ec7' },
  // SW quadrant (bottom-left): Writing.
  { id: 'portal-writing', path: '/writing', thetaStart: 2 * QUARTER, color: '#ffcc66' },
];

export const SE_PIE: PieConfig = {
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
  // We pass them as declarative props instead of imperatively via
  // ref so the component renders correctly outside of an R3F runtime
  // (e.g. in jsdom tests, where `<group>` is a plain DOM element
  // without `.position.copy`). The eslint complaint we hit earlier
  // was specifically about the `quaternion` prop — converting the
  // quaternion to Euler angles sidesteps that while keeping the
  // math at the same numerical fidelity.
  const transform = useMemo(() => {
    const normal = new Vector3(...clickHit.normal);
    // Float the disc a hair inward from the wall to dodge z-fighting.
    const pos = new Vector3(...clickHit.point).addScaledVector(normal, PORTAL_NORMAL_OFFSET);
    // CircleGeometry's surface normal is +Z; rotate to point along
    // the wall's inward normal so the disc sits flat on the wall.
    const quat = new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), normal);
    const euler = new Euler().setFromQuaternion(quat);
    return {
      position: [pos.x, pos.y, pos.z] as Vector3Tuple,
      rotation: [euler.x, euler.y, euler.z] as Vector3Tuple,
    };
  }, [clickHit.point, clickHit.normal]);

  return (
    <group position={transform.position} rotation={transform.rotation}>
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
      {/* Per-pie digital particle rings. Each pie carries its own
          color-matched dust along its arc; the whole ring slowly
          orbits the disc center. */}
      {SECTION_PIES.map((pie) => (
        <RimParticles key={`particles-${pie.id}`} thetaStart={pie.thetaStart} color={pie.color} />
      ))}
      <RimParticles thetaStart={SE_PIE.thetaStart} color={SE_PIE.color} />
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
  const setPortalTransit = useWorldStore((s) => s.setPortalTransit);
  const { ref, isHovered, isPressed } = useInteractable({
    id,
    // Don't navigate immediately — kick off a click-through camera
    // dolly via the store. PortalTransition (Canvas child) reads
    // this, runs the animation, then writes pendingNavigation when
    // the dolly completes so NavigationConsumer can dispatch.
    onInteract: () => setPortalTransit({ path, color }),
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
  const interiorMatRef = useRef<MeshStandardMaterial>(null);
  const rimMatRef = useRef<MeshStandardMaterial>(null);
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

    // Interior emissive (the "room" glow seeping through the window).
    const interiorMat = interiorMatRef.current;
    if (interiorMat) {
      interiorMat.emissiveIntensity = isPressed
        ? pressEmissive
        : isHovered
          ? hoverEmissive
          : idleEmissive;
    }
    // Rim emissive — frame brightens with the user's gaze so the
    // affordance still reads when the interior is dim. Modulated
    // independently of the interior because the two carry different
    // visual roles (frame vs. window).
    const rimMat = rimMatRef.current;
    if (rimMat) {
      rimMat.emissiveIntensity = isPressed
        ? RIM_PRESS_EMISSIVE
        : isHovered
          ? RIM_HOVER_EMISSIVE
          : RIM_IDLE_EMISSIVE;
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
          ref={interiorMatRef}
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
      <mesh position={[0, 0, RIM_Z_OFFSET]} rotation={[0, 0, thetaStart]}>
        <torusGeometry args={[PORTAL_RADIUS, RIM_TUBE, 8, 24, QUARTER]} />
        <meshStandardMaterial
          ref={rimMatRef}
          color={color}
          emissive={color}
          emissiveIntensity={RIM_IDLE_EMISSIVE}
        />
      </mesh>
    </group>
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

interface RimParticlesProps {
  thetaStart: number;
  color: string;
}

/**
 * Per-pie particle field on the outer rim. Three independent layers
 * (small/many/fast → large/few/slow) give parallax depth and
 * digital crispness without a custom shader: each layer is its own
 * <points> + <group>, the group rotation is driven at the layer's
 * own speed, and sizes are fixed screen-pixels (sizeAttenuation:false)
 * so dots stay sharp regardless of viewing distance. Color matches
 * the pie's rim — each quadrant carries its own particle palette.
 */
function RimParticles({ thetaStart, color }: RimParticlesProps): JSX.Element {
  return (
    <>
      {PARTICLE_LAYERS.map((layer, i) => (
        <RimParticleLayer
          key={i}
          thetaStart={thetaStart}
          color={color}
          count={layer.count}
          size={layer.size}
          speed={layer.speed}
        />
      ))}
    </>
  );
}

interface RimParticleLayerProps {
  thetaStart: number;
  color: string;
  count: number;
  size: number;
  speed: number;
}

function RimParticleLayer({
  thetaStart,
  color,
  count,
  size,
  speed,
}: RimParticleLayerProps): JSX.Element {
  const groupRef = useRef<Group>(null);
  // Pre-compute particle positions once per mount — they're random
  // within the pie's arc but otherwise stable; per-frame motion
  // happens via group rotation, not by re-randomizing positions.
  const positions = useMemo(() => {
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const theta = thetaStart + Math.random() * QUARTER;
      const r = PORTAL_RADIUS + (Math.random() * 2 - 1) * PARTICLE_RADIAL_JITTER;
      arr[i * 3] = Math.cos(theta) * r;
      arr[i * 3 + 1] = Math.sin(theta) * r;
      arr[i * 3 + 2] = RIM_Z_OFFSET;
    }
    return arr;
  }, [thetaStart, count]);

  useFrame((_state, delta) => {
    const g = groupRef.current;
    if (!g) {
      return;
    }
    g.rotation.z += speed * delta;
  });

  return (
    <group ref={groupRef}>
      <points>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        </bufferGeometry>
        <pointsMaterial
          color={color}
          size={size}
          // eslint-disable-next-line react/no-unknown-property
          sizeAttenuation={false}
          transparent
        />
      </points>
    </group>
  );
}
