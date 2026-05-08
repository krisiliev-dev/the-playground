/**
 * Quick event trigger — fire a one-shot SceneEvent without
 * authoring a full recipe. Useful for ad-hoc testing of new
 * sounds, shake parameters, particle palettes.
 *
 * Three event kinds covered: audio, camera_shake, particle_burst.
 * Position defaults to "fire at cursor" but can be edited
 * manually for fine placement.
 */
import { useState } from 'react';
import { cursorWorldPosition } from '@/components/scene/cursorWorldPosition';
import {
  AdminAuthError,
  type AdminClient,
  type AdminFireableEvent,
} from './apiClient';

interface Props {
  client: AdminClient;
  onAuthError: () => void;
}

type Kind = 'audio' | 'camera_shake' | 'particle_burst';

export function QuickEventTrigger({ client, onAuthError }: Props): JSX.Element {
  const [kind, setKind] = useState<Kind>('particle_burst');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  // Per-kind form state. Storing each variant's state separately
  // means switching kinds doesn't lose the user's input on the
  // other tab — they can iterate on a particle burst, switch to
  // audio, then switch back without re-typing.
  const [audio, setAudio] = useState({
    sound_id: 'popper',
    volume: 1,
    position_use_cursor: true,
    position: [0, 0, -200] as [number, number, number],
  });
  const [shake, setShake] = useState({
    radius: 200,
    intensity: 0.5,
    duration_ms: 300,
    position: [0, 0, -200] as [number, number, number],
  });
  const [particles, setParticles] = useState({
    count: 200,
    colors: '#ff00aa, #00ffaa, #ffff00, #00aaff, #ff8800',
    speed: 80,
    lifetime_ms: 2500,
    spread: 0.7,
    gravity: 30,
    size: 5,
    spin: 0,
    model_url: '',
    position: [0, 0, -200] as [number, number, number],
  });

  const cursorPos = (): [number, number, number] => [
    cursorWorldPosition.x,
    cursorWorldPosition.y,
    cursorWorldPosition.z,
  ];

  const useCursorFor = (set: (pos: [number, number, number]) => void): void => {
    set(cursorPos());
  };

  const fire = async (): Promise<void> => {
    setError(null);
    setInfo(null);
    let event: AdminFireableEvent;
    try {
      event = buildEvent(kind, audio, shake, particles);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return;
    }
    try {
      await client.fireEvent(event);
      setInfo(`Fired ${kind}`);
    } catch (e) {
      if (e instanceof AdminAuthError) {
        onAuthError();
        return;
      }
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div style={styles.root}>
      <section style={styles.kindRow}>
        {(['audio', 'camera_shake', 'particle_burst'] as Kind[]).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setKind(k)}
            style={{
              ...styles.kindBtn,
              ...(kind === k ? styles.kindBtnActive : null),
            }}
          >
            {k}
          </button>
        ))}
      </section>

      {kind === 'audio' && (
        <section style={styles.fields}>
          <Field label="sound_id">
            <input
              type="text"
              value={audio.sound_id}
              onChange={(e) => setAudio((p) => ({ ...p, sound_id: e.target.value }))}
              style={styles.input}
            />
          </Field>
          <Field label="volume">
            <input
              type="number"
              step="0.1"
              value={audio.volume}
              onChange={(e) =>
                setAudio((p) => ({ ...p, volume: parseFloat(e.target.value) || 0 }))
              }
              style={styles.input}
            />
          </Field>
          <PositionField
            position={audio.position}
            onChange={(p) => setAudio((s) => ({ ...s, position: p }))}
            onUseCursor={() =>
              useCursorFor((p) => setAudio((s) => ({ ...s, position: p })))
            }
          />
        </section>
      )}

      {kind === 'camera_shake' && (
        <section style={styles.fields}>
          <Field label="radius">
            <input
              type="number"
              value={shake.radius}
              onChange={(e) =>
                setShake((p) => ({ ...p, radius: parseFloat(e.target.value) || 0 }))
              }
              style={styles.input}
            />
          </Field>
          <Field label="intensity">
            <input
              type="number"
              step="0.1"
              value={shake.intensity}
              onChange={(e) =>
                setShake((p) => ({ ...p, intensity: parseFloat(e.target.value) || 0 }))
              }
              style={styles.input}
            />
          </Field>
          <Field label="duration_ms">
            <input
              type="number"
              value={shake.duration_ms}
              onChange={(e) =>
                setShake((p) => ({ ...p, duration_ms: parseInt(e.target.value) || 0 }))
              }
              style={styles.input}
            />
          </Field>
          <PositionField
            position={shake.position}
            onChange={(p) => setShake((s) => ({ ...s, position: p }))}
            onUseCursor={() =>
              useCursorFor((p) => setShake((s) => ({ ...s, position: p })))
            }
          />
        </section>
      )}

      {kind === 'particle_burst' && (
        <section style={styles.fields}>
          <Field label="count">
            <input
              type="number"
              value={particles.count}
              onChange={(e) =>
                setParticles((p) => ({
                  ...p,
                  count: parseInt(e.target.value) || 0,
                }))
              }
              style={styles.input}
            />
          </Field>
          <Field label="colors (comma-separated)">
            <input
              type="text"
              value={particles.colors}
              onChange={(e) =>
                setParticles((p) => ({ ...p, colors: e.target.value }))
              }
              style={styles.input}
            />
          </Field>
          <Field label="speed">
            <input
              type="number"
              value={particles.speed}
              onChange={(e) =>
                setParticles((p) => ({
                  ...p,
                  speed: parseFloat(e.target.value) || 0,
                }))
              }
              style={styles.input}
            />
          </Field>
          <Field label="lifetime_ms">
            <input
              type="number"
              value={particles.lifetime_ms}
              onChange={(e) =>
                setParticles((p) => ({
                  ...p,
                  lifetime_ms: parseInt(e.target.value) || 0,
                }))
              }
              style={styles.input}
            />
          </Field>
          <Field label="spread (0..1)">
            <input
              type="number"
              step="0.1"
              value={particles.spread}
              onChange={(e) =>
                setParticles((p) => ({
                  ...p,
                  spread: parseFloat(e.target.value) || 0,
                }))
              }
              style={styles.input}
            />
          </Field>
          <Field label="gravity">
            <input
              type="number"
              value={particles.gravity}
              onChange={(e) =>
                setParticles((p) => ({
                  ...p,
                  gravity: parseFloat(e.target.value) || 0,
                }))
              }
              style={styles.input}
            />
          </Field>
          <Field label="size">
            <input
              type="number"
              step="0.5"
              value={particles.size}
              onChange={(e) =>
                setParticles((p) => ({
                  ...p,
                  size: parseFloat(e.target.value) || 0,
                }))
              }
              style={styles.input}
            />
          </Field>
          <Field label="spin (rad/s)">
            <input
              type="number"
              step="0.5"
              value={particles.spin}
              onChange={(e) =>
                setParticles((p) => ({
                  ...p,
                  spin: parseFloat(e.target.value) || 0,
                }))
              }
              style={styles.input}
            />
          </Field>
          <Field label="model_url (optional, e.g. /assets/ast_….glb)">
            <input
              type="text"
              value={particles.model_url}
              onChange={(e) =>
                setParticles((p) => ({ ...p, model_url: e.target.value }))
              }
              style={styles.input}
              placeholder="(empty for color points)"
            />
          </Field>
          <PositionField
            position={particles.position}
            onChange={(p) => setParticles((s) => ({ ...s, position: p }))}
            onUseCursor={() =>
              useCursorFor((p) => setParticles((s) => ({ ...s, position: p })))
            }
          />
        </section>
      )}

      <div style={styles.actions}>
        <button type="button" style={styles.fireBtn} onClick={() => void fire()}>
          ▶ Fire
        </button>
      </div>
      {error && <div style={styles.error}>{error}</div>}
      {info && <div style={styles.info}>{info}</div>}
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <label style={styles.field}>
      <span style={styles.fieldLabel}>{label}</span>
      {children}
    </label>
  );
}

function PositionField({
  position,
  onChange,
  onUseCursor,
}: {
  position: [number, number, number];
  onChange: (p: [number, number, number]) => void;
  onUseCursor: () => void;
}): JSX.Element {
  return (
    <div style={styles.field}>
      <span style={styles.fieldLabel}>position</span>
      <div style={styles.posRow}>
        {(['x', 'y', 'z'] as const).map((axis, i) => (
          <input
            key={axis}
            type="number"
            value={position[i]}
            onChange={(e) => {
              const next: [number, number, number] = [...position];
              next[i] = parseFloat(e.target.value) || 0;
              onChange(next);
            }}
            style={styles.posInput}
            placeholder={axis}
          />
        ))}
        <button type="button" style={styles.cursorBtn} onClick={onUseCursor}>
          ↑ cursor
        </button>
      </div>
    </div>
  );
}

function buildEvent(
  kind: Kind,
  audio: { sound_id: string; volume: number; position: [number, number, number] },
  shake: {
    radius: number;
    intensity: number;
    duration_ms: number;
    position: [number, number, number];
  },
  p: {
    count: number;
    colors: string;
    speed: number;
    lifetime_ms: number;
    spread: number;
    gravity: number;
    size: number;
    spin: number;
    model_url: string;
    position: [number, number, number];
  },
): AdminFireableEvent {
  if (kind === 'audio') {
    if (!audio.sound_id) {
      throw new Error('sound_id required');
    }
    return {
      kind: 'audio',
      sound_id: audio.sound_id,
      position: audio.position,
      volume: audio.volume,
    };
  }
  if (kind === 'camera_shake') {
    return {
      kind: 'camera_shake',
      position: shake.position,
      radius: shake.radius,
      intensity: shake.intensity,
      duration_ms: shake.duration_ms,
    };
  }
  const colors = p.colors
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (colors.length === 0) {
    throw new Error('colors must list at least one hex value');
  }
  return {
    kind: 'particle_burst',
    position: p.position,
    count: p.count,
    colors,
    speed: p.speed,
    lifetime_ms: p.lifetime_ms,
    spread: p.spread,
    gravity: p.gravity,
    size: p.size,
    spin: p.spin,
    model_url: p.model_url || null,
  };
}

const styles: Record<string, React.CSSProperties> = {
  root: { display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 720 },
  kindRow: { display: 'flex', gap: 4 },
  kindBtn: {
    background: 'transparent',
    border: '1px solid #1a1a2e',
    color: '#8aa',
    padding: '6px 14px',
    borderRadius: 4,
    cursor: 'pointer',
    fontSize: 13,
    fontFamily: 'monospace',
  },
  kindBtnActive: { color: '#00ffcc', borderColor: '#00ffcc' },
  fields: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: 12,
    background: '#0c1418',
    border: '1px solid #1a1a2e',
    borderRadius: 6,
    padding: 16,
  },
  field: { display: 'flex', flexDirection: 'column', gap: 4 },
  fieldLabel: {
    fontSize: 11,
    color: '#8aa',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  input: {
    background: '#0a0a12',
    border: '1px solid #1a1a2e',
    color: '#e6f7ff',
    padding: '6px 10px',
    borderRadius: 4,
    fontSize: 13,
    fontFamily: 'monospace',
    outline: 'none',
  },
  posRow: { display: 'flex', gap: 4 },
  posInput: {
    flex: 1,
    background: '#0a0a12',
    border: '1px solid #1a1a2e',
    color: '#e6f7ff',
    padding: '6px 8px',
    borderRadius: 4,
    fontSize: 12,
    fontFamily: 'monospace',
    outline: 'none',
    minWidth: 0,
  },
  cursorBtn: {
    background: '#0c1418',
    border: '1px solid #00ffcc',
    color: '#00ffcc',
    padding: '4px 10px',
    borderRadius: 4,
    cursor: 'pointer',
    fontSize: 11,
    whiteSpace: 'nowrap',
  },
  actions: { display: 'flex', gap: 8 },
  fireBtn: {
    background: '#00ffcc',
    color: '#0a0a12',
    border: 'none',
    padding: '10px 24px',
    borderRadius: 4,
    fontWeight: 600,
    cursor: 'pointer',
    fontSize: 14,
  },
  error: {
    color: '#ff5577',
    background: '#2a0a14',
    border: '1px solid #ff5577',
    padding: '8px 12px',
    borderRadius: 4,
    fontSize: 13,
    fontFamily: 'monospace',
  },
  info: {
    color: '#00ffcc',
    background: '#0c1820',
    border: '1px solid #00ffcc',
    padding: '8px 12px',
    borderRadius: 4,
    fontSize: 13,
    fontFamily: 'monospace',
  },
};
