import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useEffect, useRef } from 'react';
import { act, render, screen } from '@testing-library/react';
import { App } from '@/App';
import { useWorldStore } from '@/store';
import { sfx } from '@/components/audio/SfxManager';

// Mock the R3F Canvas. jsdom has no WebGL, so we replace it with a
// `<div>` wrapper for testid-based queries — but we ALSO mount a real
// `<canvas>` element inside, fire `onCreated` synchronously with a
// fake `RootState`, and patch `requestPointerLock` on it. That gives
// the App's pointer-lock-on-doc→3D handoff something real to acquire
// without dragging in the actual Three.js renderer.
interface MockCanvasProps {
  children?: React.ReactNode;
  onCreated?: (state: { gl: { domElement: HTMLCanvasElement; getContext: () => unknown } }) => void;
  [key: string]: unknown;
}

vi.mock('@react-three/fiber', () => ({
  Canvas: ({ children, onCreated, ...props }: MockCanvasProps) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas || typeof onCreated !== 'function') {
        return;
      }
      onCreated({
        gl: {
          domElement: canvas,
          getContext: () => ({ isContextLost: () => false }),
        },
      });
    }, [onCreated]);
    return (
      <div data-testid="r3f-canvas" {...props}>
        <canvas ref={canvasRef} />
        {children}
      </div>
    );
  },
  // FrameLoopController inside Canvas calls these. Tests don't render
  // the real R3F runtime, so we stub them out as inert no-ops —
  // useFrame never fires (no render loop), and useThree returns a
  // fake state shape that satisfies the selector forms used in App
  // (`useThree(s => s.invalidate)` and the bare `useThree()` call).
  useFrame: () => undefined,
  useThree: (selector?: (s: { invalidate: () => void }) => unknown) => {
    const state = { invalidate: () => undefined };
    return selector ? selector(state) : state;
  },
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
    it('pre-boots the Canvas in the background even on first-load doc mode (so toggling back is instant)', () => {
      // The Canvas mounts on the very first render regardless of
      // documentMode — we trade a one-time WebGL-init cost for a
      // zero-frame toggle when the user later clicks "Switch to 3D
      // experience". The 3D shell is hidden via visibility, not
      // detached from the DOM.
      useWorldStore.setState({ documentMode: true });
      render(<App />);
      expect(screen.getByTestId('r3f-canvas')).toBeInTheDocument();
      expect(screen.getByLabelText(/Home — Kristiyan Iliev/)).toBeInTheDocument();
      // The 3D wrapper is hidden — visibility flipped, pointer events off.
      const wrapper = screen.getByTestId('r3f-canvas').parentElement;
      expect(wrapper!.style.visibility).toBe('hidden');
      expect(wrapper!.style.pointerEvents).toBe('none');
    });

    it('boots the Canvas (3D shell) when documentMode is false', () => {
      useWorldStore.setState({ documentMode: false });
      render(<App />);
      expect(screen.getByTestId('r3f-canvas')).toBeInTheDocument();
    });

    it('keeps the Canvas mounted across mode toggles once 3D has booted', () => {
      // Boot 3D first, then capture the Canvas DOM node, then flip
      // through document mode and back. The same node should be in
      // the DOM the whole time — the document toggle pauses the
      // render loop + hides the wrapper rather than tearing down.
      useWorldStore.setState({ documentMode: false });
      render(<App />);
      const canvasNodeAfterBoot = screen.getByTestId('r3f-canvas');

      act(() => {
        useWorldStore.setState({ documentMode: true });
      });
      // Same DOM node, just inside a hidden wrapper.
      expect(screen.getByTestId('r3f-canvas')).toBe(canvasNodeAfterBoot);

      act(() => {
        useWorldStore.setState({ documentMode: false });
      });
      expect(screen.getByTestId('r3f-canvas')).toBe(canvasNodeAfterBoot);
    });

    it('hides the Canvas wrapper via visibility (not display:none) when in document mode', () => {
      // visibility:hidden preserves the canvas's layout dimensions
      // — display:none would report 0×0 and trigger a wasteful
      // ResizeObserver round-trip on every toggle.
      useWorldStore.setState({ documentMode: false });
      render(<App />);
      const wrapper = screen.getByTestId('r3f-canvas').parentElement;
      expect(wrapper).not.toBeNull();
      expect(wrapper!.style.visibility).toBe('visible');

      act(() => {
        useWorldStore.setState({ documentMode: true });
      });
      expect(wrapper!.style.visibility).toBe('hidden');
      expect(wrapper!.style.pointerEvents).toBe('none');
    });

    describe('pointer-lock auto-acquire on doc → 3D return', () => {
      let originalRequestPointerLock: typeof HTMLCanvasElement.prototype.requestPointerLock;
      let requestPointerLockSpy: ReturnType<typeof vi.fn>;

      beforeEach(() => {
        // eslint-disable-next-line @typescript-eslint/unbound-method
        originalRequestPointerLock = HTMLCanvasElement.prototype.requestPointerLock;
        requestPointerLockSpy = vi.fn();
        HTMLCanvasElement.prototype.requestPointerLock = requestPointerLockSpy;
      });

      afterEach(() => {
        HTMLCanvasElement.prototype.requestPointerLock = originalRequestPointerLock;
        useWorldStore.setState({ controlsDismissed: false, pendingPointerLock: false });
      });

      it('does not request pointer-lock on the initial 3D mount when no signal is pending', () => {
        useWorldStore.setState({
          documentMode: false,
          controlsDismissed: true,
          pendingPointerLock: false,
        });
        render(<App />);
        expect(requestPointerLockSpy).not.toHaveBeenCalled();
      });

      it('consumes the pendingPointerLock signal when toggling back from document mode', () => {
        // Boot 3D first so Canvas is in the DOM. Flip into document
        // mode (Canvas is paused but still mounted), pre-set the
        // pending signal as DocumentShell would, then flip back.
        useWorldStore.setState({ documentMode: false, controlsDismissed: true });
        render(<App />);

        act(() => {
          useWorldStore.setState({ documentMode: true });
        });
        expect(requestPointerLockSpy).not.toHaveBeenCalled();

        useWorldStore.setState({ pendingPointerLock: true });
        act(() => {
          useWorldStore.setState({ documentMode: false });
        });

        expect(requestPointerLockSpy).toHaveBeenCalledTimes(1);
        expect(useWorldStore.getState().pendingPointerLock).toBe(false);
      });

      it('also consumes the signal on the first-load doc-mode → 3D boot path', () => {
        // User starts in document mode (Canvas never mounted), clicks
        // "Switch to 3D experience" (DocumentShell sets the flag),
        // and the Canvas mounts after LoadingScreen completes. The
        // flag should be honored when bootState becomes 'ready' even
        // though documentMode flipped earlier.
        useWorldStore.setState({
          documentMode: true,
          controlsDismissed: true,
          pendingPointerLock: true,
        });
        render(<App />);

        act(() => {
          useWorldStore.setState({ documentMode: false });
        });

        // LoadingScreen mock fires onReady synchronously → bootState
        // → 'ready' → Canvas mounts → useEffect picks up the flag.
        expect(requestPointerLockSpy).toHaveBeenCalledTimes(1);
        expect(useWorldStore.getState().pendingPointerLock).toBe(false);
      });

      it('does not acquire when pendingPointerLock is false (e.g. user was not in avatar mode)', () => {
        useWorldStore.setState({
          documentMode: false,
          controlsDismissed: false,
          pendingPointerLock: false,
        });
        render(<App />);

        act(() => {
          useWorldStore.setState({ documentMode: true });
        });
        act(() => {
          useWorldStore.setState({ documentMode: false });
        });

        expect(requestPointerLockSpy).not.toHaveBeenCalled();
      });
    });
  });

  // ── Audio mute coordination ────────────────────────────────────
  describe('audio mute', () => {
    let setMasterVolumeSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      setMasterVolumeSpy = vi.spyOn(sfx, 'setMasterVolume').mockImplementation(() => undefined);
      useWorldStore.setState({ muted: false, documentMode: false });
    });

    afterEach(() => {
      setMasterVolumeSpy.mockRestore();
      useWorldStore.setState({ muted: false });
    });

    it('starts at full volume on initial 3D mount', () => {
      render(<App />);
      expect(setMasterVolumeSpy).toHaveBeenLastCalledWith(1);
    });

    it('mutes when entering document mode and restores on exit', () => {
      render(<App />);
      act(() => {
        useWorldStore.setState({ documentMode: true });
      });
      expect(setMasterVolumeSpy).toHaveBeenLastCalledWith(0);
      act(() => {
        useWorldStore.setState({ documentMode: false });
      });
      expect(setMasterVolumeSpy).toHaveBeenLastCalledWith(1);
    });

    it('mutes when the user toggles muted from PauseMenu', () => {
      render(<App />);
      act(() => {
        useWorldStore.setState({ muted: true });
      });
      expect(setMasterVolumeSpy).toHaveBeenLastCalledWith(0);
    });

    it('respects the user mute when leaving document mode', () => {
      // User mutes, then enters doc mode, then leaves. Master volume
      // should stay at 0 — leaving doc mode shouldn't override the
      // explicit user preference.
      useWorldStore.setState({ muted: true });
      render(<App />);
      act(() => {
        useWorldStore.setState({ documentMode: true });
      });
      act(() => {
        useWorldStore.setState({ documentMode: false });
      });
      expect(setMasterVolumeSpy).toHaveBeenLastCalledWith(0);
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
