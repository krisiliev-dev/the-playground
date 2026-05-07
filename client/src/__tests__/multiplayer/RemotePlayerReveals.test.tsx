/**
 * Tests for the remote-cascade orchestrator. The visual side
 * (Sword animation, sprite flashes) is exercised by the local
 * `Sword` and `swordPhases` tests; the orchestrator itself
 * just needs to:
 *   - Pull a typed reveal bag out of player entity props
 *   - Skip players who aren't actively revealing (idle / no
 *     fields / wrong state value)
 *   - Skip the local player (we render our own cascade)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { useWorldStore } from '@/store';
import {
  RemotePlayerReveals,
  readRevealPresence,
} from '@/multiplayer/RemotePlayerReveals';
import type { Entity } from '@/multiplayer/types';
import { IDENTITY_TRANSFORM } from '@/multiplayer/types';

vi.mock('@react-three/fiber', () => ({
  useFrame: vi.fn(),
  useThree: () => ({}),
}));

// Stub the heavy children — we're testing what gets mounted, not
// the per-sword animation.
vi.mock('@/components/scene/reveal/Sword', () => ({
  Sword: () => <div data-testid="remote-sword" />,
}));

vi.mock('@/components/scene/reveal/vibeFormation', () => ({
  VIBE_SLOTS: Array.from({ length: 12 }, (_, i) => ({ id: `slot-${i}` })),
  FORMATION_SCALE: 1,
}));

vi.mock('@/content/portals', () => ({
  buildPortalEndpoints: () => [],
}));

function makePlayer(id: string, props: Record<string, unknown> = {}): Entity {
  return {
    id,
    kind: 'player',
    transform: IDENTITY_TRANSFORM,
    props,
  };
}

const fullRevealProps = {
  reveal_state: 'swinging',
  click_hit_point: [0, 0, -10] as [number, number, number],
  click_hit_normal: [0, 0, 1] as [number, number, number],
  click_cam_pos: [0, 0, 0] as [number, number, number],
  click_cam_quat: [0, 0, 0, 1] as [number, number, number, number],
};

describe('readRevealPresence', () => {
  it('returns null for an idle player', () => {
    expect(readRevealPresence(makePlayer('p1', { reveal_state: 'idle' }))).toBeNull();
  });

  it('returns null when reveal_state is missing', () => {
    expect(readRevealPresence(makePlayer('p1', {}))).toBeNull();
  });

  it('returns null when click hit point is missing', () => {
    const partial = { ...fullRevealProps };
    delete (partial as Record<string, unknown>).click_hit_point;
    expect(readRevealPresence(makePlayer('p1', partial))).toBeNull();
  });

  it('returns the typed bag for a fully-populated revealing player', () => {
    const result = readRevealPresence(makePlayer('p1', fullRevealProps));
    expect(result).not.toBeNull();
    expect(result!.reveal_state).toBe('swinging');
    expect(result!.click_hit_point).toEqual([0, 0, -10]);
  });

  it('returns null when click_cam_quat has wrong arity', () => {
    const broken = { ...fullRevealProps, click_cam_quat: [0, 0, 0] };
    expect(readRevealPresence(makePlayer('p1', broken))).toBeNull();
  });
});

describe('RemotePlayerReveals', () => {
  beforeEach(() => {
    // Reset the store for each test so entity state doesn't bleed.
    useWorldStore.setState({
      entities: new Map(),
      localPlayerId: null,
    });
  });

  it('renders nothing when no remote players are revealing', () => {
    useWorldStore.setState({
      entities: new Map([
        ['local', makePlayer('local')],
        ['remote-idle', makePlayer('remote-idle', { reveal_state: 'idle' })],
      ]),
      localPlayerId: 'local',
    });
    const { queryAllByTestId } = render(<RemotePlayerReveals />);
    expect(queryAllByTestId('remote-sword').length).toBe(0);
  });

  it('mounts 12 swords for each revealing remote player', () => {
    useWorldStore.setState({
      entities: new Map([
        ['local', makePlayer('local')],
        ['them', makePlayer('them', fullRevealProps)],
      ]),
      localPlayerId: 'local',
    });
    const { queryAllByTestId } = render(<RemotePlayerReveals />);
    expect(queryAllByTestId('remote-sword').length).toBe(12);
  });

  it('skips the local player even if they are revealing', () => {
    useWorldStore.setState({
      entities: new Map([['local', makePlayer('local', fullRevealProps)]]),
      localPlayerId: 'local',
    });
    const { queryAllByTestId } = render(<RemotePlayerReveals />);
    expect(queryAllByTestId('remote-sword').length).toBe(0);
  });

  it('mounts cascades for two simultaneous remote revealers', () => {
    useWorldStore.setState({
      entities: new Map([
        ['local', makePlayer('local')],
        ['a', makePlayer('a', fullRevealProps)],
        ['b', makePlayer('b', fullRevealProps)],
      ]),
      localPlayerId: 'local',
    });
    const { queryAllByTestId } = render(<RemotePlayerReveals />);
    expect(queryAllByTestId('remote-sword').length).toBe(24);
  });
});

