/**
 * Tests for the central Zustand store.
 *
 * These tests verify that state mutations work correctly in isolation.
 * Since the store is the single source of truth (and will be the
 * multiplayer sync point), correctness here is critical.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useWorldStore } from '@/store';

describe('useWorldStore', () => {
  // Reset the store to its initial state before each test.
  // Zustand stores are singletons, so we need to manually reset.
  beforeEach(() => {
    const { setPlayerPosition, setPlayerRotation, setActiveZone, setReady } =
      useWorldStore.getState();

    // Reset to defaults
    setPlayerPosition([0, 0, 5]);
    setPlayerRotation([0, 0, 0]);
    setActiveZone(null);
    setReady(false);
  });

  // ── Player state ─────────────────────────────────────────────

  describe('player', () => {
    it('should have an initial position at [0, 0, 5]', () => {
      const { player } = useWorldStore.getState();
      expect(player.position).toEqual([0, 0, 5]);
    });

    it('should update player position', () => {
      useWorldStore.getState().setPlayerPosition([10, 5, -3]);
      const { player } = useWorldStore.getState();
      expect(player.position).toEqual([10, 5, -3]);
    });

    it('should update player rotation', () => {
      useWorldStore.getState().setPlayerRotation([0.5, 1.2, 0]);
      const { player } = useWorldStore.getState();
      expect(player.rotation).toEqual([0.5, 1.2, 0]);
    });

    it('should preserve other player fields when updating position', () => {
      const originalId = useWorldStore.getState().player.id;
      useWorldStore.getState().setPlayerPosition([1, 2, 3]);
      const { player } = useWorldStore.getState();

      expect(player.id).toBe(originalId);
      expect(player.name).toBe('Guest');
      expect(player.cursorColor).toBe('#00ff88');
    });

    it('should have a unique ID', () => {
      const { player } = useWorldStore.getState();
      expect(player.id).toBeTruthy();
      expect(typeof player.id).toBe('string');
      expect(player.id.length).toBeGreaterThan(0);
    });
  });

  // ── Zone navigation ──────────────────────────────────────────

  describe('zone navigation', () => {
    it('should start with no active zone', () => {
      const { activeZoneId } = useWorldStore.getState();
      expect(activeZoneId).toBeNull();
    });

    it('should set the active zone', () => {
      useWorldStore.getState().setActiveZone('portfolio');
      expect(useWorldStore.getState().activeZoneId).toBe('portfolio');
    });

    it('should clear the active zone when set to null', () => {
      useWorldStore.getState().setActiveZone('about');
      useWorldStore.getState().setActiveZone(null);
      expect(useWorldStore.getState().activeZoneId).toBeNull();
    });
  });

  // ── Environment ──────────────────────────────────────────────

  describe('environment', () => {
    it('should have default zones', () => {
      const { environment } = useWorldStore.getState();
      expect(environment.zones.length).toBeGreaterThan(0);
    });

    it('should contain a portfolio zone', () => {
      const { environment } = useWorldStore.getState();
      const portfolioZone = environment.zones.find((z) => z.id === 'portfolio');
      expect(portfolioZone).toBeDefined();
      expect(portfolioZone?.type).toBe('portfolio');
    });

    it('should update the entire environment config', () => {
      const newConfig = {
        ...useWorldStore.getState().environment,
        ambientColor: '#ff0000',
        ambientIntensity: 0.8,
      };

      useWorldStore.getState().updateEnvironment(newConfig);
      const { environment } = useWorldStore.getState();

      expect(environment.ambientColor).toBe('#ff0000');
      expect(environment.ambientIntensity).toBe(0.8);
    });
  });

  // ── Loading state ────────────────────────────────────────────

  describe('loading', () => {
    it('should start not ready', () => {
      expect(useWorldStore.getState().isReady).toBe(false);
    });

    it('should mark as ready', () => {
      useWorldStore.getState().setReady(true);
      expect(useWorldStore.getState().isReady).toBe(true);
    });
  });

  // ── Phase 4 reveal slice ─────────────────────────────────────

  describe('reveal', () => {
    beforeEach(() => {
      useWorldStore.getState().resetReveal();
    });

    it('should start in idle', () => {
      expect(useWorldStore.getState().revealState).toBe('idle');
    });

    it('should advance idle → armed', () => {
      useWorldStore.getState().advanceReveal();
      expect(useWorldStore.getState().revealState).toBe('armed');
    });

    it('should advance through every step in order', () => {
      const order: string[] = [useWorldStore.getState().revealState];
      for (let i = 0; i < 6; i++) {
        useWorldStore.getState().advanceReveal();
        order.push(useWorldStore.getState().revealState);
      }
      // 4 advances move idle → armed → swinging → impact → revealed,
      // then any further calls clamp at 'revealed'.
      expect(order).toEqual([
        'idle',
        'armed',
        'swinging',
        'impact',
        'revealed',
        'revealed',
        'revealed',
      ]);
    });

    it('should not advance past revealed', () => {
      const { advanceReveal } = useWorldStore.getState();
      for (let i = 0; i < 10; i++) {advanceReveal();}
      expect(useWorldStore.getState().revealState).toBe('revealed');
    });

    it('should reset to idle from any state', () => {
      const { advanceReveal, resetReveal } = useWorldStore.getState();
      advanceReveal();
      advanceReveal();
      advanceReveal();
      expect(useWorldStore.getState().revealState).toBe('impact');
      resetReveal();
      expect(useWorldStore.getState().revealState).toBe('idle');
    });
  });
});
