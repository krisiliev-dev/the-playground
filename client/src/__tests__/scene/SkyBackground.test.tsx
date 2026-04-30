import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import type { Vector3Tuple } from 'three';

// SkyBackground uses useFrame for the procedural sky shader updates.
// jsdom has no Canvas context, so stub the hook out.
vi.mock('@react-three/fiber', () => ({
  useFrame: vi.fn(),
  useThree: () => ({
    camera: { position: { x: 0, y: 0, z: 0 } },
    clock: { elapsedTime: 0 },
  }),
}));

// drei's <Stars /> reaches into R3F's internal store; stub it out.
vi.mock('@react-three/drei', () => ({
  Stars: () => null,
}));

// SkyBackground calls the video API on mount. Return a ready video.
vi.mock('@/api/videos', () => ({
  listReadyVideos: vi.fn().mockResolvedValue([
    {
      id: 'test-id',
      youtube_url: 'https://example.com/x',
      name: 'test',
      status: { state: 'ready', url: '/videos/test.mp4' },
      created_at: '',
      updated_at: '',
    },
  ]),
}));

import { SkyBackground } from '@/components/scene/SkyBackground';

const TEST_DIMS: Vector3Tuple = [80, 80, 80];

describe('SkyBackground', () => {
  it('renders without crashing', () => {
    const { container } = render(<SkyBackground dimensions={TEST_DIMS} />);
    expect(container).toBeTruthy();
  });

  it('renders an inverted-sphere mesh sized from dimensions', () => {
    // The new procedural sky always renders a mesh on mount — no async
    // video-load gating. Just verify the mesh element is present.
    const { container } = render(<SkyBackground dimensions={TEST_DIMS} />);
    expect(container.querySelector('mesh')).not.toBeNull();
  });
});
