import { describe, it, expect } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { CursorText } from '@/components/overlay/CursorText';

describe('CursorText', () => {
  it('renders the teaser copy', () => {
    const { getByText } = render(<CursorText />);
    expect(getByText('Your cursor got caught on my...')).toBeTruthy();
  });

  it('hides after a click', () => {
    const { getByText } = render(<CursorText />);
    const text = getByText('Your cursor got caught on my...') as HTMLElement;
    expect(text.style.opacity).not.toBe('0');
    fireEvent.click(window);
    expect(text.style.opacity).toBe('0');
  });

  it('updates the pointer target on pointermove without throwing', () => {
    const { getByText } = render(<CursorText />);
    fireEvent(
      window,
      new PointerEvent('pointermove', { clientX: 200, clientY: 300 }),
    );
    // The rAF loop mutates transform directly, which jsdom doesn't run.
    // This test only verifies the listener is wired and doesn't throw.
    expect(getByText('Your cursor got caught on my...')).toBeTruthy();
  });
});
