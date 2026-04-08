import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { App } from '@/App';

// Mock the R3F Canvas — jsdom can't run WebGL, so we verify
// that App renders a Canvas and passes children into it.
vi.mock('@react-three/fiber', () => ({
  Canvas: ({ children, onCreated, ...props }: any) => (
    <div data-testid="r3f-canvas" {...props}>
      {children}
    </div>
  ),
}));

// Mock the World component so we can test App in isolation.
vi.mock('@/components/scene', () => ({
  World: () => <div data-testid="world" />,
}));

describe('App', () => {
  it('renders without crashing', () => {
    render(<App />);
    expect(screen.getByTestId('r3f-canvas')).toBeInTheDocument();
  });

  it('renders the World component inside the Canvas', () => {
    render(<App />);
    const canvas = screen.getByTestId('r3f-canvas');
    const world = screen.getByTestId('world');
    expect(canvas).toContainElement(world);
  });
});
