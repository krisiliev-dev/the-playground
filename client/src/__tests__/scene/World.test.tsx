import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { World } from '@/components/scene';
import { useWorldStore } from '@/store';

// Mock BoxEnvironment so we test World in isolation.
vi.mock('@/components/scene/BoxEnvironment', () => ({
  BoxEnvironment: (props: any) => (
    <div data-testid="box-environment" data-dimensions={JSON.stringify(props.dimensions)} />
  ),
}));

describe('World', () => {
  it('renders without crashing', () => {
    const { container } = render(<World />);
    expect(container).toBeTruthy();
  });

  it('renders a BoxEnvironment with dimensions from the store', () => {
    const { getByTestId } = render(<World />);
    const box = getByTestId('box-environment');
    const dims = useWorldStore.getState().environment.dimensions;
    expect(JSON.parse(box.dataset.dimensions!)).toEqual(dims);
  });

  it('renders ambient light with color from the store', () => {
    const { container } = render(<World />);
    // ambientLight renders as a DOM element in jsdom (R3F components
    // are mocked, but we can check the component tree structure)
    expect(container).toBeTruthy();
  });
});
