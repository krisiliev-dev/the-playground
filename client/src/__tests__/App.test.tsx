import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useEffect } from 'react';
import { act, render, screen } from '@testing-library/react';
import { App } from '@/App';
import { useWorldStore } from '@/store';

// Mock the R3F Canvas — jsdom can't run WebGL, so we verify
// that App renders a Canvas and passes children into it.
interface MockCanvasProps {
  children?: React.ReactNode;
  onCreated?: unknown;
  [key: string]: unknown;
}

vi.mock('@react-three/fiber', () => ({
  Canvas: ({ children, onCreated: _onCreated, ...props }: MockCanvasProps) => (
    <div data-testid="r3f-canvas" {...props}>
      {children}
    </div>
  ),
}));

// Mock the World component (plus ShakeGroup + CursorAvatar) so we can
// test App in isolation. ShakeGroup must be a passthrough wrapper because
// App.tsx wraps World in it.
vi.mock('@/components/scene', () => ({
  World: () => <div data-testid="world" />,
  ShakeGroup: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  CursorAvatar: () => <div data-testid="cursor-avatar" />,
  PostFx: () => null,
  DevTools: () => null,
}));

// CursorText/Crosshair/ControlsHint read window APIs on mount; stub them
// so the App test stays focused on the keyboard listener wiring. The
// LoadingScreen mock fires `onReady` synchronously on mount so the boot
// gate doesn't block tests on the WebGL probe (jsdom has no real GL).
vi.mock('@/components/overlay', () => ({
  CursorText: () => <div data-testid="cursor-text" />,
  Crosshair: () => <div data-testid="crosshair" />,
  ControlsHint: () => <div data-testid="controls-hint" />,
  HazeOverlay: () => null,
  // PauseMenu is plain DOM and uses react-router hooks; render as null
  // here so the App test stays focused on the boot + canvas wiring.
  // Its real behaviour is covered by overlay/PauseMenu.test.tsx.
  PauseMenu: () => null,
  LoadingScreen: ({ onReady }: { onReady: () => void; onFailed: (r: string) => void }) => {
    useEffect(() => {
      onReady();
    }, [onReady]);
    return <div data-testid="loading-screen" />;
  },
}));

describe('App', () => {
  beforeEach(() => {
    useWorldStore.getState().setCursorAvatarActive(false);
    // Default every test to the 3D shell. The documentMode describe
    // block flips this on per-test where needed. Resetting here keeps
    // localStorage persistence from leaking between tests.
    window.localStorage.clear();
    useWorldStore.setState({ documentMode: false });
  });

  afterEach(() => {
    useWorldStore.getState().setCursorAvatarActive(false);
    useWorldStore.setState({ documentMode: false });
    window.localStorage.clear();
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

  // ── Simple Experience document mode (ADR-003 step 4) ────────────
  describe('documentMode', () => {
    it('renders the DocumentShell instead of the Canvas when documentMode is true', () => {
      useWorldStore.setState({ documentMode: true });
      render(<App />);
      // The 3D Canvas + boot LoadingScreen are bypassed entirely.
      expect(screen.queryByTestId('r3f-canvas')).toBeNull();
      expect(screen.queryByTestId('loading-screen')).toBeNull();
      // DocumentShell renders the brand link as the page header.
      expect(screen.getByLabelText(/Home — Kristiyan Iliev/)).toBeInTheDocument();
    });

    it('renders the Canvas (3D shell) when documentMode is false', () => {
      useWorldStore.setState({ documentMode: false });
      render(<App />);
      expect(screen.getByTestId('r3f-canvas')).toBeInTheDocument();
    });
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
