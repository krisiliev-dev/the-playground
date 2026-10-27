/**
 * Tiny on-screen overlay that surfaces the multiplayer slice's
 * state for debugging — connection-side observability without
 * having to dig in browser devtools. Mounted in App only in dev
 * builds (`import.meta.env.DEV`) with VITE_MULTIPLAYER_URL set, so
 * production visitors never see other players' ids or positions.
 */
import { useEffect, useState } from 'react';
import { useWorldStore } from '@/store';
import { cursorWorldPosition } from '@/components/scene/cursorWorldPosition';

export function MultiplayerDebugHud(): JSX.Element {
  const entities = useWorldStore((s) => s.entities);
  const localPlayerId = useWorldStore((s) => s.localPlayerId);
  const currentRoute = useWorldStore((s) => s.currentRoute);

  // Live readout of the *local source of truth* — what the
  // multiplayer hook will see on its next outbound tick. If this
  // stays (0,0,0) while the avatar is visibly moving, the bug is
  // in CursorAvatar's write to cursorWorldPosition; if it moves
  // but the entity rows in the HUD don't, the bug is in the
  // outbound pump.
  const [localPos, setLocalPos] = useState<[number, number, number]>([0, 0, 0]);
  useEffect(() => {
    const id = window.setInterval(() => {
      setLocalPos([cursorWorldPosition.x, cursorWorldPosition.y, cursorWorldPosition.z]);
    }, 200);
    return () => window.clearInterval(id);
  }, []);

  const players: { id: string; pos: [number, number, number]; route: string; isMe: boolean }[] = [];
  for (const e of entities.values()) {
    if (e.kind !== 'player') {
      continue;
    }
    players.push({
      id: e.id.slice(0, 8),
      pos: e.transform.position,
      route: (e.props as { route?: string }).route ?? '/',
      isMe: e.id === localPlayerId,
    });
  }

  return (
    <div style={styles.root}>
      <div style={styles.line}>
        <strong style={styles.label}>multiplayer</strong>
      </div>
      <div style={styles.line}>
        connected: <span style={styles.value}>{localPlayerId ? 'yes' : 'no'}</span>
      </div>
      <div style={styles.line}>
        entities: <span style={styles.value}>{entities.size}</span> | route:{' '}
        <span style={styles.value}>{currentRoute}</span>
      </div>
      <div style={styles.line}>
        my id: <span style={styles.value}>{localPlayerId?.slice(0, 8) ?? '-'}</span>
      </div>
      <div style={styles.line}>
        local cursorWorldPosition:{' '}
        <span style={styles.value}>[{localPos.map((n) => n.toFixed(1)).join(', ')}]</span>
      </div>
      {players.length === 0 && <div style={styles.dim}>(no players in store)</div>}
      {players.map((p) => (
        <div key={p.id} style={styles.line}>
          {p.isMe ? '★' : '·'} <span style={styles.value}>{p.id}</span> @ [
          {p.pos.map((n) => n.toFixed(1)).join(', ')}] {p.route}
        </div>
      ))}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    position: 'fixed',
    top: 8,
    left: 8,
    padding: '8px 10px',
    background: 'rgba(0, 0, 0, 0.7)',
    color: '#00ffcc',
    fontFamily: 'ui-monospace, monospace',
    fontSize: 11,
    lineHeight: 1.5,
    borderRadius: 4,
    pointerEvents: 'none',
    zIndex: 99999,
    minWidth: 240,
  },
  line: {
    whiteSpace: 'nowrap',
  },
  label: {
    color: '#ff6ec7',
    letterSpacing: 0.5,
  },
  value: {
    color: '#ffffff',
  },
  dim: {
    color: '#666',
    fontStyle: 'italic',
  },
};
