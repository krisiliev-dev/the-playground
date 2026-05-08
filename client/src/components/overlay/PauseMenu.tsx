/**
 * PauseMenu — translucent overlay summoned by `Esc` (desktop) or the
 * `≡` icon top-right (mobile, the only persistent UI on touch).
 *
 * Holds: Back, four section shortcuts, Contact card, Simple Experience
 * toggle (placeholder until step 4 of ADR-003), Audio mute, Controls
 * reference.
 *
 * This is the single auxiliary-UI surface for the entire app per
 * ADR-003 — the 3D experience must not be cluttered with persistent
 * overlay buttons. Anything that needs to be "always available" lives
 * behind this menu.
 *
 * The menu does not close on route change — clicking a section
 * shortcut explicitly invokes `setOpen(false)` so the user lands on
 * the new section without the menu still in the way.
 */
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useLocation } from 'react-router-dom';
import { useWorldStore } from '@/store';
import { FLAT_ROUTES } from '@/content/routes';
import { acquirePointerLock, useIsTouchPrimary } from '@/utils';
import { AdminMenuSection } from '@/admin/AdminMenuSection';

interface NavItem {
  readonly path: string;
  readonly label: string;
}

/** Top-level nav items shown in the menu. Each path must correspond
 *  to a route declared in `routes.ts` with an `entryPoint` — the
 *  click writes `pendingAvatarTeleport`, which CursorAvatar consumes
 *  by snapping the avatar to that route's bob-compensated entry
 *  point. The avatar's per-frame bbox-routing then derives the URL
 *  from the new position, and RouteSync mirrors it into the URL bar. */
const NAV_ITEMS: ReadonlyArray<NavItem> = [
  { path: '/', label: 'Home' },
  { path: '/about', label: 'About' },
  { path: '/projects', label: 'Projects' },
  { path: '/writing', label: 'Writing' },
];

const KEYMAP_DESKTOP: ReadonlyArray<{ key: string; desc: string }> = [
  { key: 'M', desc: 'open / close menu' },
  { key: 'W A S D', desc: 'walk' },
  { key: 'mouse', desc: 'look around' },
  { key: 'click / hold', desc: 'interact' },
];

const KEYMAP_TOUCH: ReadonlyArray<{ key: string; desc: string }> = [
  { key: '≡', desc: 'open/close menu' },
  { key: '2 fingers', desc: 'pinch to walk' },
  { key: '1 finger', desc: 'swipe to look' },
  { key: 'tap / hold', desc: 'interact' },
];

export function PauseMenu(): JSX.Element | null {
  const [open, setOpen] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);
  // The mute preference lives in the store so App's audio-mute
  // effect can combine it with documentMode (the AudioContext is
  // independent of the render loop, so wallAmbient and other
  // looped sounds would keep playing into the document otherwise).
  const muted = useWorldStore((s) => s.muted);
  const setMuted = useWorldStore((s) => s.setMuted);
  const location = useLocation();
  const isTouch = useIsTouchPrimary();
  const firstFocusRef = useRef<HTMLButtonElement>(null);

  // M is the only menu key. Esc is *not* used: it has irreducible
  // browser side effects (Chrome releases pointer-lock, Safari
  // additionally exits fullscreen) that fire every time it's pressed,
  // even when used "only to close" the menu. Letting Esc do its native
  // browser thing without our interception is the cleaner UX.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // Don't capture from text inputs (admin panel typing, future
      // forms). The user wants the platform behaviour there, not us.
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) {
          return;
        }
      }
      if (e.key.toLowerCase() === 'm') {
        setOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Side effects of opening/closing the menu — propagate to the
  // store, release pointer-lock on open, RE-ACQUIRE pointer-lock on
  // close (when in avatar mode), force-end any in-progress press.
  //
  // The re-acquisition matters: without it, the next click after
  // close would be consumed by the canvas's "click → request
  // pointer-lock" handler AND would also fire a 3D interactable
  // press for whatever happens to be under screen-centre. Two
  // clicks of perceived weirdness instead of one. Re-acquiring
  // here, on the same user gesture that closed the menu, means
  // the user is back in 3D mode immediately with no naked click.
  //
  // wasOpen ref tracks the previous state so the initial mount
  // (open=false, but never been open) doesn't trigger the close-
  // side-effects.
  const wasOpen = useRef(false);
  useEffect(() => {
    useWorldStore.getState().setMenuOpen(open);
    if (open) {
      if (document.pointerLockElement) {
        document.exitPointerLock?.();
      }
      useWorldStore.getState().endInteractPress();
    } else if (wasOpen.current) {
      // Only re-acquire when in avatar mode (controlsDismissed).
      // Outside avatar mode, pointer-lock isn't expected to be
      // active so re-acquiring would surprise the user.
      if (useWorldStore.getState().controlsDismissed) {
        acquirePointerLock();
      }
    }
    wasOpen.current = open;
  }, [open]);

  // Focus the first interactive item on open so keyboard navigation
  // works without a mouse hand-off. Re-running on every open is
  // intentional — it resets focus each time, which is the expected
  // dialog behaviour.
  useEffect(() => {
    if (open && firstFocusRef.current) {
      firstFocusRef.current.focus();
    }
  }, [open]);

  const close = (): void => setOpen(false);

  // Nav handler — write a teleport request, close the menu. The
  // avatar's frame loop snaps to the route's entry point on the
  // next tick; RouteSync's avatar→URL effect mirrors the new
  // route into the URL bar. One signal, one frame, both views
  // updated.
  const handleNav = (path: string): void => {
    close();
    // Disable the no-op case where the user clicks the route they
    // are already on — the URL hasn't drifted, the teleport would
    // just snap them to the entry point of where they already are.
    if (location.pathname === path) {
      return;
    }
    // Verify the path is a registered route before writing the
    // teleport — guards against typos in NAV_ITEMS that would
    // otherwise silently no-op inside CursorAvatar.
    const known = FLAT_ROUTES.some((fr) => fr.route.path === path);
    if (!known) {
      return;
    }
    useWorldStore.getState().setPendingAvatarTeleport(path);
  };

  // Just flip the store flag — App's effect on (documentMode, muted)
  // is the single source of truth for the live master volume.
  const toggleMute = (): void => setMuted(!muted);

  const keymap = isTouch ? KEYMAP_TOUCH : KEYMAP_DESKTOP;
  // The mobile ≡ icon is the only persistent UI on touch. Hidden once
  // the menu is open (the menu itself is the affordance to close).
  const showMobileIcon = isTouch && !open;

  return (
    <>
      {showMobileIcon && (
        <button
          type="button"
          style={styles.mobileIcon}
          onClick={() => setOpen(true)}
          aria-label="Open menu"
        >
          ≡
        </button>
      )}
      {open && (
        <div
          style={styles.backdrop}
          onClick={close}
          role="dialog"
          aria-modal="true"
          aria-label="Menu"
        >
          <div style={styles.column} onClick={(e) => e.stopPropagation()}>
            {/* Admin section sits above the regular menu when an
                admin token is in localStorage (per ADR-009). The
                component returns null when no token is present, so
                non-admin users see the unchanged menu. */}
            <AdminMenuSection />
            <div style={styles.card}>
              <h2 style={styles.heading}>Menu</h2>

            <nav style={styles.nav} aria-label="Sections">
              {NAV_ITEMS.map((item, i) => {
                const active = location.pathname === item.path;
                return (
                  <button
                    key={item.path}
                    ref={i === 0 ? firstFocusRef : undefined}
                    type="button"
                    style={active ? styles.navLinkActive : styles.navLink}
                    onClick={() => handleNav(item.path)}
                  >
                    {item.label}
                  </button>
                );
              })}
            </nav>

            <button
              type="button"
              style={styles.item}
              onClick={() => setContactOpen((o) => !o)}
              aria-expanded={contactOpen}
            >
              Contact {contactOpen ? '▾' : '▸'}
            </button>
            {contactOpen && (
              <div style={styles.contact}>
                <a href="mailto:hello@example.com" style={styles.contactLink}>
                  hello@example.com
                </a>
                <a
                  href="https://github.com/krisiliev-dev"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={styles.contactLink}
                >
                  GitHub →
                </a>
                <a
                  href="https://www.linkedin.com/in/your-handle"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={styles.contactLink}
                >
                  LinkedIn →
                </a>
              </div>
            )}

            <button
              type="button"
              style={styles.item}
              onClick={() => {
                useWorldStore.getState().setDocumentMode(true);
                close();
              }}
              title="Switch to a flat document layout — no 3D, no animations, just text and links"
            >
              Simple Experience →
            </button>

            <button type="button" style={styles.item} onClick={toggleMute}>
              Audio: {muted ? 'muted' : 'on'}
            </button>

            <details style={styles.controls}>
              <summary style={styles.controlsSummary}>Controls</summary>
              <ul style={styles.keymap}>
                {keymap.map((km) => (
                  <li key={km.key} style={styles.keymapItem}>
                    <span style={styles.keymapKey}>{km.key}</span>
                    <span style={styles.keymapDesc}>{km.desc}</span>
                  </li>
                ))}
              </ul>
            </details>

            <p style={styles.hint}>
              {isTouch ? 'tap outside' : 'press M or click outside'} to close
            </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

const styles: Record<string, CSSProperties> = {
  mobileIcon: {
    position: 'fixed',
    top: 16,
    right: 16,
    width: 40,
    height: 40,
    background: 'rgba(10, 10, 18, 0.78)',
    border: '1px solid rgba(0, 255, 204, 0.4)',
    borderRadius: 8,
    color: '#00ffcc',
    fontSize: 22,
    fontFamily: 'system-ui, -apple-system, sans-serif',
    cursor: 'pointer',
    zIndex: 30,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 0 12px rgba(0, 255, 204, 0.15)',
    backdropFilter: 'blur(4px)',
    WebkitBackdropFilter: 'blur(4px)',
  },
  backdrop: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(10, 10, 18, 0.7)',
    backdropFilter: 'blur(6px)',
    WebkitBackdropFilter: 'blur(6px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 30,
    overflowY: 'auto',
  },
  column: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 16,
    padding: 24,
    maxWidth: '100vw',
  },
  card: {
    minWidth: 280,
    maxWidth: 380,
    width: '90%',
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
    cursor: 'pointer',
    transition: 'border-color 0.15s, background 0.15s',
  },
  itemDisabled: {
    background: 'transparent',
    border: '1px solid rgba(0, 255, 204, 0.1)',
    borderRadius: 6,
    color: 'rgba(224, 255, 250, 0.4)',
    fontFamily: 'inherit',
    fontSize: 14,
    padding: '10px 14px',
    textAlign: 'left',
    cursor: 'not-allowed',
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
    textDecoration: 'none',
  },
  navLinkActive: {
    background: 'rgba(0, 255, 204, 0.1)',
    border: '1px solid rgba(0, 255, 204, 0.55)',
    borderRadius: 6,
    color: '#00ffcc',
    fontSize: 14,
    padding: '10px 14px',
    textAlign: 'center',
    textDecoration: 'none',
  },
  contact: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    padding: '8px 14px',
    fontSize: 13,
  },
  contactLink: {
    color: 'rgba(0, 255, 204, 0.85)',
    textDecoration: 'none',
  },
  controls: {
    background: 'transparent',
    border: '1px solid rgba(0, 255, 204, 0.15)',
    borderRadius: 6,
    padding: '8px 14px',
    fontSize: 13,
  },
  controlsSummary: {
    cursor: 'pointer',
    color: 'rgba(224, 255, 250, 0.85)',
    listStyle: 'none',
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
