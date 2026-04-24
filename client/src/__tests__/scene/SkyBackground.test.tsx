import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import type { Vector3Tuple } from 'three';

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

  it('returns null before the video texture is ready', () => {
    // The real video element needs to fire loadeddata to produce a texture.
    // In jsdom that never fires, so the component should sit in the null
    // state and not throw.
    const { container } = render(<SkyBackground dimensions={TEST_DIMS} />);
    expect(container.querySelector('mesh')).toBeNull();
  });
});
