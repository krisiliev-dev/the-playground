/**
 * `/admin` route — token gate (per ADR-009 §menu-integration).
 *
 * Pre-redesign this was a fullscreen takeover with the tabbed
 * admin UI. After redesign: it's just the sign-in page. On
 * submit we save the token and redirect to `/`, where the
 * scene mounts as normal — but with the operator's token
 * detected by the PauseMenu, which surfaces the admin tools
 * inline above the regular menu when M is pressed.
 *
 * If the operator already has a saved token, this page
 * redirects immediately without prompting (covers the
 * page-reload-while-signed-in case).
 */
import { useEffect, useState } from 'react';
import { useAdminToken } from './useAdminToken';

export function AdminPanel(): JSX.Element {
  const { token, setToken } = useAdminToken();
  const [draft, setDraft] = useState('');
  const [autofocusRef, setAutofocusRef] = useState<HTMLInputElement | null>(null);

  // Redirect-on-mount when already signed in.
  useEffect(() => {
    if (token && typeof window !== 'undefined') {
      window.location.replace('/');
    }
  }, [token]);

  // Focus the input on mount so the operator can start typing
  // without a prerequisite click.
  useEffect(() => {
    autofocusRef?.focus();
  }, [autofocusRef]);

  const submit = (): void => {
    const trimmed = draft.trim();
    if (!trimmed) {
      return;
    }
    setToken(trimmed);
    // Replace, not push — the /admin URL shouldn't show up in
    // history once the operator has signed in. They reach the
    // admin tools via M-key from anywhere in the scene.
    if (typeof window !== 'undefined') {
      window.location.replace('/');
    }
  };

  return (
    <div style={styles.root}>
      <form
        style={styles.card}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <h1 style={styles.title}>Admin sign-in</h1>
        <p style={styles.subtitle}>
          Enter the <code>ADMIN_TOKEN</code> the server was started with. After
          signing in, admin controls live inside the in-scene menu (press <kbd>M</kbd>).
        </p>
        <input
          ref={setAutofocusRef}
          type="password"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="ADMIN_TOKEN"
          style={styles.input}
          autoComplete="off"
        />
        <button type="submit" style={styles.submit}>
          Continue
        </button>
        <a href="/" style={styles.back}>
          ← Back to scene
        </a>
      </form>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    position: 'fixed',
    inset: 0,
    background: '#0a0a12',
    color: '#e6f7ff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
  },
  card: {
    width: 360,
    padding: 32,
    background: '#12121a',
    border: '1px solid #1a1a2e',
    borderRadius: 8,
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  },
  title: {
    margin: 0,
    fontSize: 22,
    color: '#00ffcc',
    letterSpacing: 1,
  },
  subtitle: {
    margin: 0,
    fontSize: 13,
    color: '#8aa',
    lineHeight: 1.5,
  },
  input: {
    background: '#0a0a12',
    border: '1px solid #1a1a2e',
    color: '#e6f7ff',
    padding: '10px 12px',
    borderRadius: 4,
    fontSize: 14,
    outline: 'none',
    fontFamily: 'monospace',
  },
  submit: {
    background: '#00ffcc',
    color: '#0a0a12',
    border: 'none',
    padding: '10px',
    borderRadius: 4,
    fontWeight: 600,
    cursor: 'pointer',
    fontSize: 14,
  },
  back: {
    color: '#8aa',
    textDecoration: 'none',
    textAlign: 'center',
    fontSize: 13,
  },
};
