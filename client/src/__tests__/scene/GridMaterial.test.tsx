import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { GridMaterial } from '@/components/scene/GridMaterial';
import { BackSide } from 'three';

describe('GridMaterial', () => {
  it('renders without crashing', () => {
    const { container } = render(<GridMaterial side={BackSide} />);
    expect(container).toBeTruthy();
  });

  it('renders a shaderMaterial element', () => {
    const { container } = render(<GridMaterial side={BackSide} />);
    const shader = container.querySelector('shaderMaterial');
    expect(shader).toBeTruthy();
  });

});
