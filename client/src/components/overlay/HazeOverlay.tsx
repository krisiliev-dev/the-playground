/**
 * HazeOverlay — soft full-screen haze that sits above the canvas while
 * the scene is in its `idle` (pre-click) state and fades away on the
 * user's first click. Implemented as a CSS overlay so the haze samples
 * the live canvas via `backdrop-filter`, with `pointer-events: none`
 * so it doesn't intercept the click that the RevealOrchestrator listens
 * for on `window`.
 */
import type { CSSProperties } from 'react';
import { useWorldStore } from '@/store';

export function HazeOverlay(): JSX.Element {
  const revealState = useWorldStore((s) => s.revealState);
  const visible = revealState === 'idle';

  return (
    <div
      style={{
        ...styles.haze,
        opacity: visible ? 1 : 0,
      }}
    />
  );
}

const styles: Record<string, CSSProperties> = {
  haze: {
    position: 'fixed',
    inset: 0,
    pointerEvents: 'none',
    backdropFilter: 'blur(6px) saturate(1.1)',
    WebkitBackdropFilter: 'blur(6px) saturate(1.1)',
    background:
      'radial-gradient(ellipse at center, rgba(18,18,26,0.18) 0%, rgba(10,10,18,0.55) 100%)',
    transition: 'opacity 0.9s ease-out',
    zIndex: 5,
  },
};
