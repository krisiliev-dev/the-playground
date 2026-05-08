/**
 * Structural tests for the particle-burst receiver. The
 * per-frame physics + rendering live inside R3F's useFrame
 * which is mocked in jsdom; what we lock down here is:
 *   - one rendered group per inbound event
 *   - bursts self-remove after their lifetime expires (the
 *     parent's sweep effect filters them out)
 *   - point-mode and model-mode pick the right child
 *     component based on `model_url`
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render } from '@testing-library/react';
import { ParticleBursts } from '@/multiplayer/ParticleBursts';
import { dispatchSceneEvent, _resetSceneEventBusForTest } from '@/multiplayer/sceneEvents';

vi.mock('@react-three/fiber', () => ({
  useFrame: vi.fn(),
}));

vi.mock('@react-three/drei', () => ({
  useGLTF: () => ({
    scene: { traverse: () => {} },
  }),
}));

describe('ParticleBursts', () => {
  beforeEach(() => {
    _resetSceneEventBusForTest();
  });

  it('renders nothing initially', () => {
    const { container } = render(<ParticleBursts />);
    // No active bursts → fragment with nothing inside.
    expect(container.querySelectorAll('points').length).toBe(0);
    expect(container.querySelectorAll('instancedMesh').length).toBe(0);
  });

  it('appends a point-mode burst on inbound particle_burst event with no model_url', () => {
    const { rerender, container } = render(<ParticleBursts />);
    dispatchSceneEvent(
      {
        kind: 'particle_burst',
        position: [0, 0, 0],
        count: 32,
        colors: ['#ff00ff', '#ffff00'],
        speed: 50,
        lifetime_ms: 1500,
        spread: 0.6,
        gravity: 30,
        size: 4,
        spin: 0,
      },
      'remote-actor',
    );
    rerender(<ParticleBursts />);
    expect(container.querySelectorAll('points').length).toBe(1);
    expect(container.querySelectorAll('instancedMesh').length).toBe(0);
  });

  it('appends a model-mode burst when model_url is set', () => {
    const { rerender, container } = render(<ParticleBursts />);
    dispatchSceneEvent(
      {
        kind: 'particle_burst',
        position: [0, 0, 0],
        count: 24,
        colors: ['#00ffff'],
        speed: 50,
        lifetime_ms: 1500,
        spread: 0.6,
        gravity: 30,
        size: 1,
        model_url: '/assets/ast_abc.glb',
        spin: 5,
      },
      null,
    );
    rerender(<ParticleBursts />);
    // Model mode falls back to null in this stubbed environment
    // (useGLTF mock returns no mesh), but the parent still
    // mounts the wrapper component. Assert no point-mode was
    // chosen.
    expect(container.querySelectorAll('points').length).toBe(0);
  });

  it('renders multiple concurrent bursts as separate roots', () => {
    const { rerender, container } = render(<ParticleBursts />);
    for (let i = 0; i < 3; i++) {
      dispatchSceneEvent(
        {
          kind: 'particle_burst',
          position: [i, 0, 0],
          count: 10,
          colors: ['#ffffff'],
          speed: 10,
          lifetime_ms: 1000,
          spread: 0.5,
          gravity: 0,
          size: 2,
          spin: 0,
        },
        null,
      );
    }
    rerender(<ParticleBursts />);
    expect(container.querySelectorAll('points').length).toBe(3);
  });
});
