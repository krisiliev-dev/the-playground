import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';

vi.mock('@react-three/fiber', () => ({
  useFrame: vi.fn(),
}));

import { Portal, PORTAL_CONSTANTS } from '@/components/scene/reveal/Portal';

describe('Portal', () => {
  it('renders without crashing', () => {
    const { container } = render(<Portal />);
    expect(container).toBeTruthy();
  });

  it('renders both ring and disc geometries', () => {
    const { container } = render(<Portal />);
    expect(container.querySelector('ringGeometry')).toBeTruthy();
    expect(container.querySelector('circleGeometry')).toBeTruthy();
  });

  it('exports portal constants matching the spec', () => {
    // Portal sits on the +Z wall (behind the camera) so the user doesn't
    // see it in their default forward view.
    expect(PORTAL_CONSTANTS.Z).toBeGreaterThan(0);
    expect(PORTAL_CONSTANTS.COLOR).toBe('#00ffcc');
  });
});
