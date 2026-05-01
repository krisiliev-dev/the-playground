/**
 * CursorText — DOM overlay that renders a short teaser line.
 *
 * Desktop: lerps toward the pointer position so the text trails the
 * cursor with a soft elastic feel.
 *
 * Mobile (touch primary): stays anchored at viewport centre. The
 * previous gyroscope-tilt path is gone — it required an iOS
 * `DeviceOrientationEvent.requestPermission()` button ("Tap to enable
 * motion") that turned out to be more friction than it was worth.
 *
 * Fades out on the first click anywhere (the reveal click) so it
 * gets out of the way for the sword reveal.
 */
import { useEffect, useRef, useState } from 'react';
import { useIsTouchPrimary } from '@/utils';

const TEXT = 'Your cursor got caught on my...';
const LERP = 0.15;
const OFFSET_X = 16;
const OFFSET_Y = 16;

export function CursorText(): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const target = useRef({ x: 0, y: 0 });
  const rendered = useRef({ x: 0, y: 0 });
  const [hidden, setHidden] = useState(false);
  const isTouch = useIsTouchPrimary();

  // Initial target + rendered position: viewport centre. Re-runs on
  // window resize so the centre is still correct on rotate.
  useEffect(() => {
    const recenter = (): void => {
      const cx = window.innerWidth / 2;
      const cy = window.innerHeight / 2;
      target.current = { x: cx, y: cy };
      // Snap rendered too on initial mount; subsequent resizes just
      // update the target and the lerp drifts toward it.
      if (rendered.current.x === 0 && rendered.current.y === 0) {
        rendered.current = { x: cx, y: cy };
      }
    };
    recenter();
    window.addEventListener('resize', recenter);
    return () => window.removeEventListener('resize', recenter);
  }, []);

  // Pointer tracking — desktop only. On touch devices the text stays
  // centred (target was set in the resize effect above and isn't
  // updated by anything).
  useEffect(() => {
    if (isTouch) {
      // Make sure the target is centred even if a previous render
      // chased the pointer briefly before this effect saw isTouch.
      target.current = {
        x: window.innerWidth / 2,
        y: window.innerHeight / 2,
      };
      return;
    }
    const onMove = (e: PointerEvent): void => {
      target.current.x = e.clientX;
      target.current.y = e.clientY;
    };
    window.addEventListener('pointermove', onMove);
    return () => window.removeEventListener('pointermove', onMove);
  }, [isTouch]);

  // Fade out on first click; leaves room for Phase 4 sword animation
  // to take over.
  useEffect(() => {
    const onClick = (): void => setHidden(true);
    window.addEventListener('click', onClick, { once: true });
    return () => window.removeEventListener('click', onClick);
  }, []);

  // rAF-driven lerp. Mutates DOM directly — no React re-renders per
  // frame.
  useEffect(() => {
    let rafId = 0;
    const tick = (): void => {
      rendered.current.x += (target.current.x - rendered.current.x) * LERP;
      rendered.current.y += (target.current.y - rendered.current.y) * LERP;
      if (ref.current) {
        ref.current.style.transform = `translate3d(${
          rendered.current.x + OFFSET_X
        }px, ${rendered.current.y + OFFSET_Y}px, 0)`;
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, []);

  return (
    <div ref={ref} style={{ ...textStyle, opacity: hidden ? 0 : 0.72 }}>
      {TEXT}
    </div>
  );
}

const textStyle: React.CSSProperties = {
  position: 'fixed',
  top: 0,
  left: 0,
  color: '#e6fffb',
  fontSize: 14,
  fontWeight: 500,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  pointerEvents: 'none',
  zIndex: 10,
  transform: 'translate3d(0, 0, 0)',
  transition: 'opacity 0.6s ease-out',
  letterSpacing: '0.04em',
  // Heavy dark outline so the text reads against the cyan grid wall.
  textShadow:
    '0 0 6px rgba(0, 0, 0, 0.95), 0 0 14px rgba(0, 0, 0, 0.85), 0 0 22px rgba(0, 255, 204, 0.5)',
  willChange: 'transform',
};
