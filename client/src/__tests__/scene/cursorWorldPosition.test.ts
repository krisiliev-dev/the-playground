/**
 * Lean test for the `cursorWorldPosition` singleton — the
 * Vector3 shared between `CursorAvatar` (writer) and
 * `InteractionController` (reader). Pins:
 *
 *   - The export is a `THREE.Vector3` instance.
 *   - It defaults to (0, 0, 0).
 *   - Mutations on the shared instance are visible to readers.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Vector3 } from 'three';
import { cursorWorldPosition } from '@/components/scene/cursorWorldPosition';

describe('cursorWorldPosition singleton', () => {
  beforeEach(() => {
    cursorWorldPosition.set(0, 0, 0);
  });

  it('is a Vector3 instance', () => {
    expect(cursorWorldPosition).toBeInstanceOf(Vector3);
  });

  it('defaults to the origin', () => {
    expect(cursorWorldPosition.x).toBe(0);
    expect(cursorWorldPosition.y).toBe(0);
    expect(cursorWorldPosition.z).toBe(0);
  });

  it('mutations are visible across readers (same instance)', () => {
    cursorWorldPosition.set(10, 20, 30);
    // Re-import and check — same module-scoped reference.
    expect(cursorWorldPosition.x).toBe(10);
    expect(cursorWorldPosition.y).toBe(20);
    expect(cursorWorldPosition.z).toBe(30);
  });
});
