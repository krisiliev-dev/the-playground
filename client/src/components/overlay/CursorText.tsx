import { useEffect, useRef, useState } from 'react';

const TEXT = 'Your cursor got caught on my...';
const LERP = 0.15;
const OFFSET_X = 16;
const OFFSET_Y = 16;

type MotionMode = 'default' | 'silent';

function readMotionMode(): MotionMode {
  if (typeof window === 'undefined') {
    return 'default';
  }
  return new URLSearchParams(window.location.search).get('motion') === 'silent'
    ? 'silent'
    : 'default';
}

function supportsIosMotionPermission(): boolean {
  return (
    typeof DeviceOrientationEvent !== 'undefined' &&
    typeof (DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> })
      .requestPermission === 'function'
  );
}

/**
 * DOM overlay that renders a short teaser line and follows the cursor with
 * an eased lerp. On mobile we read deviceorientation instead of pointermove.
 * Fades out on the first click (anticipates the Phase 4 sword reveal).
 *
 * `?motion=silent` skips the iOS permission prompt and relies on whatever
 * orientation events the browser emits without explicit grant.
 */
export function CursorText(): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const target = useRef({ x: 0, y: 0 });
  const rendered = useRef({ x: 0, y: 0 });
  const [hidden, setHidden] = useState(false);

  const motionMode = useRef<MotionMode>(readMotionMode()).current;
  const iosGated = supportsIosMotionPermission() && motionMode === 'default';
  const [motionGranted, setMotionGranted] = useState(!iosGated);

  // Initial target + rendered position: viewport center.
  useEffect(() => {
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight / 2;
    target.current = { x: cx, y: cy };
    rendered.current = { x: cx, y: cy };
  }, []);

  // Pointer tracking — desktop + mobile browsers that expose pointermove.
  useEffect(() => {
    const onMove = (e: PointerEvent): void => {
      target.current.x = e.clientX;
      target.current.y = e.clientY;
    };
    window.addEventListener('pointermove', onMove);
    return () => window.removeEventListener('pointermove', onMove);
  }, []);

  // Gyroscope tracking for mobile.
  useEffect(() => {
    if (!motionGranted) {
      return;
    }
    const onOrient = (e: DeviceOrientationEvent): void => {
      if (e.gamma === null || e.beta === null) {
        return;
      }
      // gamma: -90 (left) → 90 (right); normalise to 0..1 over ±45°
      const nx = Math.max(-1, Math.min(1, e.gamma / 45));
      // beta: 0 (flat face-up) → 90 (vertical); center on ~45°
      const nb = Math.max(-1, Math.min(1, (e.beta - 45) / 45));
      target.current.x = window.innerWidth / 2 + nx * (window.innerWidth / 2);
      target.current.y = window.innerHeight / 2 + nb * (window.innerHeight / 2);
    };
    window.addEventListener('deviceorientation', onOrient);
    return () => window.removeEventListener('deviceorientation', onOrient);
  }, [motionGranted]);

  // Fade out on first click; leaves room for Phase 4 sword animation to take over.
  useEffect(() => {
    const onClick = (): void => setHidden(true);
    window.addEventListener('click', onClick, { once: true });
    return () => window.removeEventListener('click', onClick);
  }, []);

  // rAF-driven lerp. Mutates DOM directly — no React re-renders per frame.
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

  const requestMotion = async (): Promise<void> => {
    try {
      const req = (
        DeviceOrientationEvent as unknown as {
          requestPermission: () => Promise<string>;
        }
      ).requestPermission;
      const result = await req();
      if (result === 'granted') {
        setMotionGranted(true);
      }
    } catch {
      // Ignore — user denied or API missing. Fallback: text sits centered.
    }
  };

  return (
    <>
      <div ref={ref} style={{ ...textStyle, opacity: hidden ? 0 : 0.72 }}>
        {TEXT}
      </div>
      {iosGated && !motionGranted ? (
        <button
          type="button"
          onClick={() => void requestMotion()}
          style={{ ...buttonStyle, opacity: hidden ? 0 : 1 }}
        >
          Tap to enable motion
        </button>
      ) : null}
    </>
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

const buttonStyle: React.CSSProperties = {
  position: 'fixed',
  bottom: 24,
  left: '50%',
  transform: 'translateX(-50%)',
  background: '#00ffcc',
  color: '#0a0a12',
  border: 'none',
  padding: '10px 20px',
  fontSize: 12,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  borderRadius: 4,
  cursor: 'pointer',
  zIndex: 11,
  transition: 'opacity 0.6s ease-out',
  letterSpacing: '0.05em',
};
