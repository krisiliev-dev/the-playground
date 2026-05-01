/**
 * SpatialAudioListener — pumps the camera pose into the SfxManager's
 * AudioContext listener each frame.
 *
 * Mounts inside the R3F tree (so `useFrame` runs) and reads the live
 * camera. The listener's forward/up vectors are derived from the
 * camera's quaternion: forward = local -Z rotated into world, up =
 * local +Y rotated into world. Without this, all PannerNode-attached
 * cues would render as if the listener were at the origin facing -Z,
 * regardless of where the camera actually is — which means stereo
 * panning wouldn't follow the camera and the impact wall would sound
 * like it's behind you when you look at it.
 */
import { useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import { Vector3 } from 'three';
import { useWorldStore } from '@/store';
import { sfx } from './SfxManager';

const tmpFwd = new Vector3();
const tmpUp = new Vector3();

export function SpatialAudioListener(): null {
  // Cube-room reverb IR is regenerated whenever the world dimensions
  // change, so first-reflection delay always matches the actual cube
  // edge length. (Effect runs once at mount + on dimension change.)
  const dimensions = useWorldStore((s) => s.environment.dimensions);
  useEffect(() => {
    sfx.setRoomSize(dimensions[0]);
  }, [dimensions]);

  useFrame(({ camera }) => {
    tmpFwd.set(0, 0, -1).applyQuaternion(camera.quaternion);
    tmpUp.set(0, 1, 0).applyQuaternion(camera.quaternion);
    sfx.setListenerPose(
      camera.position.x,
      camera.position.y,
      camera.position.z,
      tmpFwd.x,
      tmpFwd.y,
      tmpFwd.z,
      tmpUp.x,
      tmpUp.y,
      tmpUp.z,
    );
  });
  return null;
}
