/**
 * Video conversion panel — submits YouTube URLs to the legacy
 * conversion service (separate from the playground game server,
 * different host) and lists in-flight + completed jobs.
 *
 * Kept as a sub-panel so the operator has every admin surface
 * in one place. Uses the same `token` the rest of the panels do
 * — the assumption is that the operator picks a single
 * `ADMIN_TOKEN` value across services. If they diverge, this
 * panel surfaces the auth failure as a normal error string and
 * the operator can re-enter the token.
 */
import { useCallback, useEffect, useState } from 'react';
import { convertVideo, listAllJobs, type VideoJob } from '@/api/videos';

interface Props {
  token: string;
}

export function VideoJobs({ token }: Props): JSX.Element {
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [jobs, setJobs] = useState<VideoJob[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!token) {
      return;
    }
    try {
      setJobs(await listAllJobs(token));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [token]);

  // Poll while mounted — jobs progress through downloading →
  // converting → ready/failed asynchronously, and the legacy
  // service has no push notification.
  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), 2000);
    return () => window.clearInterval(interval);
  }, [refresh]);

  const onSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await convertVideo(token, url.trim(), name.trim());
      setUrl('');
      setName('');
      void refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={styles.root}>
      <form onSubmit={(e) => void onSubmit(e)} style={styles.form}>
        <label style={styles.label}>
          YouTube URL
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://www.youtube.com/watch?v=..."
            required
            style={styles.input}
          />
        </label>
        <label style={styles.label}>
          Name (filename slug)
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="antarctica_snow"
            required
            style={styles.input}
          />
        </label>
        <button type="submit" disabled={busy} style={styles.button}>
          {busy ? 'Queuing…' : 'Convert'}
        </button>
      </form>

      {error && <p style={styles.error}>{error}</p>}

      <h2 style={styles.subheading}>Jobs ({jobs.length})</h2>
      {jobs.length === 0 ? (
        <p style={styles.muted}>No jobs yet.</p>
      ) : (
        <ul style={styles.list}>
          {[...jobs]
            .sort((a, b) => b.created_at.localeCompare(a.created_at))
            .map((j) => (
              <li key={j.id} style={styles.listItem}>
                <div style={styles.jobHeader}>
                  <strong>{j.name}</strong>
                  <span style={badge(j.status.state)}>{j.status.state}</span>
                </div>
                <div style={styles.muted}>{j.youtube_url}</div>
                {j.status.state === 'ready' && (
                  <a href={j.status.url} style={styles.link}>
                    {j.status.url}
                  </a>
                )}
                {j.status.state === 'failed' && (
                  <pre style={styles.errorBlock}>{j.status.error}</pre>
                )}
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}

function badge(state: string): React.CSSProperties {
  return {
    fontSize: 10,
    padding: '2px 8px',
    borderRadius: 999,
    backgroundColor:
      state === 'ready' ? '#00ffcc22' : state === 'failed' ? '#ff6b6b22' : '#ffcc0022',
    color: state === 'ready' ? '#00ffcc' : state === 'failed' ? '#ff6b6b' : '#ffcc00',
    border: `1px solid ${
      state === 'ready' ? '#00ffcc' : state === 'failed' ? '#ff6b6b' : '#ffcc00'
    }33`,
  };
}

const styles: Record<string, React.CSSProperties> = {
  root: { maxWidth: 720, display: 'flex', flexDirection: 'column', gap: 16 },
  subheading: { fontSize: 14, color: '#00ffcc', marginTop: 16, marginBottom: 8 },
  label: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    fontSize: 12,
    color: '#8aa',
  },
  input: {
    backgroundColor: '#0a0a12',
    border: '1px solid #1a1a2e',
    color: '#e6f7ff',
    padding: '10px 12px',
    fontFamily: 'monospace',
    fontSize: 13,
    borderRadius: 4,
    outline: 'none',
  },
  form: { display: 'flex', flexDirection: 'column', gap: 12 },
  button: {
    backgroundColor: '#00ffcc',
    color: '#0a0a12',
    border: 'none',
    padding: '10px 16px',
    fontSize: 13,
    fontWeight: 600,
    borderRadius: 4,
    cursor: 'pointer',
    alignSelf: 'flex-start',
  },
  error: { color: '#ff6b6b', fontSize: 13, margin: 0 },
  errorBlock: {
    color: '#ff6b6b',
    fontSize: 11,
    whiteSpace: 'pre-wrap',
    backgroundColor: '#1a1a22',
    padding: 8,
    borderRadius: 4,
    maxHeight: 200,
    overflow: 'auto',
  },
  muted: { color: '#667', fontSize: 12 },
  list: {
    listStyle: 'none',
    padding: 0,
    margin: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  listItem: {
    backgroundColor: '#0c1418',
    border: '1px solid #1a1a2e',
    borderRadius: 4,
    padding: 12,
  },
  jobHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  link: { color: '#00ffcc', fontSize: 12, wordBreak: 'break-all' },
};
