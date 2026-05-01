/**
 * Crosshair — small center-screen reticle that only appears once the
 * user has dismissed the controls hint and the cursor has transitioned
 * into avatar mode. Pointer-events are off so it never intercepts input
 * meant for the canvas.
 */
import type { CSSProperties } from 'react';
import { useWorldStore } from '@/store';
import { useIsTouchPrimary } from '@/utils';

export function Crosshair(): JSX.Element | null {
  const controlsDismissed = useWorldStore((s) => s.controlsDismissed);
  const isTouch = useIsTouchPrimary();
  // Mobile doesn't need a crosshair — the click target is wherever
  // the user's finger lands, not screen centre. Showing a fixed
  // reticle that doesn't represent the actual interaction point is
  // more confusing than helpful on touch.
  if (!controlsDismissed || isTouch) {
    return null;
  }

  return (
    <div style={styles.wrap} aria-hidden>
      <svg width="24" height="24" viewBox="0 0 24 24">
        <line x1="12" y1="2" x2="12" y2="9" stroke="#00ffcc" strokeWidth="1.5" />
        <line x1="12" y1="15" x2="12" y2="22" stroke="#00ffcc" strokeWidth="1.5" />
        <line x1="2" y1="12" x2="9" y2="12" stroke="#00ffcc" strokeWidth="1.5" />
        <line x1="15" y1="12" x2="22" y2="12" stroke="#00ffcc" strokeWidth="1.5" />
        <circle cx="12" cy="12" r="1.2" fill="#00ffcc" />
      </svg>
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
    zIndex: 6,
  },
};
