/**
 * RoomPage — shared shell for the four section routes (About, Projects,
 * Writing, and the placeholder Home). Renders as a fixed overlay above
 * the 3D canvas so navigating to a route is visually distinct from
 * being at `/` (the formation).
 *
 * This is the proto-Simple-Experience layout. In step 4 of the
 * portfolio build (see ADR-003), it'll be promoted into a fully-styled
 * document view that the Simple Experience toggle can render. For now
 * it's a minimal placeholder so the routing layer is observable.
 *
 * The shell handles: fixed positioning, the cyan/teal cube-room
 * aesthetic, the back link, and the title. Per-section components
 * pass `title` + their content as children.
 */
import { Link } from 'react-router-dom';
import type { CSSProperties, ReactNode } from 'react';

interface RoomPageProps {
  title: string;
  children: ReactNode;
}

export function RoomPage({ title, children }: RoomPageProps): JSX.Element {
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
};
