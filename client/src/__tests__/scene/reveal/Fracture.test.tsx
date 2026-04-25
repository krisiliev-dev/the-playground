import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';

vi.mock('@react-three/fiber', () => ({
  useFrame: vi.fn(),
}));

import { Fracture } from '@/components/scene/reveal/Fracture';
import { useWorldStore } from '@/store';

describe('Fracture', () => {
  beforeEach(() => {
    useWorldStore.getState().resetReveal();
  });

  it('returns null before impact', () => {
    const { container } = render(<Fracture />);
    expect(container.firstChild).toBeNull();
  });

  it('renders a plane mesh once we hit impact state', () => {
    // Drive the store to `impact`.
    const { advanceReveal } = useWorldStore.getState();
    advanceReveal(); // armed
    advanceReveal(); // swinging
    advanceReveal(); // impact

    const { container } = render(<Fracture />);
    expect(container.querySelector('planeGeometry')).toBeTruthy();
  });
});
