/**
 * useIsTouchPrimary — true when the user's primary input device is
 * touch (typical phone / tablet), not mouse.
 *
 * Uses `matchMedia('(pointer: coarse)')` rather than
 * `'ontouchstart' in window` because the latter is also true on
 * many laptops with touch-enabled trackpads / displays, which we
 * still want to treat as desktop. The media query is a reactive
 * source — the listener flips state if the device gains/loses a
 * fine-pointer mid-session (rare but real for hybrid devices like
 * Surface Pro with attached/detached keyboard).
 */
import { useEffect, useState } from 'react';

function readIsTouchPrimary(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  return window.matchMedia('(pointer: coarse)').matches;
}

export function useIsTouchPrimary(): boolean {
  const [isTouch, setIsTouch] = useState(readIsTouchPrimary);

  useEffect(() => {
    const mql = window.matchMedia('(pointer: coarse)');
    const handler = (e: MediaQueryListEvent): void => setIsTouch(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  return isTouch;
}
