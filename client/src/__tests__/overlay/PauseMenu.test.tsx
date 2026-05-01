/**
 * PauseMenu — visibility, summon/dismiss behaviour, and each menu
 * item's wiring. Mocks `@/components/audio/SfxManager` for the audio
 * toggle assertion; uses `MemoryRouter` to test route-aware items
 * (Back disabled at /, section shortcuts) without a browser history.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PauseMenu } from '@/components/overlay/PauseMenu';
import { useWorldStore } from '@/store';

function setMatchMedia(matches: boolean): void {
  window.matchMedia = ((query: string) =>
    ({
      matches,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList) as typeof window.matchMedia;
}

function renderMenu(initialPath = '/'): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <PauseMenu />
    </MemoryRouter>,
  );
}

const mEvent = (): KeyboardEvent => new KeyboardEvent('keydown', { key: 'm' });
const escEvent = (): KeyboardEvent => new KeyboardEvent('keydown', { key: 'Escape' });

describe('PauseMenu', () => {
  let originalMatchMedia: typeof window.matchMedia;

  beforeEach(() => {
    originalMatchMedia = window.matchMedia;
    setMatchMedia(false); // desktop default
    // Reset store fields the menu writes to / reads from.
    useWorldStore.setState({
      menuOpen: false,
      controlsDismissed: false,
      pressedInteractableId: null,
      pressedTargetPoint: null,
    });
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    useWorldStore.setState({ menuOpen: false });
  });

  describe('desktop — no chrome when closed', () => {
    it('renders nothing on the screen when the menu is closed', () => {
      const { container } = renderMenu();
      expect(container.firstChild).toBeNull();
    });

    it('opens on M keydown', () => {
      renderMenu();
      expect(screen.queryByRole('dialog')).toBeNull();
      act(() => {
        window.dispatchEvent(mEvent());
      });
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('closes on a second M keydown', () => {
      renderMenu();
      act(() => {
        window.dispatchEvent(mEvent());
      });
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      act(() => {
        window.dispatchEvent(mEvent());
      });
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('does NOT respond to Esc at all (browser-reserved key)', () => {
      // Esc is left to the browser's native behaviour — pointer-lock
      // release on Chrome, plus fullscreen exit on Safari. We don't
      // intercept it for opening or closing because the side effects
      // fire either way and would happen on every menu interaction.
      renderMenu();
      // Esc when closed: still closed.
      act(() => {
        window.dispatchEvent(escEvent());
      });
      expect(screen.queryByRole('dialog')).toBeNull();
      // Open via M, then Esc: still open (Esc no longer closes).
      act(() => {
        window.dispatchEvent(mEvent());
      });
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      act(() => {
        window.dispatchEvent(escEvent());
      });
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('treats uppercase M the same as lowercase', () => {
      renderMenu();
      act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'M' }));
      });
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('closes on backdrop click', () => {
      renderMenu();
      act(() => {
        window.dispatchEvent(mEvent());
      });
      const backdrop = screen.getByRole('dialog');
      fireEvent.click(backdrop);
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('does NOT close on click inside the card (stopPropagation)', () => {
      renderMenu();
      act(() => {
        window.dispatchEvent(mEvent());
      });
      // The "Menu" heading is inside the card; clicking it should be
      // intercepted by the card's stopPropagation, NOT dismissed.
      fireEvent.click(screen.getByText('Menu'));
      expect(screen.queryByRole('dialog')).toBeInTheDocument();
    });

    it('ignores M when focus is in a text input (lets the platform handle it)', () => {
      const input = document.createElement('input');
      document.body.appendChild(input);
      input.focus();

      renderMenu();
      act(() => {
        const e = new KeyboardEvent('keydown', { key: 'm', bubbles: true });
        input.dispatchEvent(e);
      });
      expect(screen.queryByRole('dialog')).toBeNull();

      input.remove();
    });
  });

  describe('Back button', () => {
    it('is disabled when at /', () => {
      renderMenu('/');
      act(() => {
        window.dispatchEvent(mEvent());
      });
      expect(screen.getByText('← Back')).toBeDisabled();
    });

    it('is enabled when at a non-root route', () => {
      renderMenu('/about');
      act(() => {
        window.dispatchEvent(mEvent());
      });
      expect(screen.getByText('← Back')).not.toBeDisabled();
    });
  });

  describe('section shortcuts', () => {
    it('renders all four section links', () => {
      renderMenu();
      act(() => {
        window.dispatchEvent(mEvent());
      });
      expect(screen.getByText('Home')).toBeInTheDocument();
      expect(screen.getByText('About')).toBeInTheDocument();
      expect(screen.getByText('Projects')).toBeInTheDocument();
      expect(screen.getByText('Writing')).toBeInTheDocument();
    });

    it('section link is a Link with the right href', () => {
      renderMenu();
      act(() => {
        window.dispatchEvent(mEvent());
      });
      const aboutLink = screen.getByText('About').closest('a');
      expect(aboutLink).toHaveAttribute('href', '/about');
    });
  });

  describe('Contact card', () => {
    it('starts collapsed', () => {
      renderMenu();
      act(() => {
        window.dispatchEvent(mEvent());
      });
      expect(screen.queryByText(/hello@/)).toBeNull();
    });

    it('expands the contact card on click and reveals email + GitHub + LinkedIn', () => {
      renderMenu();
      act(() => {
        window.dispatchEvent(mEvent());
      });
      const toggle = screen.getByText(/Contact/);
      fireEvent.click(toggle);
      expect(screen.getByText(/hello@/)).toBeInTheDocument();
      expect(screen.getByText('GitHub →')).toBeInTheDocument();
      expect(screen.getByText('LinkedIn →')).toBeInTheDocument();
    });
  });

  describe('Audio toggle', () => {
    beforeEach(() => {
      useWorldStore.setState({ muted: false });
    });

    it('flips the store muted flag on click', () => {
      renderMenu();
      act(() => {
        window.dispatchEvent(mEvent());
      });
      const audioBtn = screen.getByText(/Audio:/);
      expect(useWorldStore.getState().muted).toBe(false);
      fireEvent.click(audioBtn);
      expect(useWorldStore.getState().muted).toBe(true);
      fireEvent.click(audioBtn);
      expect(useWorldStore.getState().muted).toBe(false);
    });

    it('button label reflects mute state', () => {
      renderMenu();
      act(() => {
        window.dispatchEvent(mEvent());
      });
      expect(screen.getByText(/Audio: on/)).toBeInTheDocument();
      fireEvent.click(screen.getByText(/Audio:/));
      expect(screen.getByText(/Audio: muted/)).toBeInTheDocument();
    });
  });

  describe('Simple Experience toggle', () => {
    beforeEach(() => {
      // Document mode is persisted, so each test starts from `false`
      // with localStorage cleared to keep assertions deterministic.
      window.localStorage.clear();
      useWorldStore.setState({ documentMode: false });
    });

    it('renders enabled (no longer the "coming soon" placeholder)', () => {
      renderMenu();
      act(() => {
        window.dispatchEvent(mEvent());
      });
      const seBtn = screen.getByText(/Simple Experience/);
      expect(seBtn).not.toBeDisabled();
    });

    it('flips documentMode to true when clicked', () => {
      renderMenu();
      act(() => {
        window.dispatchEvent(mEvent());
      });
      expect(useWorldStore.getState().documentMode).toBe(false);
      fireEvent.click(screen.getByText(/Simple Experience/));
      expect(useWorldStore.getState().documentMode).toBe(true);
    });

    it('closes the menu after toggling', () => {
      renderMenu();
      act(() => {
        window.dispatchEvent(mEvent());
      });
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      fireEvent.click(screen.getByText(/Simple Experience/));
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  describe('mobile (touch primary)', () => {
    beforeEach(() => {
      setMatchMedia(true);
    });

    it('renders the ≡ icon when the menu is closed (only persistent UI on touch)', () => {
      renderMenu();
      expect(screen.getByLabelText('Open menu')).toBeInTheDocument();
    });

    it('opens the menu on icon tap', () => {
      renderMenu();
      fireEvent.click(screen.getByLabelText('Open menu'));
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('hides the ≡ icon while the menu is open (the menu is the dismiss affordance)', () => {
      renderMenu();
      fireEvent.click(screen.getByLabelText('Open menu'));
      expect(screen.queryByLabelText('Open menu')).toBeNull();
    });

    it('keymap shows touch glyphs (≡, 2 fingers, swipe, tap) instead of WASD', () => {
      renderMenu();
      fireEvent.click(screen.getByLabelText('Open menu'));
      fireEvent.click(screen.getByText('Controls'));
      expect(screen.getByText('≡')).toBeInTheDocument();
      expect(screen.getByText('2 fingers')).toBeInTheDocument();
      expect(screen.getByText('1 finger')).toBeInTheDocument();
      expect(screen.queryByText('W A S D')).toBeNull();
    });

    it('hint text says "tap outside" instead of "press M"', () => {
      renderMenu();
      fireEvent.click(screen.getByLabelText('Open menu'));
      expect(screen.getByText(/tap outside to close/)).toBeInTheDocument();
    });
  });

  describe('store integration + side effects', () => {
    it('writes menuOpen=true to the store on open and false on close', () => {
      renderMenu();
      expect(useWorldStore.getState().menuOpen).toBe(false);

      act(() => {
        window.dispatchEvent(mEvent());
      });
      expect(useWorldStore.getState().menuOpen).toBe(true);

      act(() => {
        window.dispatchEvent(mEvent());
      });
      expect(useWorldStore.getState().menuOpen).toBe(false);
    });

    it('ends any in-progress interaction press when opening', () => {
      // Simulate a press that was active when the user pressed M.
      useWorldStore.getState().beginInteractPress('cube-A', [1, 2, 3]);
      expect(useWorldStore.getState().pressedInteractableId).toBe('cube-A');

      renderMenu();
      act(() => {
        window.dispatchEvent(mEvent());
      });
      // Press cleared so the cursor doesn't stay leaned forward
      // through menu mode.
      expect(useWorldStore.getState().pressedInteractableId).toBeNull();
      expect(useWorldStore.getState().pressedTargetPoint).toBeNull();
    });

    it('requests pointer-lock on close when in avatar mode', () => {
      // Set up: avatar mode + a canvas with a spy-able requestPointerLock.
      useWorldStore.setState({ controlsDismissed: true });
      const canvas = document.createElement('canvas');
      const spy = vi.fn();
      // Define on the instance directly — jsdom's HTMLCanvasElement
      // doesn't ship requestPointerLock, so this stays our spy.
      Object.defineProperty(canvas, 'requestPointerLock', {
        configurable: true,
        value: spy,
      });
      document.body.appendChild(canvas);

      renderMenu();
      // Open then close — the close path is what should trigger
      // re-acquisition.
      act(() => {
        window.dispatchEvent(mEvent());
      });
      expect(spy).not.toHaveBeenCalled();
      act(() => {
        window.dispatchEvent(mEvent());
      });
      expect(spy).toHaveBeenCalledTimes(1);

      document.body.removeChild(canvas);
    });

    it('does NOT request pointer-lock on close outside avatar mode', () => {
      // Pre-avatar mode: the user hasn't dismissed the controls hint
      // yet, so pointer-lock shouldn't be expected to be active and
      // re-acquiring it would surprise them.
      useWorldStore.setState({ controlsDismissed: false });
      const canvas = document.createElement('canvas');
      const spy = vi.fn();
      Object.defineProperty(canvas, 'requestPointerLock', {
        configurable: true,
        value: spy,
      });
      document.body.appendChild(canvas);

      renderMenu();
      act(() => {
        window.dispatchEvent(mEvent());
      });
      act(() => {
        window.dispatchEvent(mEvent());
      });
      expect(spy).not.toHaveBeenCalled();

      document.body.removeChild(canvas);
    });
  });
});
