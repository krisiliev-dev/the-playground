/**
 * Players panel — list every connected player and act on them.
 *
 * Per ADR-009 the admin can:
 *   - Kick: forcibly close a player's WS connection.
 *   - Freeze: server-side flag that drops the player's PlayerInput
 *     position updates. Their cursor visibly stops; their UI
 *     continues to work.
 *   - Teleport: snap their cursor to the operator's last-known
 *     scene cursor position.
 *
 * Polls every 2s; the list isn't push-driven by the WS yet, so
 * a join / leave shows up within one poll cycle.
 */
import { useCallback, useEffect, useState } from 'react';
import { cursorWorldPosition } from '@/components/scene/cursorWorldPosition';
import { AdminAuthError, type AdminClient, type AdminPlayer } from './apiClient';

interface Props {
  client: AdminClient;
  onAuthError: () => void;
}

const POLL_MS = 2000;

export function PlayersPanel({ client, onAuthError }: Props): JSX.Element {
  const [players, setPlayers] = useState<AdminPlayer[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      setPlayers(await client.listPlayers());
    } catch (e) {
      if (e instanceof AdminAuthError) {
        onAuthError();
        return;
      }
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [client, onAuthError]);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), POLL_MS);
    return () => window.clearInterval(id);
  }, [refresh]);

  const wrap = async (id: string, action: () => Promise<void>, label: string): Promise<void> => {
    setBusyId(id);
    setError(null);
    setInfo(null);
    try {
      await action();
      setInfo(`${label} ${id.slice(0, 8)}…`);
      await refresh();
    } catch (e) {
      if (e instanceof AdminAuthError) {
        onAuthError();
        return;
      }
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  const onKick = (id: string): void => {
    if (!window.confirm(`Kick player ${id.slice(0, 8)}…?`)) {
      return;
    }
    void wrap(id, () => client.kickPlayer(id), 'Kicked');
  };

  const onFreezeToggle = (p: AdminPlayer): void => {
    const next = !p.frozen;
    void wrap(p.id, () => client.freezePlayer(p.id, next), next ? 'Froze' : 'Unfroze');
  };

  const onTeleportToCursor = (id: string): void => {
    const pos: [number, number, number] = [
      cursorWorldPosition.x,
      cursorWorldPosition.y,
      cursorWorldPosition.z,
    ];
    void wrap(id, () => client.teleportPlayer(id, pos), 'Teleported');
  };

  return (
    <div style={styles.root}>
      <header style={styles.header}>
        <h2 style={styles.heading}>Players {players ? `(${players.length})` : ''}</h2>
        <button type="button" style={styles.refreshBtn} onClick={() => void refresh()}>
          Refresh
        </button>
      </header>
      {error && <div style={styles.error}>{error}</div>}
      {info && <div style={styles.info}>{info}</div>}
      {players === null && <div style={styles.muted}>Loading…</div>}
      {players && players.length === 0 && (
        <div style={styles.muted}>No players connected.</div>
      )}
      {players && players.length > 0 && (
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>ID</th>
              <th style={styles.th}>Name</th>
              <th style={styles.th}>Route</th>
              <th style={styles.th}>Position</th>
              <th style={styles.th}>State</th>
              <th style={styles.th}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {players.map((p) => (
              <tr key={p.id} style={styles.tr}>
                <td style={styles.td}>
                  <code style={styles.code}>{p.id.slice(0, 8)}…</code>
                </td>
                <td style={styles.td}>
                  <span style={{ ...styles.colorChip, background: p.cursor_color }} />
                  {p.name}
                </td>
                <td style={styles.td}>
                  <code style={styles.code}>{p.route}</code>
                </td>
                <td style={styles.td}>
                  <code style={styles.code}>
                    {p.position.map((n) => n.toFixed(0)).join(', ')}
                  </code>
                </td>
                <td style={styles.td}>
                  {p.frozen ? <span style={styles.frozenBadge}>FROZEN</span> : ''}
                </td>
                <td style={styles.td}>
                  <div style={styles.actions}>
                    <button
                      type="button"
                      style={styles.tpBtn}
                      disabled={busyId === p.id}
                      onClick={() => onTeleportToCursor(p.id)}
                      title="Teleport to your scene cursor's last-known position"
                    >
                      ⤳ Teleport
                    </button>
                    <button
                      type="button"
                      style={p.frozen ? styles.unfreezeBtn : styles.freezeBtn}
                      disabled={busyId === p.id}
                      onClick={() => onFreezeToggle(p)}
                    >
                      {p.frozen ? 'Unfreeze' : 'Freeze'}
                    </button>
                    <button
                      type="button"
                      style={styles.kickBtn}
                      disabled={busyId === p.id}
                      onClick={() => onKick(p.id)}
                    >
                      Kick
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  root: { display: 'flex', flexDirection: 'column', gap: 16 },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  heading: { fontSize: 16, color: '#e6f7ff', margin: 0 },
  refreshBtn: {
    background: 'transparent',
    border: '1px solid #1a1a2e',
    color: '#8aa',
    padding: '6px 12px',
    borderRadius: 4,
    cursor: 'pointer',
    fontSize: 12,
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: 13,
  },
  th: {
    textAlign: 'left',
    color: '#8aa',
    fontWeight: 500,
    padding: '8px 12px',
    borderBottom: '1px solid #1a1a2e',
  },
  tr: {},
  td: { padding: '8px 12px', borderBottom: '1px solid #12121a', color: '#e6f7ff' },
  code: { fontFamily: 'monospace', fontSize: 12 },
  colorChip: {
    display: 'inline-block',
    width: 10,
    height: 10,
    borderRadius: 2,
    marginRight: 6,
    verticalAlign: 'middle',
  },
  frozenBadge: {
    background: '#0c2030',
    color: '#88ccff',
    border: '1px solid #88ccff',
    padding: '2px 6px',
    borderRadius: 4,
    fontFamily: 'monospace',
    fontSize: 10,
    letterSpacing: 1,
  },
  actions: { display: 'flex', gap: 6 },
  tpBtn: {
    background: '#0c1418',
    color: '#00ffcc',
    border: '1px solid #00ffcc',
    padding: '4px 10px',
    borderRadius: 4,
    cursor: 'pointer',
    fontSize: 12,
  },
  freezeBtn: {
    background: '#0c1418',
    color: '#88ccff',
    border: '1px solid #88ccff',
    padding: '4px 10px',
    borderRadius: 4,
    cursor: 'pointer',
    fontSize: 12,
  },
  unfreezeBtn: {
    background: '#88ccff',
    color: '#0a0a12',
    border: '1px solid #88ccff',
    padding: '4px 10px',
    borderRadius: 4,
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 600,
  },
  kickBtn: {
    background: '#0c1418',
    color: '#ff5577',
    border: '1px solid #ff5577',
    padding: '4px 10px',
    borderRadius: 4,
    cursor: 'pointer',
    fontSize: 12,
  },
  error: {
    color: '#ff5577',
    background: '#2a0a14',
    border: '1px solid #ff5577',
    padding: '8px 12px',
    borderRadius: 4,
    fontSize: 13,
  },
  info: {
    color: '#00ffcc',
    background: '#0c1820',
    border: '1px solid #00ffcc',
    padding: '8px 12px',
    borderRadius: 4,
    fontSize: 13,
  },
  muted: { color: '#667', fontSize: 13 },
};
