/**
 * SpatialAudioListener — verifies that mounting the component:
 *   - Calls `sfx.setRoomSize(dimensions[0])` on mount + dimension changes.
 *   - Registers a `useFrame` callback that pumps camera pose into
 *     `sfx.setListenerPose` with derived forward/up vectors.
 *
 * The listener renders nothing visible; we test the side effects.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { Quaternion, Vector3 } from 'three';

// `vi.mock` is hoisted above normal `const` declarations — wrap
// shared state in `vi.hoisted` so the spies + frame-callback ref
// hoist alongside.
const mocks = vi.hoisted(() => ({
  setListenerPoseSpy: vi.fn(),
  setRoomSizeSpy: vi.fn(),
  frameRef: { current: null as ((state: unknown) => void) | null },
}));

vi.mock('@/components/audio/SfxManager', () => ({
  sfx: {
    setListenerPose: mocks.setListenerPoseSpy,
    setRoomSize: mocks.setRoomSizeSpy,
  },
}));

vi.mock('@react-three/fiber', () => ({
  useFrame: (cb: (state: unknown) => void) => {
    mocks.frameRef.current = cb;
  },
}));

import { SpatialAudioListener } from '@/components/audio/SpatialAudioListener';
import { useWorldStore } from '@/store';

describe('SpatialAudioListener', () => {
  beforeEach(() => {
    mocks.setListenerPoseSpy.mockClear();
    mocks.setRoomSizeSpy.mockClear();
    mocks.frameRef.current = null;
  });

  it('renders nothing visible (returns null)', () => {
    const { container } = render(<SpatialAudioListener />);
    expect(container.innerHTML).toBe('');
  });

  it('calls setRoomSize on mount with the cube X dimension', () => {
    const dims = useWorldStore.getState().environment.dimensions;
    render(<SpatialAudioListener />);
    expect(mocks.setRoomSizeSpy).toHaveBeenCalledWith(dims[0]);
  });

  it('registers a useFrame callback that pumps listener pose', () => {
    render(<SpatialAudioListener />);
    expect(mocks.frameRef.current).not.toBeNull();

    // Identity quaternion → forward = -Z, up = +Y.
    mocks.frameRef.current!({
      camera: {
        position: new Vector3(1, 2, 3),
        quaternion: new Quaternion(0, 0, 0, 1),
      },
    });

    expect(mocks.setListenerPoseSpy).toHaveBeenCalledTimes(1);
    const args = mocks.setListenerPoseSpy.mock.calls[0]!;
    expect(args[0]).toBe(1);
    expect(args[1]).toBe(2);
    expect(args[2]).toBe(3);
    expect(args[3]).toBeCloseTo(0); // fwdX
    expect(args[4]).toBeCloseTo(0); // fwdY
    expect(args[5]).toBeCloseTo(-1); // fwdZ
    expect(args[6]).toBeCloseTo(0); // upX
    expect(args[7]).toBeCloseTo(1); // upY
    expect(args[8]).toBeCloseTo(0); // upZ
  });

  it('rotates forward/up correctly when the camera yaws 90° to the right', () => {
    render(<SpatialAudioListener />);
    // Yaw 90° around +Y → camera local -Z becomes world -X.
    const yaw = new Quaternion();
    yaw.setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2);

    mocks.frameRef.current!({
      camera: {
        position: new Vector3(0, 0, 0),
        quaternion: yaw,
      },
    });

    const args = mocks.setListenerPoseSpy.mock.calls[0]!;
    expect(args[3]).toBeCloseTo(-1); // fwdX (world -X)
    expect(args[4]).toBeCloseTo(0);
    expect(args[5]).toBeCloseTo(0);
    // Up axis is unchanged by Y-axis rotation.
    expect(args[6]).toBeCloseTo(0);
    expect(args[7]).toBeCloseTo(1);
    expect(args[8]).toBeCloseTo(0);
  });
});
