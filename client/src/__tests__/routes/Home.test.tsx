/**
 * Home — has two render modes gated on `documentMode`:
 *  - 3D mode (false): sr-only landmark for crawlers + screen readers
 *    (the cube formation is the visible home).
 *  - Document mode (true): visible HomeDocument landing page (hero,
 *    bio, section cards). This is what prerendered HTML emits and
 *    what real users see when Simple Experience is enabled.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Home } from '@/routes/Home';
import { useWorldStore } from '@/store';

function renderHome(): ReturnType<typeof render> {
  return render(
    <MemoryRouter>
      <Home />
    </MemoryRouter>,
  );
}

describe('Home', () => {
  beforeEach(() => {
    window.localStorage.clear();
    useWorldStore.setState({ documentMode: false });
  });

  describe('3D mode (documentMode === false)', () => {
    it('renders the sr-only intro with site name + section links', () => {
      renderHome();
      expect(screen.getByRole('heading', { name: 'Kristiyan Iliev' })).toBeInTheDocument();
      const main = screen.getByRole('main');
      // sr-only has 1px clipped width — assertion proxies the
      // off-screen positioning that hides it from sighted users
      // while keeping it in the a11y tree.
      const inlineStyle = main.getAttribute('style') ?? '';
      expect(inlineStyle).toContain('width: 1px');
    });
  });

  describe('Document mode (documentMode === true)', () => {
    beforeEach(() => {
      useWorldStore.setState({ documentMode: true });
    });

    it('renders a visible landing page (not the sr-only variant)', () => {
      renderHome();
      const main = screen.getByRole('main');
      const inlineStyle = main.getAttribute('style') ?? '';
      expect(inlineStyle).not.toContain('width: 1px');
    });

    it('renders the name as an h1 and a tagline', () => {
      renderHome();
      expect(
        screen.getByRole('heading', { level: 1, name: 'Kristiyan Iliev' }),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/Software engineer building interactive 3D experiences/i),
      ).toBeInTheDocument();
    });

    it('renders section cards linking to About / Projects / Writing', () => {
      renderHome();
      expect(screen.getByRole('link', { name: /About/ })).toHaveAttribute('href', '/about');
      expect(screen.getByRole('link', { name: /Projects/ })).toHaveAttribute('href', '/projects');
      expect(screen.getByRole('link', { name: /Writing/ })).toHaveAttribute('href', '/writing');
    });
  });
});
