/**
 * HUD — the heads-up display rendered as HTML on top of the 3D canvas.
 *
 * This is the "normal website" layer: headers, navigation breadcrumbs,
 * zone labels, and any UI that shouldn't exist in 3D space.
 * It's a regular React component (not R3F), so normal DOM rules apply.
 */

import { useWorldStore } from '@/store';

/**
 * A minimal HUD showing the current zone and navigation hints.
 * Will be expanded with a proper header, breadcrumbs, and overlays.
 */
export function HUD(): JSX.Element {
  const activeZoneId = useWorldStore((s) => s.activeZoneId);
  const setActiveZone = useWorldStore((s) => s.setActiveZone);
  const zones = useWorldStore((s) => s.environment.zones);

  const activeZone = zones.find((z) => z.id === activeZoneId);

  return (
    <div style={styles.container}>
      {/* Top bar */}
      <header style={styles.header}>
        <h1 style={styles.title}>The Playground</h1>
        {activeZone && (
          <button onClick={() => setActiveZone(null)} style={styles.backButton} aria-label="Return">
            ← Back
          </button>
        )}
      </header>

      {/* Current zone indicator */}
      {activeZone && <div style={styles.zoneIndicator}>{activeZone.label}</div>}

      {/* Navigation hint — only shown when free-roaming */}
      {!activeZone && <div style={styles.hint}>Scroll to explore · Click a marker to visit</div>}
    </div>
  );
}

// ─── Inline styles (will move to CSS Modules later) ──────────────

const styles: Record<string, React.CSSProperties> = {
  container: {
    position: 'absolute',
    inset: 0,
    pointerEvents: 'none',
    zIndex: 10,
    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
    color: '#ffffff',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '20px 28px',
    pointerEvents: 'auto',
  },
  title: {
    fontSize: '14px',
    fontWeight: 600,
    letterSpacing: '0.15em',
    textTransform: 'uppercase' as const,
    margin: 0,
    opacity: 0.7,
  },
  backButton: {
    background: 'rgba(255,255,255,0.1)',
    border: '1px solid rgba(255,255,255,0.2)',
    color: '#fff',
    padding: '6px 14px',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '12px',
    fontFamily: 'inherit',
    letterSpacing: '0.05em',
  },
  zoneIndicator: {
    position: 'absolute' as const,
    bottom: '80px',
    left: '50%',
    transform: 'translateX(-50%)',
    fontSize: '24px',
    fontWeight: 700,
    letterSpacing: '0.2em',
    textTransform: 'uppercase' as const,
    textShadow: '0 0 20px rgba(0,255,136,0.4)',
  },
  hint: {
    position: 'absolute' as const,
    bottom: '28px',
    left: '50%',
    transform: 'translateX(-50%)',
    fontSize: '11px',
    opacity: 0.4,
    letterSpacing: '0.1em',
  },
};
