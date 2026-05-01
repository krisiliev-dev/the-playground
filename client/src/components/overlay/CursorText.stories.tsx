/**
 * CursorText — visual stories.
 *
 * Desktop: the text trails the pointer with a soft elastic lerp.
 * Mobile: the text stays anchored at viewport centre.
 *
 * Both stories show the visible state. Move the pointer in the
 * Storybook canvas to see the desktop trailing animation.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { CursorText } from './CursorText';

const meta: Meta<typeof CursorText> = {
  title: 'Overlay/CursorText',
  component: CursorText,
  parameters: {
    layout: 'fullscreen',
  },
};
export default meta;
type Story = StoryObj<typeof CursorText>;

export const Desktop: Story = {
  render: () => <CursorText />,
};

export const Mobile: Story = {
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
  render: () => <CursorText />,
};
