/**
 * ControlsHint — DOM overlay that appears the moment the sword sinks into
 * the wall (revealState transitions to 'impact'). Tells the user how to
 * navigate in avatar mode. Dismissable by clicking anywhere.
 *
 * Animation: card fades + slides up + scales in over 700ms; the rows
 * stagger their entrance via transition-delay for a touch of liveliness.
 * Click to dismiss → flips `controlsDismissed` in the store, which is
 * what gates CursorAvatar's transition into 3rd-person.
 */
import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { useWorldStore } from '@/store';
import { useIsTouchPrimary } from '@/utils';

const FADE_EASE = 'cubic-bezier(0.2, 0.8, 0.3, 1)';

export function ControlsHint(): JSX.Element | null {
  const revealState = useWorldStore((s) => s.revealState);
  const controlsDismissed = useWorldStore((s) => s.controlsDismissed);
  const setControlsDismissed = useWorldStore((s) => s.setControlsDismissed);
  const [shown, setShown] = useState(false);
  const isTouch = useIsTouchPrimary();
  /** Drives the CSS transition target state. False on mount → opacity 0,
   *  scaled-down. Flipped to true via rAF so the browser paints the
   *  "from" state first, then the transition runs. */
  const [active, setActive] = useState(false);

  useEffect(() => {
    if ((revealState === 'impact' || revealState === 'revealed') && !controlsDismissed) {
      setShown(true);
    }
  }, [revealState, controlsDismissed]);

  useEffect(() => {
    if (!shown) {
      setActive(false);
      return;
    }
    const id = requestAnimationFrame(() => setActive(true));
    return () => cancelAnimationFrame(id);
  }, [shown]);

  // Click anywhere → dismiss + flip the store flag. Delayed so the
  // animation has time to read before a reflexive click closes it.
  useEffect(() => {
    if (!shown) {
      return;
    }
    const onClick = (): void => {
      setShown(false);
      setControlsDismissed(true);
      // Request pointer lock SYNCHRONOUSLY here — we're inside the click
      // handler, so the user-activation token is still valid. Doing this
      // in a React effect later fails with "requires a user gesture".
      const canvas = document.querySelector('canvas');
      if (canvas instanceof HTMLCanvasElement) {
        void canvas.requestPointerLock?.();
      }
    };
    const timer = window.setTimeout(() => {
      window.addEventListener('click', onClick, { once: true });
    }, 600);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('click', onClick);
    };
  }, [shown, setControlsDismissed]);

  if (!shown) {
    return null;
  }

  const cardStyle: CSSProperties = {
    ...styles.card,
    opacity: active ? 1 : 0,
    transform: active ? 'scale(1) translateY(0)' : 'scale(0.92) translateY(16px)',
    transition: `opacity 0.7s ${FADE_EASE}, transform 0.7s ${FADE_EASE}`,
  };

  const staggerRow = (delay: string): CSSProperties => ({
    ...styles.row,
    opacity: active ? 1 : 0,
    transform: active ? 'translateX(0)' : 'translateX(-10px)',
    transition: `opacity 0.5s ${FADE_EASE} ${delay}, transform 0.5s ${FADE_EASE} ${delay}`,
  });

  return (
    <div style={styles.wrap} aria-live="polite">
      <div style={cardStyle}>
        <div
          style={{
            ...styles.title,
            opacity: active ? 1 : 0,
            transition: `opacity 0.5s ${FADE_EASE} 0.1s`,
          }}
        >
          Controls
        </div>
        <div style={staggerRow('0.25s')}>
          <span style={styles.key}>{isTouch ? '2 fingers' : 'W A S D'}</span>
          <span style={styles.label}>{isTouch ? 'pinch to move' : 'move'}</span>
        </div>
        <div style={staggerRow('0.35s')}>
          <span style={styles.key}>{isTouch ? '1 finger' : 'mouse'}</span>
          <span style={styles.label}>{isTouch ? 'swipe to look' : 'look around'}</span>
        </div>
        <div style={staggerRow('0.45s')}>
          <span style={styles.key}>{isTouch ? 'tap / hold' : 'click / hold'}</span>
          <span style={styles.label}>interact</span>
        </div>
        <div
          style={{
            ...styles.hint,
            opacity: active ? 0.55 : 0,
            transition: `opacity 0.5s ${FADE_EASE} 0.6s`,
          }}
        >
          {isTouch ? 'tap anywhere to dismiss' : 'click anywhere to dismiss'}
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  wrap: {
    position: 'fixed',
    inset: 0,
    pointerEvents: 'none',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 7,
  },
  card: {
    pointerEvents: 'none',
    padding: '24px 32px',
    background: 'rgba(10, 10, 18, 0.78)',
    border: '1px solid rgba(0, 255, 204, 0.4)',
    borderRadius: 8,
    color: '#e0fffa',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    fontSize: 16,
    boxShadow: '0 0 24px rgba(0, 255, 204, 0.15)',
    backdropFilter: 'blur(4px)',
    WebkitBackdropFilter: 'blur(4px)',
    minWidth: 220,
    willChange: 'opacity, transform',
  },
  title: {
    fontSize: 14,
    fontWeight: 600,
    letterSpacing: '0.15em',
    textTransform: 'uppercase',
    color: '#00ffcc',
    marginBottom: 14,
  },
  row: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  key: {
    fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
    fontSize: 14,
    padding: '2px 8px',
    border: '1px solid rgba(0, 255, 204, 0.35)',
    borderRadius: 4,
    color: '#00ffcc',
  },
  label: {
    fontSize: 14,
    opacity: 0.85,
    marginLeft: 12,
  },
  hint: {
    marginTop: 14,
    fontSize: 12,
    textAlign: 'center',
  },
};
