/**
 * Admin section rendered inside the pause menu — the tabbed
 * UI that used to be the fullscreen `/admin` takeover. Sits
 * above the regular menu card when the operator has signed in
 * with an admin token (per ADR-009 §menu-integration).
 *
 * Why merge into the menu instead of a separate fullscreen
 * route: triggering an admin effect (kick, recipe play, freeze)
 * and watching the world react in the same view is the whole
 * point of admin tools. The fullscreen takeover meant the
 * operator had to switch tabs / windows to see effects land.
 *
 * The component itself is a thin shell — it takes a `client`
 * + `onAuthError`, renders tab buttons, and switches between
 * the existing sub-panels (which haven't changed).
 */
import { useMemo, useState } from 'react';
import { useWorldStore } from '@/store';
import { createAdminClient, type AdminClient } from './apiClient';
import { useAdminToken } from './useAdminToken';
import { AssetUploader } from './AssetUploader';
import { RecipeEditor } from './RecipeEditor';
import { QuickEventTrigger } from './QuickEventTrigger';
import { PlayersPanel } from './PlayersPanel';

type Tab = 'recipes' | 'assets' | 'trigger' | 'players';

export function AdminMenuSection(): JSX.Element | null {
  const { token, clearToken } = useAdminToken();
  const [tab, setTab] = useState<Tab>('players');

  // No token = nothing to render; PauseMenu skips this section.
  // Same one-client-per-token discipline as before.
  const client: AdminClient | null = useMemo(
    () => (token ? createAdminClient(token) : null),
    [token],
  );

  if (!client || !token) {
    return null;
  }

  return (
    <div style={styles.root}>
      <header style={styles.header}>
        <div style={styles.title}>Admin</div>
        <nav style={styles.tabs}>
          <TabButton current={tab} value="players" onClick={setTab}>
            Players
          </TabButton>
          <TabButton current={tab} value="recipes" onClick={setTab}>
            Recipes
          </TabButton>
          <TabButton current={tab} value="assets" onClick={setTab}>
            Assets
          </TabButton>
          <TabButton current={tab} value="trigger" onClick={setTab}>
            Trigger
          </TabButton>
        </nav>
        <div style={styles.headerRight}>
          <NoClipToggle />
          <button onClick={clearToken} style={styles.signOut} type="button">
            Sign out
          </button>
        </div>
      </header>
      <main style={styles.body}>
        {tab === 'players' && <PlayersPanel client={client} onAuthError={clearToken} />}
        {tab === 'recipes' && <RecipeEditor client={client} onAuthError={clearToken} />}
        {tab === 'assets' && <AssetUploader client={client} onAuthError={clearToken} />}
        {tab === 'trigger' && <QuickEventTrigger client={client} onAuthError={clearToken} />}
      </main>
    </div>
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

const styles: Record<string, React.CSSProperties> = {
  root: {
    width: '90vw',
    maxWidth: 1100,
    // Cap at 50vh so the regular menu card (~480px) below
    // still fits inside a 1024px-tall viewport without
    // forcing the user to scroll. On taller monitors there's
    // headroom to spare; on shorter ones the admin body
    // scrolls internally.
    maxHeight: '50vh',
    minHeight: 240,
    background: 'rgba(10, 10, 18, 0.96)',
    border: '1px solid rgba(0, 255, 204, 0.4)',
    borderRadius: 12,
    color: '#e6f7ff',
    boxShadow: '0 0 32px rgba(0, 255, 204, 0.18)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 20px',
    borderBottom: '1px solid #1a1a2e',
    gap: 16,
    flexShrink: 0,
  },
  title: {
    fontSize: 14,
    fontWeight: 600,
    color: '#00ffcc',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  tabs: { display: 'flex', gap: 4 },
  headerRight: { display: 'flex', alignItems: 'center', gap: 12 },
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
    padding: '4px 10px',
    borderRadius: 4,
    cursor: 'pointer',
    fontSize: 11,
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
  noClipCheckbox: { accentColor: '#00ffcc', cursor: 'pointer' },
  body: {
    flex: 1,
    minHeight: 0,
    overflow: 'auto',
    padding: 20,
  },
};
