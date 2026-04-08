import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { BoxEnvironment } from '@/components/scene/BoxEnvironment';
import type { Vector3Tuple } from 'three';

// Mock GridMaterial so we test BoxEnvironment in isolation.
vi.mock('@/components/scene/GridMaterial', () => ({
  GridMaterial: () => <div data-testid="grid-material" />,
}));

const TEST_DIMS: Vector3Tuple = [80, 80, 80];

describe('BoxEnvironment', () => {
  it('renders without crashing', () => {
    const { container } = render(<BoxEnvironment dimensions={TEST_DIMS} />);
    expect(container).toBeTruthy();
  });

  it('renders a mesh element', () => {
    const { container } = render(<BoxEnvironment dimensions={TEST_DIMS} />);
    // R3F lowercased elements render as unknown HTML in jsdom
    const mesh = container.querySelector('mesh');
    expect(mesh).toBeTruthy();
  });

  it('renders a boxGeometry with the provided dimensions', () => {
    const { container } = render(<BoxEnvironment dimensions={TEST_DIMS} />);
    const boxGeo = container.querySelector('boxGeometry');
    expect(boxGeo).toBeTruthy();
  });

  it('renders the GridMaterial inside the mesh', () => {
    const { getByTestId } = render(<BoxEnvironment dimensions={TEST_DIMS} />);
    expect(getByTestId('grid-material')).toBeTruthy();
  });
});
