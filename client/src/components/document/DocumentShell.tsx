/**
 * DocumentShell — the chrome around the Simple Experience document
 * mode. Provides a top header (name + section nav), a scrollable
 * content area for the matched route, and a footer with a "Switch
 * to 3D experience" button.
 *
 * Rendered by App.tsx when `documentMode === true`. The 3D Canvas +
 * overlays are *not* rendered in this mode; the document is the
 * entire surface the user sees.
 *
 * Styling intentionally mirrors the cyberpunk-cube aesthetic — same
 * `#0a0a12` background, cyan accents, JetBrains Mono for code and
 * keymap-y bits, system-ui for body. So switching modes feels like
 * swapping presentation, not entering a different site.
 */
import type { CSSProperties, ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useWorldStore } from '@/store';

const SECTIONS = [
  { to: '/', label: 'Home' },
  { to: '/about', label: 'About' },
  { to: '/projects', label: 'Projects' },
  { to: '/writing', label: 'Writing' },
] as const;

interface DocumentShellProps {
  children: ReactNode;
}

export function DocumentShell({ children }: DocumentShellProps): JSX.Element {
  const location = useLocation();
  const setDocumentMode = useWorldStore((s) => s.setDocumentMode);

  return (
    <div style={styles.shell}>
      <header style={styles.header}>
        <Link to="/" style={styles.brand} aria-label="Home — Kristiyan Iliev">
          Kristiyan Iliev
        </Link>
        <nav aria-label="Sections" style={styles.nav}>
          {SECTIONS.map((section) => {
            const active =
              section.to === '/'
                ? location.pathname === '/'
                : location.pathname.startsWith(section.to);
            return (
              <Link
                key={section.to}
                to={section.to}
                style={active ? styles.navLinkActive : styles.navLink}
                aria-current={active ? 'page' : undefined}
              >
                {section.label}
              </Link>
            );
          })}
        </nav>
      </header>
      <main style={styles.main}>{children}</main>
      <footer style={styles.footer}>
        <span style={styles.footerCopy}>© {new Date().getFullYear()} Kristiyan Iliev</span>
        <button type="button" style={styles.modeToggle} onClick={() => setDocumentMode(false)}>
          Switch to 3D experience →
        </button>
      </footer>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  shell: {
    minHeight: '100vh',
    backgroundColor: '#0a0a12',
    color: '#e0fffa',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    display: 'flex',
    flexDirection: 'column',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 16,
    padding: '20px 32px',
    borderBottom: '1px solid rgba(0, 255, 204, 0.18)',
    background: 'rgba(10, 10, 18, 0.85)',
    backdropFilter: 'blur(6px)',
    WebkitBackdropFilter: 'blur(6px)',
    position: 'sticky',
    top: 0,
    zIndex: 5,
  },
  brand: {
    fontSize: 18,
    fontWeight: 600,
    color: '#00ffcc',
    textDecoration: 'none',
    letterSpacing: '0.02em',
  },
  nav: {
    display: 'flex',
    gap: 6,
  },
  navLink: {
    color: '#e0fffa',
    fontSize: 14,
    padding: '6px 12px',
    border: '1px solid transparent',
    borderRadius: 6,
    textDecoration: 'none',
    transition: 'border-color 0.15s, color 0.15s',
  },
  navLinkActive: {
    color: '#00ffcc',
    fontSize: 14,
    padding: '6px 12px',
    border: '1px solid rgba(0, 255, 204, 0.4)',
    borderRadius: 6,
    textDecoration: 'none',
    background: 'rgba(0, 255, 204, 0.08)',
  },
  main: {
    flex: 1,
    padding: '48px 32px',
    maxWidth: 760,
    width: '100%',
    margin: '0 auto',
  },
  footer: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 12,
    padding: '20px 32px',
    borderTop: '1px solid rgba(0, 255, 204, 0.18)',
    color: 'rgba(224, 255, 250, 0.6)',
    fontSize: 13,
  },
  footerCopy: {
    fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
  },
  modeToggle: {
    background: 'transparent',
    border: '1px solid rgba(0, 255, 204, 0.4)',
    borderRadius: 6,
    color: '#00ffcc',
    fontFamily: 'inherit',
    fontSize: 13,
    padding: '8px 14px',
    cursor: 'pointer',
  },
};
