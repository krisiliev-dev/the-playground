import { useCallback, useEffect, useState } from 'react';
import { convertVideo, listAllJobs, type VideoJob } from '@/api/videos';

const TOKEN_KEY = 'playground_admin_token';

export function AdminPanel(): JSX.Element {
  const [token, setToken] = useState<string>(() => localStorage.getItem(TOKEN_KEY) ?? '');
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [jobs, setJobs] = useState<VideoJob[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const saveToken = useCallback((next: string) => {
    setToken(next);
    localStorage.setItem(TOKEN_KEY, next);
  }, []);

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

  useEffect(() => {
    void refresh();
    const interval = setInterval(() => void refresh(), 2000);
    return () => clearInterval(interval);
  }, [refresh]);

  const onSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!token) {
      setError('Paste your admin token first');
      return;
    }
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
      <h1 style={styles.heading}>Playground · Admin</h1>

      <label style={styles.label}>
        Admin token
        <input
          type="password"
          value={token}
          onChange={(e) => saveToken(e.target.value)}
          placeholder="paste ADMIN_TOKEN here"
          style={styles.input}
        />
      </label>

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
          Name (used as filename slug)
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

      {error ? <p style={styles.error}>{error}</p> : null}

      <h2 style={styles.subheading}>Jobs</h2>
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
                  <span style={styles.badge(j.status.state)}>{j.status.state}</span>
                </div>
                <div style={styles.muted}>{j.youtube_url}</div>
                {j.status.state === 'ready' ? (
                  <a href={j.status.url} style={styles.link}>
                    {j.status.url}
                  </a>
                ) : null}
                {j.status.state === 'failed' ? (
                  <pre style={styles.errorBlock}>{j.status.error}</pre>
                ) : null}
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}

const styles = {
  root: {
    minHeight: '100vh',
    backgroundColor: '#0a0a12',
    color: '#e6e6f0',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    padding: '32px',
    maxWidth: 720,
    margin: '0 auto',
  } satisfies React.CSSProperties,
  heading: { fontSize: 20, color: '#00ffcc', marginBottom: 24 },
  subheading: { fontSize: 14, color: '#00ffcc', marginTop: 32, marginBottom: 8 },
  label: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    fontSize: 12,
    color: '#8888a0',
    marginBottom: 16,
  } satisfies React.CSSProperties,
  input: {
    backgroundColor: '#12121a',
    border: '1px solid #2a2a3a',
    color: '#e6e6f0',
    padding: '10px 12px',
    fontFamily: 'inherit',
    fontSize: 14,
    borderRadius: 4,
    outline: 'none',
  } satisfies React.CSSProperties,
  form: { display: 'flex', flexDirection: 'column' } satisfies React.CSSProperties,
  button: {
    backgroundColor: '#00ffcc',
    color: '#0a0a12',
    border: 'none',
    padding: '10px 16px',
    fontFamily: 'inherit',
    fontSize: 14,
    fontWeight: 600,
    borderRadius: 4,
    cursor: 'pointer',
    marginTop: 8,
  } satisfies React.CSSProperties,
  error: { color: '#ff6b6b', fontSize: 13, marginTop: 8 },
  errorBlock: {
    color: '#ff6b6b',
    fontSize: 11,
    whiteSpace: 'pre-wrap' as const,
    backgroundColor: '#1a1a22',
    padding: 8,
    borderRadius: 4,
    maxHeight: 200,
    overflow: 'auto',
  } satisfies React.CSSProperties,
  muted: { color: '#8888a0', fontSize: 12 },
  list: {
    listStyle: 'none',
    padding: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  } satisfies React.CSSProperties,
  listItem: {
    backgroundColor: '#12121a',
    border: '1px solid #2a2a3a',
    borderRadius: 4,
    padding: 12,
  } satisfies React.CSSProperties,
  jobHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  } satisfies React.CSSProperties,
  badge: (state: string): React.CSSProperties => ({
    fontSize: 10,
    padding: '2px 8px',
    borderRadius: 999,
    backgroundColor:
      state === 'ready' ? '#00ffcc22' : state === 'failed' ? '#ff6b6b22' : '#ffcc0022',
    color: state === 'ready' ? '#00ffcc' : state === 'failed' ? '#ff6b6b' : '#ffcc00',
    border: `1px solid ${
      state === 'ready' ? '#00ffcc' : state === 'failed' ? '#ff6b6b' : '#ffcc00'
    }33`,
  }),
  link: { color: '#00ffcc', fontSize: 12, wordBreak: 'break-all' as const },
};
