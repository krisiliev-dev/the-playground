import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import type { Vector3Tuple } from 'three';

// Mock hls.js — we don't want real network requests in tests.
vi.mock('hls.js', () => {
  const MockHls = vi.fn().mockImplementation(() => ({
    loadSource: vi.fn(),
    attachMedia: vi.fn(),
    on: vi.fn(),
    destroy: vi.fn(),
  }));
  (MockHls as any).isSupported = () => true;
  (MockHls as any).Events = { MANIFEST_PARSED: 'hlsManifestParsed' };
  return { default: MockHls };
});

// Mock useFrame — it only works inside a real R3F Canvas.
vi.mock('@react-three/fiber', () => ({
  useFrame: vi.fn(),
}));

import { SkyBackground } from '@/components/scene/SkyBackground';

const TEST_DIMS: Vector3Tuple = [80, 80, 80];

describe('SkyBackground', () => {
  it('should render a sphere geometry inside a mesh', () => {
    const { container } = render(<SkyBackground dimensions={TEST_DIMS} />);
    const mesh = container.querySelector('mesh');
    expect(mesh).toBeTruthy();
    const sphere = container.querySelector('sphereGeometry');
    expect(sphere).toBeTruthy();
  });

  it('should render a meshBasicMaterial', () => {
    const { container } = render(<SkyBackground dimensions={TEST_DIMS} />);
    const material = container.querySelector('meshBasicMaterial');
    expect(material).toBeTruthy();
  });
});
