/**
 * HazeOverlay — visual stories.
 *
 * The haze is visible during reveal `idle`, fades out from `armed`
 * onward. Three stories cover the visible state, the faded state, and
 * the transition snapshot mid-fade.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect } from 'react';
import type { RevealState } from '@/store';
import { HazeOverlay } from './HazeOverlay';
import { useWorldStore } from '@/store';

function ResetStore({ revealState }: { revealState: RevealState }): null {
  useEffect(() => {
    useWorldStore.setState({ revealState });
  }, [revealState]);
  return null;
}

const meta: Meta<typeof HazeOverlay> = {
  title: 'Overlay/HazeOverlay',
  component: HazeOverlay,
  parameters: {
    layout: 'fullscreen',
  },
};
export default meta;
type Story = StoryObj<typeof HazeOverlay>;

const sceneBackground = (
  <div
    style={{
      position: 'fixed',
      inset: 0,
      background:
        'repeating-linear-gradient(0deg, #0a0a12 0 39px, #00ffcc22 39px 40px), repeating-linear-gradient(90deg, #0a0a12 0 39px, #00ffcc22 39px 40px)',
      zIndex: 0,
    }}
  />
);

export const Idle: Story = {
  render: () => (
    <>
      <ResetStore revealState="idle" />
      {sceneBackground}
      <HazeOverlay />
    </>
  ),
};

export const Armed: Story = {
  // From `armed` onward the haze is fully transparent — sword reveal
  // owns the screen.
  render: () => (
    <>
      <ResetStore revealState="armed" />
      {sceneBackground}
      <HazeOverlay />
    </>
  ),
};

export const Revealed: Story = {
  render: () => (
    <>
      <ResetStore revealState="revealed" />
      {sceneBackground}
      <HazeOverlay />
    </>
  ),
};
