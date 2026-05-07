/**
 * DocumentShell — renders chrome around document-mode content
 * (sticky header with brand + section nav, scrollable main, footer
 * with copyright + "Switch to 3D experience" button). The toggle
 * button is the user-visible escape hatch out of Simple Experience.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DocumentShell } from '@/components/document/DocumentShell';
import { useWorldStore } from '@/store';

function renderShell(
  initialPath = '/',
  children: React.ReactNode = <p>placeholder body</p>,
): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <DocumentShell>{children}</DocumentShell>
    </MemoryRouter>,
  );
}

describe('DocumentShell', () => {
  beforeEach(() => {
    window.localStorage.clear();
    useWorldStore.setState({ documentMode: true });
  });

  it('renders the brand link, section nav, and children', () => {
    renderShell('/', <p>page body</p>);
    expect(screen.getByLabelText(/Home — Kristiyan Iliev/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'About' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Projects' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Writing' })).toBeInTheDocument();
    expect(screen.getByText('page body')).toBeInTheDocument();
  });

  it('marks the active section link with aria-current="page"', () => {
    renderShell('/projects');
    const projectsLink = screen.getByRole('link', { name: 'Projects' });
    expect(projectsLink).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'About' })).not.toHaveAttribute('aria-current');
  });

  it('treats a nested path as inside the section (e.g. /projects/foo)', () => {
    renderShell('/projects/some-slug');
    expect(screen.getByRole('link', { name: 'Projects' })).toHaveAttribute('aria-current', 'page');
  });

  it('only marks Home active for an exact "/" match', () => {
    renderShell('/about');
    expect(screen.getByRole('link', { name: 'Home' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'About' })).toHaveAttribute('aria-current', 'page');
  });

  it('"Switch to 3D experience" footer button flips documentMode back to false', () => {
    renderShell();
    expect(useWorldStore.getState().documentMode).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /Switch to 3D experience/ }));
    expect(useWorldStore.getState().documentMode).toBe(false);
  });

  describe('pointer-lock handoff signal', () => {
    beforeEach(() => {
      useWorldStore.setState({ pendingPointerLock: false });
    });

    it('sets pendingPointerLock when the user was in avatar mode', () => {
      // controlsDismissed is the marker that the user has reached
      // avatar mode (post-impact). DocumentShell uses it to decide
      // whether reclaiming pointer-lock makes sense.
      useWorldStore.setState({ controlsDismissed: true });
      renderShell();
      fireEvent.click(screen.getByRole('button', { name: /Switch to 3D experience/ }));
      expect(useWorldStore.getState().pendingPointerLock).toBe(true);
    });

    it('does NOT set pendingPointerLock if the user has not reached avatar mode', () => {
      useWorldStore.setState({ controlsDismissed: false });
      renderShell();
      fireEvent.click(screen.getByRole('button', { name: /Switch to 3D experience/ }));
      expect(useWorldStore.getState().pendingPointerLock).toBe(false);
    });
  });
});
