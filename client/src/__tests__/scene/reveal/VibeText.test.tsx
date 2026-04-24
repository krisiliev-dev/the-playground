import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { forwardRef } from 'react';

vi.mock('@react-three/fiber', () => ({
  useFrame: vi.fn(),
}));

// drei's <Text> requires a Canvas. Stub it as a forwardRef so the parent
// can attach `meshRef` without warnings, and surface the children as a
// data attribute for assertions.
vi.mock('@react-three/drei', () => ({
  Text: forwardRef<HTMLDivElement, { children?: React.ReactNode }>(function StubText(
    { children },
    ref,
  ) {
    const content = typeof children === 'string' ? children : '';
    return <div ref={ref} data-testid="vibe-text" data-content={content} />;
  }),
}));

import { VibeText, VIBE_CONSTANTS } from '@/components/scene/reveal/VibeText';

describe('VibeText', () => {
  it('renders without crashing', () => {
    const { container } = render(<VibeText />);
    expect(container).toBeTruthy();
  });

  it('renders the literal text "VIBE"', () => {
    const { getByTestId } = render(<VibeText />);
    expect(getByTestId('vibe-text').dataset.content).toBe('VIBE');
  });

  it('exposes the VIBE constants', () => {
    expect(VIBE_CONSTANTS.TEXT).toBe('VIBE');
    expect(VIBE_CONSTANTS.COLOR).toBe('#00ffcc');
  });
});
