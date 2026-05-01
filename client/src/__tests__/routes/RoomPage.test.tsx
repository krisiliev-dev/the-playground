/**
 * RoomPage — has two render variants gated on `documentMode`:
 *  - 3D mode (false): fixed-overlay card with "Back to formation" link.
 *  - Document mode (true): plain <article> for embedding inside
 *    DocumentShell's main slot — no overlay, no back link (the
 *    DocumentShell header nav covers section navigation).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { RoomPage } from '@/routes/RoomPage';
import { useWorldStore } from '@/store';

function renderRoom(): ReturnType<typeof render> {
  return render(
    <MemoryRouter>
      <RoomPage title="About">
        <p>section body</p>
      </RoomPage>
    </MemoryRouter>,
  );
}

describe('RoomPage', () => {
  beforeEach(() => {
    window.localStorage.clear();
    useWorldStore.setState({ documentMode: false });
  });

  describe('3D mode (documentMode === false)', () => {
    it('renders the title, body, and "Back to formation" link', () => {
      renderRoom();
      expect(screen.getByRole('heading', { name: 'About' })).toBeInTheDocument();
      expect(screen.getByText('section body')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /Back to formation/ })).toHaveAttribute('href', '/');
    });
  });

  describe('Document mode (documentMode === true)', () => {
    beforeEach(() => {
      useWorldStore.setState({ documentMode: true });
    });

    it('renders the title and body but omits the back-to-formation link', () => {
      renderRoom();
      expect(screen.getByRole('heading', { name: 'About' })).toBeInTheDocument();
      expect(screen.getByText('section body')).toBeInTheDocument();
      expect(screen.queryByRole('link', { name: /Back to formation/ })).toBeNull();
    });
  });
});
