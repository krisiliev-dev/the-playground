/**
 * ControlsHint — verifies the overlay's render gates, mobile-vs-desktop
 * copy, and dismiss behavior. We don't try to assert the exact CSS
 * transitions (that's visual, not behavioural); we test what the user
 * actually observes: visibility, the strings shown on each row, and
 * that a dismiss click flips the store flag.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { ControlsHint } from '@/components/overlay/ControlsHint';
import { useWorldStore } from '@/store';

function setMatchMedia(matches: boolean): void {
  window.matchMedia = ((query: string) =>
    ({
      matches,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList) as typeof window.matchMedia;
}

describe('ControlsHint', () => {
  let originalMatchMedia: typeof window.matchMedia;

  beforeEach(() => {
    originalMatchMedia = window.matchMedia;
    setMatchMedia(false); // desktop default
    useWorldStore.setState({
      revealState: 'idle',
      controlsDismissed: false,
    });
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  it('renders nothing while reveal is idle', () => {
    const { container } = render(<ControlsHint />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing once controls have been dismissed, even on impact', () => {
    useWorldStore.setState({ revealState: 'impact', controlsDismissed: true });
    const { container } = render(<ControlsHint />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the card when revealState transitions to impact', () => {
    const { rerender } = render(<ControlsHint />);
    expect(screen.queryByText('Controls')).toBeNull();

    act(() => {
      useWorldStore.setState({ revealState: 'impact' });
    });
    rerender(<ControlsHint />);
    expect(screen.getByText('Controls')).toBeInTheDocument();
  });

  it('renders with desktop copy when (pointer: coarse) does not match', () => {
    setMatchMedia(false);
    useWorldStore.setState({ revealState: 'impact' });
    render(<ControlsHint />);

    expect(screen.getByText('W A S D')).toBeInTheDocument();
    expect(screen.getByText('move')).toBeInTheDocument();
    expect(screen.getByText('mouse')).toBeInTheDocument();
    expect(screen.getByText('look around')).toBeInTheDocument();
    expect(screen.getByText('click / hold')).toBeInTheDocument();
    expect(screen.getByText('interact')).toBeInTheDocument();
    expect(screen.getByText('M')).toBeInTheDocument();
    expect(screen.getByText('menu')).toBeInTheDocument();
    expect(screen.getByText('click anywhere to dismiss')).toBeInTheDocument();
  });

  it('renders with mobile copy when (pointer: coarse) matches', () => {
    setMatchMedia(true);
    useWorldStore.setState({ revealState: 'impact' });
    render(<ControlsHint />);

    expect(screen.getByText('2 fingers')).toBeInTheDocument();
    expect(screen.getByText('pinch to move')).toBeInTheDocument();
    expect(screen.getByText('1 finger')).toBeInTheDocument();
    expect(screen.getByText('swipe to look')).toBeInTheDocument();
    expect(screen.getByText('tap / hold')).toBeInTheDocument();
    expect(screen.getByText('interact')).toBeInTheDocument();
    expect(screen.getByText('≡')).toBeInTheDocument();
    expect(screen.getByText('menu')).toBeInTheDocument();
    expect(screen.getByText('tap anywhere to dismiss')).toBeInTheDocument();
  });

  it('renders during the revealed state too — controls hint persists past impact', () => {
    useWorldStore.setState({ revealState: 'revealed' });
    render(<ControlsHint />);
    expect(screen.getByText('Controls')).toBeInTheDocument();
  });

  it('flips controlsDismissed in the store on the (delayed) dismiss click', () => {
    vi.useFakeTimers();
    useWorldStore.setState({ revealState: 'impact' });
    render(<ControlsHint />);

    expect(useWorldStore.getState().controlsDismissed).toBe(false);

    // Dismiss timer is 600 ms; the click handler isn't installed until
    // after that fires.
    act(() => {
      vi.advanceTimersByTime(600);
    });

    act(() => {
      window.dispatchEvent(new MouseEvent('click'));
    });

    expect(useWorldStore.getState().controlsDismissed).toBe(true);
    vi.useRealTimers();
  });

  it('does not flip controlsDismissed if a click lands before the 600 ms arming delay', () => {
    vi.useFakeTimers();
    useWorldStore.setState({ revealState: 'impact' });
    render(<ControlsHint />);

    // Click immediately — the listener hasn't been installed yet, so
    // this should be a no-op for the store flag.
    act(() => {
      window.dispatchEvent(new MouseEvent('click'));
    });
    expect(useWorldStore.getState().controlsDismissed).toBe(false);
    vi.useRealTimers();
  });

  it('does not throw when querySelector returns no canvas (jsdom default)', () => {
    vi.useFakeTimers();
    useWorldStore.setState({ revealState: 'impact' });
    render(<ControlsHint />);

    act(() => {
      vi.advanceTimersByTime(600);
    });

    // jsdom container has no <canvas>; the dismiss path must not throw
    // when canvas.requestPointerLock is unavailable.
    expect(() => {
      act(() => {
        window.dispatchEvent(new MouseEvent('click'));
      });
    }).not.toThrow();
    vi.useRealTimers();
  });
});
