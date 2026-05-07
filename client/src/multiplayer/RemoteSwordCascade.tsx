/**
 * Visible cascade for remote players (per ADR-006).
 *
 * Subscribes to inbound `sword_swing` and `sword_impact` events
 * and renders a stripped-down version of the local reveal
 * cascade. Each swing produces a streak: a thin cylinder
 * oriented along from→to, with a drei `<Trail>` behind it,
 * animating linearly over `REMOTE_STREAK_DURATION_S`. Each
 * impact produces a brief spark sprite at the wall.
 *
 * Why simpler than the local cascade: a third-person observer
 * just needs to read "they did the cascade." The local version
 * has GLB models, Catmull-Rom curves, italics tilt, helicopter
 * spin, and kinematic-driven flying audio — none of which
 * survive translation to a 1m-tall sprite at 60 metres' remove.
 * Strip down to a streak + trail and the signal still lands.
 *
 * Per-cascade burst note: the local cascade fires 12 swings in
 * ~0.6s. The server's sword_swing rate limit was bumped to
 * 30/sec so all 12 propagate; we render up to 12 simultaneous
 * streaks here.
 *
 * Mounted inside the R3F canvas (in `World.tsx`), distinct
 * from the non-canvas `MultiplayerEffectsReceiver` which only
 * wires audio and shake.
 */
import { useEffect, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Trail } from '@react-three/drei';
import { AdditiveBlending, type Group, type Mesh, type Sprite, Vector3 } from 'three';
import type { EntityId } from './types';
import { useSceneEvent } from './sceneEvents';
import {
  REMOTE_SPARK_DURATION_S,
  REMOTE_STREAK_TOTAL_S,
  computeSparkFrame,
  computeStreakFrame,
} from './remoteSwordCascadeMath';

interface RemoteStreak {
  id: number;
  actorId: EntityId | null;
  from: [number, number, number];
  to: [number, number, number];
  startedAt: number;
}

interface RemoteSpark {
  id: number;
  position: [number, number, number];
  startedAt: number;
}

let nextId = 0;
function makeId(): number {
  nextId += 1;
  return nextId;
}

export function RemoteSwordCascade(): JSX.Element {
  const [streaks, setStreaks] = useState<RemoteStreak[]>([]);
  const [sparks, setSparks] = useState<RemoteSpark[]>([]);

  useSceneEvent('sword_swing', (event, actorId) => {
    setStreaks((prev) => [
      ...prev,
      {
        id: makeId(),
        actorId,
        from: event.from,
        to: event.to,
        startedAt: performance.now() / 1000,
      },
    ]);
  });

  useSceneEvent('sword_impact', (event) => {
    setSparks((prev) => [
      ...prev,
      {
        id: makeId(),
        position: event.position,
        startedAt: performance.now() / 1000,
      },
    ]);
  });

  // Sweep expired streaks/sparks once per frame. Cheap (small
  // arrays); we filter rather than mutate so React re-renders.
  useFrame(() => {
    const now = performance.now() / 1000;
    setStreaks((prev) => {
      const next = prev.filter((s) => now - s.startedAt < REMOTE_STREAK_TOTAL_S);
      return next.length === prev.length ? prev : next;
    });
    setSparks((prev) => {
      const next = prev.filter((s) => now - s.startedAt < REMOTE_SPARK_DURATION_S);
      return next.length === prev.length ? prev : next;
    });
  });

  return (
    <>
      {streaks.map((s) => (
        <RemoteStreakVisual key={s.id} streak={s} />
      ))}
      {sparks.map((s) => (
        <RemoteSparkVisual key={s.id} spark={s} />
      ))}
    </>
  );
}

interface StreakVisualProps {
  streak: RemoteStreak;
}

function RemoteStreakVisual({ streak }: StreakVisualProps): JSX.Element {
  const groupRef = useRef<Group>(null);
  const meshRef = useRef<Mesh>(null);
  const fromVec = useRef(new Vector3(...streak.from)).current;
  const toVec = useRef(new Vector3(...streak.to)).current;
  const tmp = useRef(new Vector3()).current;

  useFrame(() => {
    const group = groupRef.current;
    const mesh = meshRef.current;
    if (!group || !mesh) {
      return;
    }
    const elapsed = performance.now() / 1000 - streak.startedAt;
    const { progress, opacity } = computeStreakFrame(elapsed);
    tmp.copy(fromVec).lerp(toVec, progress);
    group.position.copy(tmp);

    // Orient cylinder along the streak axis. Cylinder local axis
    // is +Y; we point that toward (to - from) so the elongated
    // body reads as a blade flying tip-first.
    tmp.copy(toVec).sub(fromVec);
    if (tmp.lengthSq() > 1e-6) {
      tmp.normalize();
      group.up.set(0, 1, 0);
      // Build a target point a bit along the direction and use
      // lookAt with the +Y axis aligned via a temporary offset.
      const target = group.position.clone().add(tmp);
      group.lookAt(target);
      // lookAt aligns +Z to the target; rotate so +Y leads.
      group.rotateX(Math.PI / 2);
    }

    const mat = (mesh.material as { opacity?: number; transparent?: boolean }) ?? {};
    if (typeof mat.opacity === 'number') {
      mat.opacity = opacity;
    }
  });

  return (
    <Trail
      width={0.6}
      color="#00ffcc"
      length={0.8}
      decay={1}
      attenuation={(t) => t * t}
    >
      <group ref={groupRef}>
        <mesh ref={meshRef}>
          {/* Slim, long cylinder reads as a blade streak. The
              radius is intentionally small so the trail
              dominates visually — the body is just enough to
              anchor the trail's tip. */}
          <cylinderGeometry args={[0.15, 0.15, 4, 8]} />
          <meshBasicMaterial
            color="#aaffee"
            transparent
            opacity={0}
            blending={AdditiveBlending}
            depthWrite={false}
          />
        </mesh>
      </group>
    </Trail>
  );
}

interface SparkVisualProps {
  spark: RemoteSpark;
}

function RemoteSparkVisual({ spark }: SparkVisualProps): JSX.Element {
  const spriteRef = useRef<Sprite>(null);

  useEffect(() => {
    const sprite = spriteRef.current;
    if (sprite) {
      sprite.position.set(...spark.position);
    }
  }, [spark.position]);

  useFrame(() => {
    const sprite = spriteRef.current;
    if (!sprite) {
      return;
    }
    const elapsed = performance.now() / 1000 - spark.startedAt;
    const { scale, opacity } = computeSparkFrame(elapsed);
    sprite.scale.setScalar(scale);
    const mat = sprite.material;
    if (mat) {
      mat.opacity = opacity;
    }
  });

  return (
    <sprite ref={spriteRef}>
      <spriteMaterial
        color="#00ffcc"
        transparent
        opacity={0}
        blending={AdditiveBlending}
        depthWrite={false}
      />
    </sprite>
  );
}
