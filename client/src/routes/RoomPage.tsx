/**
 * RoomPage — shared shell for the four section routes (About, Projects,
 * Writing, and the placeholder Home). Has two visual variants:
 *
 *   - 3D mode (`documentMode === false`): renders as a fixed overlay
 *     above the cube formation, with the cyan/teal cube-room
 *     aesthetic. The "Back to formation" link returns to `/`.
 *   - Document mode (`documentMode === true`): renders as a plain
 *     `<article>` inside DocumentShell's main slot — no fixed
 *     positioning, no card chrome, no back-to-formation link
 *     (DocumentShell's own header nav covers section navigation
 *     and the footer holds the "Switch to 3D experience" button).
 *
 * Per-section components pass `title` + their content as children.
 * The variant choice is made here, not in the section components,
 * so each section's content lives in one place.
 */
import { Link } from 'react-router-dom';
import type { CSSProperties, ReactNode } from 'react';
import { useWorldStore } from '@/store';

interface RoomPageProps {
  title: string;
  children: ReactNode;
}

export function RoomPage({ title, children }: RoomPageProps): JSX.Element {
  const documentMode = useWorldStore((s) => s.documentMode);

  if (documentMode) {
    return (
      <article aria-live="polite">
        <h1 style={styles.documentTitle}>{title}</h1>
        <div style={styles.documentContent}>{children}</div>
        <p style={styles.documentPlaceholder}>
          Placeholder — real content lands in a future session.
        </p>
      </article>
    );
  }

  return (
    <div style={styles.wrap} aria-live="polite">
      <article style={styles.card}>
        <header style={styles.header}>
          <Link to="/" style={styles.back}>
            ← Back to formation
          </Link>
          <h1 style={styles.title}>{title}</h1>
        </header>
        <div style={styles.content}>{children}</div>
        <footer style={styles.footer}>
          <span style={styles.placeholder}>
            Placeholder — real content lands in a future session.
          </span>
        </footer>
      </article>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  wrap: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(10, 10, 18, 0.92)',
    backdropFilter: 'blur(8px)',
    WebkitBackdropFilter: 'blur(8px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '32px 16px',
    zIndex: 20,
    overflowY: 'auto',
  },
  card: {
    maxWidth: 720,
    width: '100%',
    padding: '40px 48px',
    background: 'rgba(18, 18, 26, 0.85)',
    border: '1px solid rgba(0, 255, 204, 0.35)',
    borderRadius: 12,
    boxShadow: '0 0 32px rgba(0, 255, 204, 0.18)',
    color: '#e0fffa',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  header: {
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
    marginBottom: 32,
    paddingBottom: 24,
    borderBottom: '1px solid rgba(0, 255, 204, 0.2)',
  },
  back: {
    fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
    fontSize: 13,
    color: '#00ffcc',
    textDecoration: 'none',
    letterSpacing: '0.05em',
    width: 'fit-content',
  },
  title: {
    margin: 0,
    fontSize: 36,
    fontWeight: 600,
    letterSpacing: '0.02em',
    color: '#e0fffa',
  },
  content: {
    fontSize: 16,
    lineHeight: 1.65,
    color: 'rgba(224, 255, 250, 0.85)',
  },
  footer: {
    marginTop: 40,
    paddingTop: 16,
    borderTop: '1px dashed rgba(0, 255, 204, 0.2)',
  },
  placeholder: {
    fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
    fontSize: 12,
    color: 'rgba(0, 255, 204, 0.55)',
  },
  documentTitle: {
    margin: '0 0 24px',
    fontSize: 36,
    fontWeight: 600,
    letterSpacing: '0.02em',
    color: '#e0fffa',
  },
  documentContent: {
    fontSize: 16,
    lineHeight: 1.65,
    color: 'rgba(224, 255, 250, 0.85)',
  },
  documentPlaceholder: {
    marginTop: 40,
    fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
    fontSize: 12,
    color: 'rgba(0, 255, 204, 0.55)',
  },
};
