/**
 * Full-screen status overlays for admin-driven player states
 * (per ADR-009):
 *
 *   - **Frozen**: shown while the local player has been frozen
 *     by an admin. Translucent so the world stays visible (the
 *     player can still see what's happening, they just can't
 *     act). Disappears when the unfreeze event arrives.
 *   - **Kicked**: shown after a `kick_notification` for the
 *     local player. Opaque, immobile, blocks pointer events.
 *     Includes a "Reload" button — the only way to rejoin the
 *     scene since the WS reconnect loop is halted while
 *     `localPlayerKicked` is true.
 *
 * Both overlays are mounted at the App level (above the
 * canvas) so they paint over particles, portals, and the
 * cursor crosshair.
 */
import { useWorldStore } from '@/store';

export function AdminStatusOverlay(): JSX.Element | null {
  const frozen = useWorldStore((s) => s.localPlayerFrozen);
  const kicked = useWorldStore((s) => s.localPlayerKicked);
  const reason = useWorldStore((s) => s.kickReason);

  if (kicked) {
    return <KickedView reason={reason} />;
  }
  if (frozen) {
    return <FrozenView />;
  }
  return null;
}

function FrozenView(): JSX.Element {
  return (
    <div style={styles.frozenRoot} aria-live="polite">
      <div style={styles.frozenCard}>
        <div style={styles.frozenIcon}>❄</div>
        <div style={styles.frozenTitle}>You&apos;ve been frozen</div>
        <div style={styles.frozenSubtitle}>
          An admin has stopped your input. You&apos;ll be able to move again when they unfreeze you.
        </div>
      </div>
    </div>
  );
}

function KickedView({ reason }: { reason: string | null }): JSX.Element {
  return (
    <div style={styles.kickedRoot} role="alert">
      <div style={styles.kickedCard}>
        <div style={styles.kickedTitle}>You&apos;ve been kicked</div>
        {reason && <div style={styles.kickedReason}>{reason}</div>}
        <div style={styles.kickedSubtitle}>
          The connection has been closed by an admin. Reload the page to attempt to rejoin.
        </div>
        <button type="button" style={styles.reloadBtn} onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  frozenRoot: {
    position: 'fixed',
    inset: 0,
    pointerEvents: 'none',
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'center',
    paddingTop: 80,
    zIndex: 200,
  },
  frozenCard: {
    background: 'rgba(12, 32, 48, 0.85)',
    border: '1px solid #88ccff',
    borderRadius: 8,
    padding: '20px 28px',
    color: '#88ccff',
    textAlign: 'center',
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)',
    backdropFilter: 'blur(8px)',
  },
  frozenIcon: { fontSize: 32, marginBottom: 6 },
  frozenTitle: {
    fontSize: 16,
    fontWeight: 600,
    letterSpacing: 1,
    marginBottom: 6,
  },
  frozenSubtitle: { fontSize: 12, color: '#a0c8e0', maxWidth: 280, lineHeight: 1.5 },
  kickedRoot: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(10, 4, 8, 0.92)',
    backdropFilter: 'blur(4px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 300,
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
    color: '#ff5577',
  },
  kickedCard: {
    background: '#160a14',
    border: '1px solid #ff5577',
    borderRadius: 8,
    padding: '32px 40px',
    maxWidth: 420,
    textAlign: 'center',
  },
  kickedTitle: {
    fontSize: 22,
    fontWeight: 600,
    letterSpacing: 1,
    marginBottom: 12,
  },
  kickedReason: {
    fontSize: 14,
    color: '#ffaa88',
    fontStyle: 'italic',
    marginBottom: 12,
    fontFamily: 'monospace',
  },
  kickedSubtitle: {
    fontSize: 13,
    color: '#aa6678',
    marginBottom: 20,
    lineHeight: 1.5,
  },
  reloadBtn: {
    background: '#ff5577',
    color: '#160a14',
    border: 'none',
    padding: '10px 24px',
    borderRadius: 4,
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
  },
};
