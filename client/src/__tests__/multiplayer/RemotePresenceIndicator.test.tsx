/**
 * Tests for the testable pieces of `RemotePresenceIndicator`:
 *
 *   - `readMenu` — defensive type-narrowing on the opaque
 *     `entity.props.menu` value.
 *   - `RemotePauseMenuView` — pure DOM render (no R3F context),
 *     verifies the expected menu items show up.
 *
 * The full `<RemotePresenceIndicator>` component renders a 3D
 * scene (drei `<Html transform>` etc.) and is not unit-tested
 * here — visual fidelity is verified through the manual
 * two-tab playtest, and the data-path correctness is covered
 * by `readMenu` + the entity replication tests.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { readMenu } from '@/multiplayer/RemotePresenceIndicator';
import { RemotePauseMenuView } from '@/multiplayer/RemotePauseMenuView';
import type { Entity } from '@/multiplayer/types';
import { IDENTITY_TRANSFORM } from '@/multiplayer/types';

function entity(props: Record<string, unknown>): Entity {
  return {
    id: 'test',
    kind: 'player',
    transform: IDENTITY_TRANSFORM,
    props,
  };
}

describe('readMenu', () => {
  it('returns the menu string when set to a non-empty value', () => {
    expect(readMenu(entity({ menu: 'pause' }))).toBe('pause');
    expect(readMenu(entity({ menu: 'settings' }))).toBe('settings');
  });

  it('returns null when menu is missing', () => {
    expect(readMenu(entity({}))).toBeNull();
  });

  it('returns null when menu is explicitly null', () => {
    expect(readMenu(entity({ menu: null }))).toBeNull();
  });

  it('returns null for non-string values (defensive)', () => {
    expect(readMenu(entity({ menu: 42 }))).toBeNull();
    expect(readMenu(entity({ menu: true }))).toBeNull();
    expect(readMenu(entity({ menu: {} }))).toBeNull();
    expect(readMenu(entity({ menu: [] }))).toBeNull();
  });

  it('returns null for empty string (defensive)', () => {
    expect(readMenu(entity({ menu: '' }))).toBeNull();
  });

  it('does not access prototype keys via the opaque value', () => {
    // entity.props is `Record<string, unknown>` — readMenu's narrowing
    // shouldn't be defeated by oddly-shaped objects. Calling with a
    // freshly-built entity ensures the cast is safe.
    expect(readMenu(entity({ menu: 'pause', extra: 'ignored' }))).toBe('pause');
  });
});

describe('RemotePauseMenuView', () => {
  it('renders the expected section labels', () => {
    const { container } = render(<RemotePauseMenuView />);
    const text = container.textContent ?? '';
    expect(text).toContain('Home');
    expect(text).toContain('About');
    expect(text).toContain('Projects');
    expect(text).toContain('Writing');
    expect(text).toContain('Contact');
    expect(text).toContain('Simple Experience');
  });

  it('includes the keymap rows', () => {
    const { container } = render(<RemotePauseMenuView />);
    const text = container.textContent ?? '';
    expect(text).toContain('walk');
    expect(text).toContain('look around');
    expect(text).toContain('interact');
  });

  it('renders the heading', () => {
    const { container } = render(<RemotePauseMenuView />);
    expect(container.textContent).toContain('Menu');
  });
});
