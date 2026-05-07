/**
 * Read-only visual mirror of the local `PauseMenu` for use as a
 * third-person presence indicator over remote cursors. Same
 * styling, no click handlers, no state, no react-router lookups.
 * Renders the menu structure as-of-pause for an observer who's
 * watching another player navigate their own menu.
 *
 * Kept hand-synced with `PauseMenu.tsx`'s visual layout — when
 * the local menu's appearance changes, mirror it here. The clean
 * alternative is to extract a shared visual-only component;
 * deferred until the duplication actually causes drift.
 */
import type { CSSProperties } from 'react';

const NAV_LABELS = ['Home', 'About', 'Projects', 'Writing'] as const;

const KEYMAP: ReadonlyArray<{ key: string; desc: string }> = [
  { key: 'M', desc: 'open / close menu' },
  { key: 'W A S D', desc: 'walk' },
  { key: 'mouse', desc: 'look around' },
  { key: 'click / hold', desc: 'interact' },
];

export function RemotePauseMenuView(): JSX.Element {
  return (
    <div style={styles.card}>
      <h2 style={styles.heading}>Menu</h2>

      <nav style={styles.nav} aria-label="Sections">
        {NAV_LABELS.map((label) => (
          <div key={label} style={styles.navLink}>
            {label}
          </div>
        ))}
      </nav>

      <div style={styles.item}>Contact ▸</div>
      <div style={styles.item}>Simple Experience →</div>
      <div style={styles.item}>Audio: on</div>

      <div style={styles.controls}>
        <div style={styles.controlsSummary}>Controls</div>
        <ul style={styles.keymap}>
          {KEYMAP.map((km) => (
            <li key={km.key} style={styles.keymapItem}>
              <span style={styles.keymapKey}>{km.key}</span>
              <span style={styles.keymapDesc}>{km.desc}</span>
            </li>
          ))}
        </ul>
      </div>

      <p style={styles.hint}>press M or click outside to close</p>
    </div>
  );
}

// Styles mirror the local PauseMenu's `card` and child styles
// (see overlay/PauseMenu.tsx). Backdrop intentionally omitted —
// the back plate behind the Html in 3D handles the "solid
// background" role; the card itself supplies the bordered panel.
const styles: Record<string, CSSProperties> = {
  card: {
    minWidth: 280,
    maxWidth: 380,
    width: 320,
    padding: '28px 32px',
    background: 'rgba(18, 18, 26, 0.92)',
    border: '1px solid rgba(0, 255, 204, 0.4)',
    borderRadius: 12,
    color: '#e0fffa',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    boxShadow: '0 0 24px rgba(0, 255, 204, 0.18)',
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  heading: {
    margin: '0 0 12px',
    fontSize: 12,
    fontWeight: 600,
    letterSpacing: '0.2em',
    textTransform: 'uppercase',
    color: '#00ffcc',
    textAlign: 'center',
  },
  item: {
    background: 'transparent',
    border: '1px solid rgba(0, 255, 204, 0.25)',
    borderRadius: 6,
    color: '#e0fffa',
    fontFamily: 'inherit',
    fontSize: 14,
    padding: '10px 14px',
    textAlign: 'left',
  },
  nav: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 6,
    margin: '6px 0',
  },
  navLink: {
    background: 'transparent',
    border: '1px solid rgba(0, 255, 204, 0.25)',
    borderRadius: 6,
    color: '#e0fffa',
    fontSize: 14,
    padding: '10px 14px',
    textAlign: 'center',
  },
  controls: {
    background: 'transparent',
    border: '1px solid rgba(0, 255, 204, 0.15)',
    borderRadius: 6,
    padding: '8px 14px',
    fontSize: 13,
  },
  controlsSummary: {
    color: 'rgba(224, 255, 250, 0.85)',
  },
  keymap: {
    margin: '8px 0 0',
    padding: 0,
    listStyle: 'none',
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  keymapItem: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    fontSize: 12,
  },
  keymapKey: {
    fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
    color: '#00ffcc',
    border: '1px solid rgba(0, 255, 204, 0.3)',
    borderRadius: 3,
    padding: '1px 6px',
  },
  keymapDesc: {
    color: 'rgba(224, 255, 250, 0.7)',
    marginLeft: 12,
  },
  hint: {
    margin: '12px 0 0',
    fontSize: 11,
    color: 'rgba(0, 255, 204, 0.55)',
    textAlign: 'center',
  },
};
