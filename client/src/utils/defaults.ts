/**
 * Default environment configuration.
 *
 * This defines the initial layout of the 3D world: its dimensions,
 * lighting, and the zones visitors can navigate to. In production,
 * this config will be loadable from the server so you can edit
 * the world live without redeploying the client.
 */

import type { EnvironmentConfig } from '@/types';

export const DEFAULT_ENVIRONMENT: EnvironmentConfig = {
  /** World box dimensions: 40 units wide, 30 tall, 40 deep. */
  dimensions: [40, 30, 40],

  ambientColor: '#552124',
  ambientIntensity: 0.4,

  fog: {
    color: '#ffffff',
    near: 0,
    far: 500,
  },

  zones: [
    {
      id: 'portfolio',
      label: 'Projects',
      position: [-12, 0, -10],
      lookAt: [-12, 0, -15],
      type: 'portfolio',
    },
    {
      id: 'about',
      label: 'About Me',
      position: [0, 0, -15],
      lookAt: [0, 0, -20],
      type: 'about',
    },
    {
      id: 'social',
      label: 'Social',
      position: [12, 0, -10],
      lookAt: [12, 0, -15],
      type: 'social',
    },
    {
      id: 'contact',
      label: 'Contact',
      position: [0, -8, -10],
      lookAt: [0, -8, -15],
      type: 'contact',
    },
  ],
};
