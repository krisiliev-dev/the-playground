import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { App } from '@/App';
import { useWorldStore } from '@/store';

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

// CursorText reads window APIs on mount; stub it so the App test stays
// focused on the keyboard listener wiring.
vi.mock('@/components/overlay', () => ({
  CursorText: () => <div data-testid="cursor-text" />,
}));

describe('App', () => {
  beforeEach(() => {
    useWorldStore.getState().setCursorAvatarActive(false);
  });

  afterEach(() => {
    useWorldStore.getState().setCursorAvatarActive(false);
  });

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

  // ── Temporary 'C' hotkey for cursor avatar (Phase 5) ───────────

  describe('cursor avatar hotkey', () => {
    it('toggles cursorAvatarActive on lowercase c keydown', () => {
      render(<App />);
      expect(useWorldStore.getState().cursorAvatarActive).toBe(false);

      act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'c' }));
      });
      expect(useWorldStore.getState().cursorAvatarActive).toBe(true);

      act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'c' }));
      });
      expect(useWorldStore.getState().cursorAvatarActive).toBe(false);
    });

    it('toggles on uppercase C keydown as well', () => {
      render(<App />);
      act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'C' }));
      });
      expect(useWorldStore.getState().cursorAvatarActive).toBe(true);
    });

    it('ignores keydown when target is an input element', () => {
      render(<App />);
      const input = document.createElement('input');
      document.body.appendChild(input);

      act(() => {
        const evt = new KeyboardEvent('keydown', { key: 'c', bubbles: true });
        input.dispatchEvent(evt);
      });

      expect(useWorldStore.getState().cursorAvatarActive).toBe(false);
      document.body.removeChild(input);
    });

    it('does not toggle on other keys', () => {
      render(<App />);
      act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'x' }));
      });
      expect(useWorldStore.getState().cursorAvatarActive).toBe(false);
    });
  });
});
