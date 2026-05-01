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
import { sfx } from '@/components/audio/SfxManager';

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

const escEvent = (): KeyboardEvent => new KeyboardEvent('keydown', { key: 'Escape' });

describe('PauseMenu', () => {
  let originalMatchMedia: typeof window.matchMedia;

  beforeEach(() => {
    originalMatchMedia = window.matchMedia;
    setMatchMedia(false); // desktop default
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  describe('desktop — no chrome when closed', () => {
    it('renders nothing on the screen when the menu is closed', () => {
      const { container } = renderMenu();
      expect(container.firstChild).toBeNull();
    });

    it('opens on Esc keydown', () => {
      renderMenu();
      expect(screen.queryByRole('dialog')).toBeNull();
      act(() => {
        window.dispatchEvent(escEvent());
      });
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('closes on a second Esc keydown', () => {
      renderMenu();
      act(() => {
        window.dispatchEvent(escEvent());
      });
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      act(() => {
        window.dispatchEvent(escEvent());
      });
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('closes on backdrop click', () => {
      renderMenu();
      act(() => {
        window.dispatchEvent(escEvent());
      });
      const backdrop = screen.getByRole('dialog');
      fireEvent.click(backdrop);
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('does NOT close on click inside the card (stopPropagation)', () => {
      renderMenu();
      act(() => {
        window.dispatchEvent(escEvent());
      });
      // The "Menu" heading is inside the card; clicking it should be
      // intercepted by the card's stopPropagation, NOT dismissed.
      fireEvent.click(screen.getByText('Menu'));
      expect(screen.queryByRole('dialog')).toBeInTheDocument();
    });

    it('ignores Esc when focus is in a text input (lets the platform handle it)', () => {
      const input = document.createElement('input');
      document.body.appendChild(input);
      input.focus();

      renderMenu();
      // Esc dispatched from the input element bubbles up; the menu's
      // listener checks `e.target.tagName` and bails for INPUT.
      act(() => {
        const e = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
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
        window.dispatchEvent(escEvent());
      });
      expect(screen.getByText('← Back')).toBeDisabled();
    });

    it('is enabled when at a non-root route', () => {
      renderMenu('/about');
      act(() => {
        window.dispatchEvent(escEvent());
      });
      expect(screen.getByText('← Back')).not.toBeDisabled();
    });
  });

  describe('section shortcuts', () => {
    it('renders all four section links', () => {
      renderMenu();
      act(() => {
        window.dispatchEvent(escEvent());
      });
      expect(screen.getByText('Home')).toBeInTheDocument();
      expect(screen.getByText('About')).toBeInTheDocument();
      expect(screen.getByText('Projects')).toBeInTheDocument();
      expect(screen.getByText('Writing')).toBeInTheDocument();
    });

    it('section link is a Link with the right href', () => {
      renderMenu();
      act(() => {
        window.dispatchEvent(escEvent());
      });
      const aboutLink = screen.getByText('About').closest('a');
      expect(aboutLink).toHaveAttribute('href', '/about');
    });
  });

  describe('Contact card', () => {
    it('starts collapsed', () => {
      renderMenu();
      act(() => {
        window.dispatchEvent(escEvent());
      });
      expect(screen.queryByText(/hello@/)).toBeNull();
    });

    it('expands the contact card on click and reveals email + GitHub + LinkedIn', () => {
      renderMenu();
      act(() => {
        window.dispatchEvent(escEvent());
      });
      const toggle = screen.getByText(/Contact/);
      fireEvent.click(toggle);
      expect(screen.getByText(/hello@/)).toBeInTheDocument();
      expect(screen.getByText('GitHub →')).toBeInTheDocument();
      expect(screen.getByText('LinkedIn →')).toBeInTheDocument();
    });
  });

  describe('Audio toggle', () => {
    it('calls sfx.setMasterVolume(0) on first click and (1) on second', () => {
      const spy = vi.spyOn(sfx, 'setMasterVolume');
      renderMenu();
      act(() => {
        window.dispatchEvent(escEvent());
      });
      const audioBtn = screen.getByText(/Audio:/);
      fireEvent.click(audioBtn);
      expect(spy).toHaveBeenLastCalledWith(0);
      fireEvent.click(audioBtn);
      expect(spy).toHaveBeenLastCalledWith(1);
      spy.mockRestore();
    });

    it('button label reflects mute state', () => {
      renderMenu();
      act(() => {
        window.dispatchEvent(escEvent());
      });
      expect(screen.getByText(/Audio: on/)).toBeInTheDocument();
      fireEvent.click(screen.getByText(/Audio:/));
      expect(screen.getByText(/Audio: muted/)).toBeInTheDocument();
    });
  });

  describe('Simple Experience toggle (placeholder until step 4)', () => {
    it('renders disabled with the "(coming soon)" label', () => {
      renderMenu();
      act(() => {
        window.dispatchEvent(escEvent());
      });
      const seBtn = screen.getByText(/Simple Experience/);
      expect(seBtn).toBeDisabled();
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

    it('hint text says "tap outside" instead of "press Esc"', () => {
      renderMenu();
      fireEvent.click(screen.getByLabelText('Open menu'));
      expect(screen.getByText(/tap outside to close/)).toBeInTheDocument();
    });
  });
});
