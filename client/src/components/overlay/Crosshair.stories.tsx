/**
 * Crosshair — visual stories.
 *
 * The crosshair only renders once `controlsDismissed = true` AND the
 * device is non-touch. The mobile story exists to document the
 * "intentionally absent" branch.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect } from 'react';
import { Crosshair } from './Crosshair';
import { useWorldStore } from '@/store';

function ResetStore({ controlsDismissed = true }: { controlsDismissed?: boolean }): null {
  useEffect(() => {
    useWorldStore.setState({ controlsDismissed });
  }, [controlsDismissed]);
  return null;
}

const meta: Meta<typeof Crosshair> = {
  title: 'Overlay/Crosshair',
  component: Crosshair,
  parameters: {
    layout: 'fullscreen',
  },
};
export default meta;
type Story = StoryObj<typeof Crosshair>;

export const Default: Story = {
  render: () => (
    <>
      <ResetStore />
      <Crosshair />
    </>
  ),
};

export const NotYetDismissed: Story = {
  // Component renders null until controlsDismissed flips true.
  render: () => (
    <>
      <ResetStore controlsDismissed={false} />
      <div style={{ color: '#666', padding: 32, fontFamily: 'ui-monospace' }}>
        Crosshair renders null because controlsDismissed = false.
      </div>
    </>
  ),
};

export const OnTouchDevice: Story = {
  decorators: [
    (Story) => {
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
      <ResetStore controlsDismissed={true} />
      <Crosshair />
      <div style={{ color: '#666', padding: 32, fontFamily: 'ui-monospace' }}>
        Crosshair renders null on touch devices — the click target on mobile is wherever the
        user&apos;s finger lands, not screen centre.
      </div>
    </>
  ),
};
