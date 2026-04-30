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
  /** World box dimensions: 800×800×800 cube — the user sits inside. */
  dimensions: [800, 800, 800],

  ambientColor: '#12121a',
  ambientIntensity: 0.3,

  fog: {
    color: '#12121a',
    near: 10,
    far: 80,
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
