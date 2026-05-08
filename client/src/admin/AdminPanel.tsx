/**
 * Admin panel — operator UI over the recipe / asset / event
 * endpoints. Mounted by the App when the URL matches `/admin`.
 *
 * Layout: full-screen overlay above the canvas with a tab
 * switcher between three sub-panels (assets, recipes, quick
 * trigger). A token gate covers the whole panel until the
 * operator enters a valid `ADMIN_TOKEN`.
 *
 * Why an overlay rather than a separate Document Mode page:
 * triggering an effect from the recipe panel and watching it
 * land in the live cube is the whole point of the admin UI. The
 * overlay sits *over* the canvas, but the canvas continues to
 * render and the recipe trigger fires through the same WS
 * receiver every other player uses.
 */
import { useEffect, useMemo, useState } from 'react';
import { useWorldStore } from '@/store';
import { createAdminClient, type AdminClient } from './apiClient';
import { useAdminToken } from './useAdminToken';
import { AssetUploader } from './AssetUploader';
import { RecipeEditor } from './RecipeEditor';
import { QuickEventTrigger } from './QuickEventTrigger';
import { PlayersPanel } from './PlayersPanel';
import { VideoJobs } from './VideoJobs';

type Tab = 'recipes' | 'assets' | 'trigger' | 'players' | 'videos';

export function AdminPanel(): JSX.Element {
  const { token, setToken, clearToken } = useAdminToken();
  const [tab, setTab] = useState<Tab>('recipes');

  // One client instance per token. New token = new client, so
  // the panels (which capture `client` in closures / effects)
  // pick up the change without manual re-binding.
  const client: AdminClient | null = useMemo(
    () => (token ? createAdminClient(token) : null),
    [token],
  );

  if (!client) {
    return <TokenGate onSubmit={setToken} />;
  }

  return (
    <div style={styles.root}>
      <header style={styles.header}>
        <div style={styles.title}>Admin</div>
        <nav style={styles.tabs}>
          <TabButton current={tab} value="recipes" onClick={setTab}>
            Recipes
          </TabButton>
          <TabButton current={tab} value="assets" onClick={setTab}>
            Assets
          </TabButton>
          <TabButton current={tab} value="trigger" onClick={setTab}>
            Trigger
          </TabButton>
          <TabButton current={tab} value="players" onClick={setTab}>
            Players
          </TabButton>
          <TabButton current={tab} value="videos" onClick={setTab}>
            Videos
          </TabButton>
        </nav>
        <div style={styles.headerRight}>
          <NoClipToggle />
          <a href="/" style={styles.linkBack}>
            ← Back to scene
          </a>
          <button onClick={clearToken} style={styles.signOut} type="button">
            Sign out
          </button>
        </div>
      </header>
      <main style={styles.main}>
        {tab === 'recipes' && <RecipeEditor client={client} onAuthError={clearToken} />}
        {tab === 'assets' && <AssetUploader client={client} onAuthError={clearToken} />}
        {tab === 'trigger' && <QuickEventTrigger client={client} onAuthError={clearToken} />}
        {tab === 'players' && <PlayersPanel client={client} onAuthError={clearToken} />}
        {tab === 'videos' && <VideoJobs token={token} />}
      </main>
    </div>
  );
}

/** No-clip toggle. Persists across reloads via localStorage
 *  (handled inside the store action). Visible in the header so
 *  the operator can flip it on without leaving the current tab. */
function NoClipToggle(): JSX.Element {
  const noClip = useWorldStore((s) => s.adminNoClip);
  const setNoClip = useWorldStore((s) => s.setAdminNoClip);
  return (
    <label style={styles.noClipLabel}>
      <input
        type="checkbox"
        checked={noClip}
        onChange={(e) => setNoClip(e.target.checked)}
        style={styles.noClipCheckbox}
      />
      <span>No-clip</span>
    </label>
  );
}

function TabButton({
  current,
  value,
  onClick,
  children,
}: {
  current: Tab;
  value: Tab;
  onClick: (next: Tab) => void;
  children: React.ReactNode;
}): JSX.Element {
  const isActive = current === value;
  return (
    <button
      type="button"
      onClick={() => onClick(value)}
      style={{
        ...styles.tabButton,
        ...(isActive ? styles.tabButtonActive : null),
      }}
    >
      {children}
    </button>
  );
}

function TokenGate({ onSubmit }: { onSubmit: (token: string) => void }): JSX.Element {
  const [draft, setDraft] = useState('');
  const [autofocusRef, setAutofocusRef] = useState<HTMLInputElement | null>(null);

  // Focus the input on mount so the operator can just start
  // typing — no extra click after navigating to /admin.
  useEffect(() => {
    autofocusRef?.focus();
  }, [autofocusRef]);

  const submit = (): void => {
    const trimmed = draft.trim();
    if (trimmed) {
      onSubmit(trimmed);
    }
  };

  return (
    <div style={styles.gateRoot}>
      <form
        style={styles.gateCard}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <h1 style={styles.gateTitle}>Admin sign-in</h1>
        <p style={styles.gateSubtitle}>
          Enter the <code>ADMIN_TOKEN</code> the server was started with.
        </p>
        <input
          ref={setAutofocusRef}
          type="password"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="ADMIN_TOKEN"
          style={styles.gateInput}
          autoComplete="off"
        />
        <button type="submit" style={styles.gateSubmit}>
          Continue
        </button>
        <a href="/" style={styles.gateBack}>
          ← Back to scene
        </a>
      </form>
    </div>
  );
}

// Styles inline so the admin panel doesn't depend on a global
// CSS file the rest of the app might churn under it. Plain
// dark-on-cyan to match the cyberpunk grid palette.
const styles: Record<string, React.CSSProperties> = {
  root: {
    position: 'fixed',
    inset: 0,
    background: '#0a0a12',
    color: '#e6f7ff',
    display: 'flex',
    flexDirection: 'column',
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
    zIndex: 1000,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 24px',
    borderBottom: '1px solid #1a1a2e',
    gap: 24,
  },
  title: {
    fontSize: 18,
    fontWeight: 600,
    color: '#00ffcc',
    letterSpacing: 1,
  },
  tabs: {
    display: 'flex',
    gap: 4,
  },
  headerRight: {
    display: 'flex',
    alignItems: 'center',
    gap: 16,
  },
  tabButton: {
    background: 'transparent',
    border: '1px solid transparent',
    color: '#8aa',
    padding: '6px 14px',
    borderRadius: 4,
    cursor: 'pointer',
    fontSize: 13,
    transition: 'all 0.15s',
  },
  tabButtonActive: {
    color: '#00ffcc',
    borderColor: '#00ffcc',
  },
  signOut: {
    background: 'transparent',
    border: '1px solid #444',
    color: '#aaa',
    padding: '6px 12px',
    borderRadius: 4,
    cursor: 'pointer',
    fontSize: 12,
  },
  linkBack: {
    color: '#8aa',
    textDecoration: 'none',
    fontSize: 13,
  },
  noClipLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    color: '#8aa',
    fontSize: 12,
    cursor: 'pointer',
    userSelect: 'none',
  },
  noClipCheckbox: {
    accentColor: '#00ffcc',
    cursor: 'pointer',
  },
  main: {
    flex: 1,
    overflow: 'auto',
    padding: 24,
  },
  gateRoot: {
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
  gateCard: {
    width: 360,
    padding: 32,
    background: '#12121a',
    border: '1px solid #1a1a2e',
    borderRadius: 8,
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  },
  gateTitle: {
    margin: 0,
    fontSize: 22,
    color: '#00ffcc',
    letterSpacing: 1,
  },
  gateSubtitle: {
    margin: 0,
    fontSize: 13,
    color: '#8aa',
    lineHeight: 1.5,
  },
  gateInput: {
    background: '#0a0a12',
    border: '1px solid #1a1a2e',
    color: '#e6f7ff',
    padding: '10px 12px',
    borderRadius: 4,
    fontSize: 14,
    outline: 'none',
    fontFamily: 'monospace',
  },
  gateSubmit: {
    background: '#00ffcc',
    color: '#0a0a12',
    border: 'none',
    padding: '10px',
    borderRadius: 4,
    fontWeight: 600,
    cursor: 'pointer',
    fontSize: 14,
  },
  gateBack: {
    color: '#8aa',
    textDecoration: 'none',
    textAlign: 'center',
    fontSize: 13,
  },
};
