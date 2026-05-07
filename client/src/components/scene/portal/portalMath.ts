/**
 * Pure math for portal endpoints — walk-cross detection, plane
 * geometry, and the source-to-destination teleport transform.
 *
 * All functions are pure. They take Vector3 / Quaternion instances
 * (or plain tuples on the read side) and return new values. No
 * scene access, no THREE.Object3D mutations — that lives in the
 * R3F components that consume these.
 *
 * The conventions:
 *
 *   - Endpoints are oriented by their `quaternion`. Local +Z is the
 *     active-side normal; local +X / +Y are the rectangle's width
 *     and height axes.
 *   - "World" coordinates here are actually CUBE-LOCAL, since
 *     endpoint poses are authored in the cube frame. The caller
 *     compensates for the cube's bob (per `floatBob.ts`) before
 *     handing positions to these functions.
 *
 * The "R₁₈₀-around-Y flip":
 *
 *   Paired portals are identified front-to-front, the way two
 *   facing windows would be. Mathematically this is a 180° rotation
 *   around the portals' shared up axis (local Y). For our test
 *   config (both portals' local Y = world up) the flip is just
 *   negating local X and Z while keeping Y. The math is general,
 *   though — it works for any pair as long as both endpoints'
 *   local Y axes agree on what "up" means.
 */
import { Quaternion, Vector3 } from 'three';
import type { PortalEndpoint, PortalTrigger } from '@/content/portals';

const SCRATCH_NORMAL = new Vector3();
const SCRATCH_TO_PLAYER = new Vector3();
const SCRATCH_LOCAL = new Vector3();
const SCRATCH_QUAT = new Quaternion();
const LOCAL_Z = new Vector3(0, 0, 1);

/**
 * Lift a cube-local endpoint into world space by adding the cube's
 * current bob offset to its Y. Pure — returns a fresh endpoint;
 * the input is unchanged.
 *
 * Why this exists: portal endpoints are authored in CUBE-LOCAL
 * coords (so they move with the cube's geometry), but every math
 * function in this module takes WORLD-frame positions. The cube
 * bobs vertically each frame, so callers that consume endpoints
 * inside `useFrame` need to translate the endpoint's Y by the
 * current bob offset before feeding it to crossing detection,
 * leap planning, or vCam composition. Centralising the lift means
 * a future change to bob (e.g. multi-axis, per-room amplitude)
 * touches one place instead of N callsites.
 */
export function bobbedEndpoint(ep: PortalEndpoint, bobY: number): PortalEndpoint {
  return {
    ...ep,
    position: [ep.position[0], ep.position[1] + bobY, ep.position[2]],
  };
}

/**
 * World-space active-side normal of an endpoint. The local +Z axis
 * rotated by the endpoint's quaternion. Allocates a new Vector3.
 */
export function portalNormal(endpoint: PortalEndpoint): Vector3 {
  const q = SCRATCH_QUAT.set(
    endpoint.quaternion[0],
    endpoint.quaternion[1],
    endpoint.quaternion[2],
    endpoint.quaternion[3],
  );
  return new Vector3().copy(LOCAL_Z).applyQuaternion(q);
}

/**
 * Signed perpendicular distance from `pos` to the endpoint's plane.
 * Positive = on the active side (in front of local +Z); negative =
 * behind. Zero = on the plane.
 */
export function signedDistanceToPortal(
  pos: { x: number; y: number; z: number },
  endpoint: PortalEndpoint,
): number {
  SCRATCH_NORMAL.copy(LOCAL_Z).applyQuaternion(
    SCRATCH_QUAT.set(
      endpoint.quaternion[0],
      endpoint.quaternion[1],
      endpoint.quaternion[2],
      endpoint.quaternion[3],
    ),
  );
  SCRATCH_TO_PLAYER.set(
    pos.x - endpoint.position[0],
    pos.y - endpoint.position[1],
    pos.z - endpoint.position[2],
  );
  return SCRATCH_TO_PLAYER.dot(SCRATCH_NORMAL);
}

/**
 * Is `pos` on the endpoint's active side?
 *
 * Returns `true` when `signedDistanceToPortal(pos, endpoint) >= 0`
 * (strictly in front of, or exactly on, the active-side plane). This
 * is the primary visibility predicate for single-sided portals: from
 * the inactive side the cascade skips the through-view entirely so
 * the back of the portal reads as transparent.
 *
 * The half-open boundary (`0` counts as active) is the more forgiving
 * choice for float near-misses than `> 0`: a player or camera that
 * lands exactly on the plane is treated as having stepped just onto
 * the active side, never as briefly invisible.
 */
export function isOnActiveSide(
  pos: { x: number; y: number; z: number },
  endpoint: PortalEndpoint,
): boolean {
  return signedDistanceToPortal(pos, endpoint) >= 0;
}

/**
 * Plan a click-to-portal leap target.
 *
 * Returns a world-space point one `overshoot` unit past the portal's
 * plane in the direction the avatar would travel to cross — i.e. the
 * spot a "leap into the portal" should aim for so the natural walk-
 * through crossing detector picks up the cross mid-leap.
 *
 * Side gating:
 *   - **Single-sided + avatar on inactive side**: returns `null`. The
 *     back of a one-sided portal isn't a valid entry point — its
 *     through-view is intentionally transparent, so a click here
 *     should be a no-op rather than send the avatar leaping past a
 *     surface they can't actually enter.
 *   - **Single-sided + avatar on active side**: target lies on the
 *     inactive side of the plane (`source.position - normal * overshoot`).
 *   - **Double-sided**: leap is always valid; target lies on whichever
 *     side the avatar is *not* currently on. `signedDistanceToPortal`
 *     determines the sign.
 *
 * Pure: takes plain numerics and an endpoint, returns a tuple. No
 * scene access. Bob compensation is the caller's responsibility — pass
 * a bob-shifted endpoint if the world is animated.
 */
export function planPortalLeap(
  avatarPos: { x: number; y: number; z: number },
  source: PortalEndpoint,
  overshoot: number,
): [number, number, number] | null {
  if (source.sidedness === 'single' && !isOnActiveSide(avatarPos, source)) {
    return null;
  }
  const normal = portalNormal(source);
  // sign = -1 when avatar is on (or above) the active side: step in
  // -normal to land on the inactive side, where the walk-through
  // crossing detector wants the target. sign = +1 when avatar is on
  // the inactive side of a double-sided portal: step in +normal to
  // cross to the active side.
  const sd = signedDistanceToPortal(avatarPos, source);
  const sign = sd >= 0 ? -1 : 1;
  return [
    source.position[0] + normal.x * sign * overshoot,
    source.position[1] + normal.y * sign * overshoot,
    source.position[2] + normal.z * sign * overshoot,
  ];
}

/**
 * Project `pos` onto the endpoint's plane and convert to the
 * endpoint's local frame. Returns the (x, y) coordinates within
 * the rectangle's local axes — local x is "right", local y is
 * "up". If the projection lies inside the rectangle, both
 * coordinates are within ±size/2.
 */
export function localPlanePos(
  pos: { x: number; y: number; z: number },
  endpoint: PortalEndpoint,
): { x: number; y: number } {
  SCRATCH_QUAT.set(
    endpoint.quaternion[0],
    endpoint.quaternion[1],
    endpoint.quaternion[2],
    endpoint.quaternion[3],
  ).invert();
  SCRATCH_LOCAL.set(
    pos.x - endpoint.position[0],
    pos.y - endpoint.position[1],
    pos.z - endpoint.position[2],
  ).applyQuaternion(SCRATCH_QUAT);
  return { x: SCRATCH_LOCAL.x, y: SCRATCH_LOCAL.y };
}

/**
 * Whether `pos` projects to a point inside the rectangle. Inclusive
 * bounds — a point exactly on the edge counts as inside.
 */
export function isInsideRectangle(
  pos: { x: number; y: number; z: number },
  endpoint: PortalEndpoint,
): boolean {
  const { x, y } = localPlanePos(pos, endpoint);
  return Math.abs(x) <= endpoint.size.width / 2 && Math.abs(y) <= endpoint.size.height / 2;
}

/**
 * Compute the world-space pose a player should land at when they
 * walk through `source` and emerge at `destination`. The R₁₈₀-around-Y
 * flip is applied so paired portals identify front-to-front: a
 * player approaching source from the active side emerges from
 * destination's active side, walking forward.
 *
 * Inputs:
 *   - `worldPos`: the player's world position at the moment of
 *     crossing.
 *   - `worldYaw`: the player's yaw (rotation around world up).
 *
 * Outputs:
 *   - `position`: the new world position.
 *   - `yaw`: the new world yaw.
 *
 * Math: in the source's local frame, negate x and z (R₁₈₀_Y),
 * keep y. Re-anchor at destination.
 */
export function teleportPose(
  worldPos: { x: number; y: number; z: number },
  worldYaw: number,
  source: PortalEndpoint,
  destination: PortalEndpoint,
): { position: { x: number; y: number; z: number }; yaw: number } {
  const sourceQuat = new Quaternion(
    source.quaternion[0],
    source.quaternion[1],
    source.quaternion[2],
    source.quaternion[3],
  );
  const destQuat = new Quaternion(
    destination.quaternion[0],
    destination.quaternion[1],
    destination.quaternion[2],
    destination.quaternion[3],
  );

  // Position: world → source local → flip → dest world
  const local = new Vector3(
    worldPos.x - source.position[0],
    worldPos.y - source.position[1],
    worldPos.z - source.position[2],
  ).applyQuaternion(sourceQuat.clone().invert());
  // R₁₈₀ around local Y: negate x and z, keep y.
  const flipped = new Vector3(-local.x, local.y, -local.z);
  const newWorld = flipped
    .applyQuaternion(destQuat)
    .add(new Vector3(destination.position[0], destination.position[1], destination.position[2]));

  // Yaw: source-local yaw → flip 180° around Y → re-anchor in dest
  // frame. For the common case (portals with up = world up) this
  // simplifies to `destYaw + (sourceYaw_relative + π)` — but we keep
  // it general by composing quaternions.
  const playerQuat = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), worldYaw);
  const flipQ = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI);
  const newPlayerQuat = destQuat
    .clone()
    .multiply(flipQ)
    .multiply(sourceQuat.clone().invert())
    .multiply(playerQuat);
  // Extract yaw from the resulting quaternion. For a quaternion
  // representing only Y-axis rotation, yaw = 2 * atan2(qy, qw).
  // Composing portals with non-Y rotations would technically
  // produce a quaternion outside that subgroup — for our v1
  // (portals on walls, up = world up) this is exact.
  const yaw = 2 * Math.atan2(newPlayerQuat.y, newPlayerQuat.w);
  return {
    position: { x: newWorld.x, y: newWorld.y, z: newWorld.z },
    yaw,
  };
}

/**
 * Compute the world-space pose of a virtual camera that renders
 * the destination's view as it would appear from the source's
 * perspective. Same R₁₈₀_Y identification as `teleportPose`, but
 * applied to a full 3D pose (position + arbitrary quaternion)
 * instead of just a yaw value — so the player's pitch/roll
 * propagate into the through-view correctly.
 *
 * Used by the per-frame portal renderer: each frame the player's
 * camera pose is fed in, and the returned virtual cam pose drives
 * the offscreen render-to-FBO of the destination scene.
 *
 * Note on bob: positions are expected in WORLD frame here. Callers
 * compose the cube's bob offset into the source/destination
 * position before calling, so this function stays unaware of bob
 * specifics.
 */
export function virtualCameraPose(
  cameraWorldPos: { x: number; y: number; z: number },
  cameraWorldQuat: { x: number; y: number; z: number; w: number },
  source: PortalEndpoint,
  destination: PortalEndpoint,
): {
  position: { x: number; y: number; z: number };
  quaternion: { x: number; y: number; z: number; w: number };
} {
  const sourceQuat = new Quaternion(
    source.quaternion[0],
    source.quaternion[1],
    source.quaternion[2],
    source.quaternion[3],
  );
  const destQuat = new Quaternion(
    destination.quaternion[0],
    destination.quaternion[1],
    destination.quaternion[2],
    destination.quaternion[3],
  );

  const local = new Vector3(
    cameraWorldPos.x - source.position[0],
    cameraWorldPos.y - source.position[1],
    cameraWorldPos.z - source.position[2],
  ).applyQuaternion(sourceQuat.clone().invert());
  // R₁₈₀_Y in source local frame.
  const flipped = new Vector3(-local.x, local.y, -local.z);
  const newWorld = flipped
    .applyQuaternion(destQuat)
    .add(new Vector3(destination.position[0], destination.position[1], destination.position[2]));

  // Quaternion: same flip composition as `teleportPose`, but
  // applied to the full camera quaternion (preserves pitch/roll).
  const flipQ = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI);
  const playerQ = new Quaternion(
    cameraWorldQuat.x,
    cameraWorldQuat.y,
    cameraWorldQuat.z,
    cameraWorldQuat.w,
  );
  const newQuat = destQuat
    .clone()
    .multiply(flipQ)
    .multiply(sourceQuat.clone().invert())
    .multiply(playerQ);

  return {
    position: { x: newWorld.x, y: newWorld.y, z: newWorld.z },
    quaternion: { x: newQuat.x, y: newQuat.y, z: newQuat.z, w: newQuat.w },
  };
}

/** Result of a successful walk-cross detection.
 *
 * Discriminated by `kind`:
 *   - `'teleport'`: standard portal — caller applies `teleportPose`
 *     to land at `destination`.
 *   - `'trigger'`: side-effect endpoint (Simple Experience portal) —
 *     caller fires the matching action; no teleport happens.
 *
 * Splitting via the union keeps `destination` non-nullable on the
 * teleport branch, so callers don't need to defensive-null-check it.
 */
export type PortalCrossing =
  | {
      readonly kind: 'teleport';
      /** Endpoint the player walked through. */
      readonly source: PortalEndpoint;
      /** Endpoint they emerge from. */
      readonly destination: PortalEndpoint;
      /** New world position to snap the player to. */
      readonly position: { x: number; y: number; z: number };
      /** New world yaw. */
      readonly yaw: number;
    }
  | {
      readonly kind: 'trigger';
      /** Endpoint the player walked through. */
      readonly source: PortalEndpoint;
      /** Which trigger to fire — mirrors `source.trigger`, lifted
       *  here so consumers don't have to re-read the source. */
      readonly trigger: PortalTrigger;
    };

/**
 * Per-frame walk-cross detection. Given the player's previous and
 * current positions, returns the portal crossing — if any.
 *
 * Conditions for a crossing:
 *   1. Sign flip in the player's signed distance to the endpoint's
 *      plane between frames (prev > 0 → cur ≤ 0, OR the reverse).
 *   2. The crossing's plane projection lies inside the rectangle.
 *   3. For `sidedness === 'single'` endpoints, the crossing must
 *      be from the active side (prev > 0 → cur ≤ 0). Inactive-side
 *      crossings on single-sided endpoints return null — the
 *      player passes through with no teleport.
 *   4. For teleport endpoints, the paired endpoint must resolve.
 *      Trigger endpoints (e.g. Simple Experience) skip this check
 *      since there's no destination.
 *
 * Returns the first matching crossing. Endpoints on coplanar walls
 * are unlikely to overlap in our config, so order is unambiguous
 * in practice.
 */
export function findCrossedPortal(
  prevPos: { x: number; y: number; z: number },
  curPos: { x: number; y: number; z: number },
  endpoints: ReadonlyArray<PortalEndpoint>,
): PortalCrossing | null {
  for (const ep of endpoints) {
    const prevDist = signedDistanceToPortal(prevPos, ep);
    const curDist = signedDistanceToPortal(curPos, ep);

    // Sign flip required. We treat 0 as "on the plane" — a flip
    // from positive to exactly 0, or from exactly 0 to negative,
    // counts as crossing.
    const fromActive = prevDist > 0 && curDist <= 0;
    const fromInactive = prevDist < 0 && curDist >= 0;
    if (!fromActive && !fromInactive) {
      continue;
    }

    // Sidedness gate.
    if (ep.sidedness === 'single' && !fromActive) {
      continue;
    }

    // Bounds: project the crossing point onto the plane and check
    // it sits inside the rectangle. We use the current position as
    // an approximation — true crossings are usually within
    // sub-frame distance of the plane, so the tangent component is
    // dominant in either prev or cur.
    if (!isInsideRectangle(curPos, ep)) {
      continue;
    }

    // Trigger endpoints short-circuit the teleport path — no pairing
    // required, no pose computation. The caller dispatches on
    // `source.trigger` to run whatever side effect the trigger names.
    if (ep.trigger) {
      return { kind: 'trigger', source: ep, trigger: ep.trigger };
    }

    // Pairing must be valid for teleport endpoints. Reciprocity is
    // NOT required — chain-style pairing (A→B→C→A) is a valid graph
    // and all three exits are well-defined even though no edge is
    // two-way.
    const paired = endpoints.find((other) => other.id === ep.pairedWith);
    if (!paired) {
      continue;
    }

    // Compute the teleport pose. Yaw at crossing time isn't tracked
    // here — that's a per-call argument when the avatar applies the
    // transform. For the cross detection function, we expose yaw=0
    // and let the caller re-derive yaw using `teleportPose` with
    // the avatar's actual yaw.
    const { position } = teleportPose(curPos, 0, ep, paired);
    return {
      kind: 'teleport',
      source: ep,
      destination: paired,
      position,
      yaw: 0,
    };
  }
  return null;
}
