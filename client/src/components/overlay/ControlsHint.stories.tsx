/**
 * ControlsHint — visual stories.
 *
 * The component reads:
 *   - `revealState` from the world store (must be 'impact' or 'revealed' to render)
 *   - `controlsDismissed` (must be false)
 *   - `useIsTouchPrimary()` (governs desktop vs mobile copy)
 *
 * Each story mocks the store state on mount so the component renders
 * its three-row layout. The matchMedia mock for the mobile story flips
 * the touch-primary branch on.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect } from 'react';
import { ControlsHint } from './ControlsHint';
import { useWorldStore } from '@/store';

function ResetStore({ controlsDismissed = false }: { controlsDismissed?: boolean }): null {
  // Each story remounts this; resetting on mount keeps the storybook
  // canvas honest after a hot-reload that may have left dismissed=true.
  useEffect(() => {
    useWorldStore.setState({
      revealState: 'impact',
      controlsDismissed,
    });
  }, [controlsDismissed]);
  return null;
}

const meta: Meta<typeof ControlsHint> = {
  title: 'Overlay/ControlsHint',
  component: ControlsHint,
  parameters: {
    layout: 'fullscreen',
  },
};
export default meta;
type Story = StoryObj<typeof ControlsHint>;

export const Desktop: Story = {
  render: () => (
    <>
      <ResetStore />
      <ControlsHint />
    </>
  ),
};

export const Mobile: Story = {
  decorators: [
    (Story) => {
      // Override matchMedia so useIsTouchPrimary returns true.
      window.matchMedia = ((query: string) =>
        ({
          matches: true,
          media: query,
          onchange: null,
          addListener: () => undefined,
          removeListener: () => undefined,
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
          dispatchEvent: () => false,
        }) as unknown as MediaQueryList) as typeof window.matchMedia;
      return <Story />;
    },
  ],
  render: () => (
    <>
      <ResetStore />
      <ControlsHint />
    </>
  ),
};

export const AlreadyDismissed: Story = {
  // Component renders null — the story exists to document the
  // "nothing to see" state so reviewers don't think they're looking
  // at a broken render.
  render: () => (
    <>
      <ResetStore controlsDismissed={true} />
      <div style={{ color: '#666', padding: 32, fontFamily: 'ui-monospace' }}>
        ControlsHint renders null because controlsDismissed = true.
        <br />
        See the Desktop / Mobile stories for the visible variants.
      </div>
    </>
  ),
};
