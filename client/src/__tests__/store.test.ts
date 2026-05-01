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
    const {
      setPlayerPosition,
      setPlayerRotation,
      setActiveZone,
      setReady,
      setCursorAvatarActive,
      resetReveal,
    } = useWorldStore.getState();

    // Reset to defaults
    setPlayerPosition([0, 0, 5]);
    setPlayerRotation([0, 0, 0]);
    setActiveZone(null);
    setReady(false);
    setCursorAvatarActive(false);
    resetReveal();
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
      for (let i = 0; i < 10; i++) {
        advanceReveal();
      }
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

  // ── Cursor avatar (Phase 5) ──────────────────────────────────

  describe('cursorAvatar', () => {
    it('toggleCursorAvatar should flip the flag on each call', () => {
      useWorldStore.getState().setCursorAvatarActive(true);
      const { toggleCursorAvatar } = useWorldStore.getState();
      toggleCursorAvatar();
      expect(useWorldStore.getState().cursorAvatarActive).toBe(false);
      toggleCursorAvatar();
      expect(useWorldStore.getState().cursorAvatarActive).toBe(true);
    });

    it('setCursorAvatarActive should set the flag directly', () => {
      const { setCursorAvatarActive } = useWorldStore.getState();
      setCursorAvatarActive(true);
      expect(useWorldStore.getState().cursorAvatarActive).toBe(true);
      setCursorAvatarActive(false);
      expect(useWorldStore.getState().cursorAvatarActive).toBe(false);
    });
  });

  describe('clickHit', () => {
    it('defaults to null', () => {
      useWorldStore.getState().setClickHit(null);
      expect(useWorldStore.getState().clickHit).toBeNull();
    });

    it('setClickHit stores point + normal', () => {
      useWorldStore.getState().setClickHit({
        point: [1, 2, 3],
        normal: [0, 0, 1],
      });
      expect(useWorldStore.getState().clickHit).toEqual({
        point: [1, 2, 3],
        normal: [0, 0, 1],
      });
    });

    it('resetReveal also clears clickHit', () => {
      useWorldStore.getState().setClickHit({ point: [1, 2, 3], normal: [1, 0, 0] });
      useWorldStore.getState().resetReveal();
      expect(useWorldStore.getState().clickHit).toBeNull();
    });
  });

  describe('avatarSnapshot', () => {
    const sampleSnapshot = {
      position: [4, -3, 12] as [number, number, number],
      yaw: 1.2,
      pitch: -0.4,
      cameraPosition: [4, -3, 18] as [number, number, number],
      cameraQuaternion: [0.1, 0.2, 0.3, 0.9239] as [number, number, number, number],
    };

    beforeEach(() => {
      useWorldStore.getState().setAvatarSnapshot(null);
    });

    it('defaults to null', () => {
      expect(useWorldStore.getState().avatarSnapshot).toBeNull();
    });

    it('setAvatarSnapshot stores all fields (position + look angles + camera transform)', () => {
      useWorldStore.getState().setAvatarSnapshot(sampleSnapshot);
      expect(useWorldStore.getState().avatarSnapshot).toEqual(sampleSnapshot);
    });

    it('setAvatarSnapshot(null) clears it back', () => {
      useWorldStore.getState().setAvatarSnapshot(sampleSnapshot);
      useWorldStore.getState().setAvatarSnapshot(null);
      expect(useWorldStore.getState().avatarSnapshot).toBeNull();
    });

    it('resetReveal clears the snapshot (full reset returns to spawn)', () => {
      useWorldStore.getState().setAvatarSnapshot(sampleSnapshot);
      useWorldStore.getState().resetReveal();
      expect(useWorldStore.getState().avatarSnapshot).toBeNull();
    });
  });

  describe('pendingPointerLock', () => {
    beforeEach(() => {
      useWorldStore.getState().setPendingPointerLock(false);
    });

    it('defaults to false', () => {
      expect(useWorldStore.getState().pendingPointerLock).toBe(false);
    });

    it('setPendingPointerLock toggles the flag', () => {
      useWorldStore.getState().setPendingPointerLock(true);
      expect(useWorldStore.getState().pendingPointerLock).toBe(true);
      useWorldStore.getState().setPendingPointerLock(false);
      expect(useWorldStore.getState().pendingPointerLock).toBe(false);
    });
  });

  describe('documentMode', () => {
    beforeEach(() => {
      // Each test starts from documentMode === false with a clean
      // localStorage so persistence assertions are deterministic.
      window.localStorage.clear();
      useWorldStore.getState().setDocumentMode(false);
      window.localStorage.clear();
    });

    it('defaults to a boolean (false in test env without prior persistence)', () => {
      const { documentMode } = useWorldStore.getState();
      expect(typeof documentMode).toBe('boolean');
      expect(documentMode).toBe(false);
    });

    it('setDocumentMode flips the flag', () => {
      useWorldStore.getState().setDocumentMode(true);
      expect(useWorldStore.getState().documentMode).toBe(true);
      useWorldStore.getState().setDocumentMode(false);
      expect(useWorldStore.getState().documentMode).toBe(false);
    });

    it('persists the chosen value to localStorage', () => {
      useWorldStore.getState().setDocumentMode(true);
      expect(window.localStorage.getItem('documentMode')).toBe('true');
      useWorldStore.getState().setDocumentMode(false);
      expect(window.localStorage.getItem('documentMode')).toBe('false');
    });

    describe('mid-reveal fast-forward when entering doc mode', () => {
      // Each transient phase has timer-driven refs that get
      // destroyed on Canvas unmount. Snapping straight to
      // `revealed` is the "end the animation now" escape hatch
      // so the user comes back to a stable scene.
      const TRANSIENT: Array<'armed' | 'swinging' | 'impact'> = ['armed', 'swinging', 'impact'];
      for (const phase of TRANSIENT) {
        it(`fast-forwards revealState='${phase}' to 'revealed'`, () => {
          useWorldStore.setState({ revealState: phase });
          useWorldStore.getState().setDocumentMode(true);
          expect(useWorldStore.getState().revealState).toBe('revealed');
          expect(useWorldStore.getState().documentMode).toBe(true);
        });
      }

      it("leaves revealState='idle' alone (user never clicked the cube)", () => {
        useWorldStore.setState({ revealState: 'idle' });
        useWorldStore.getState().setDocumentMode(true);
        expect(useWorldStore.getState().revealState).toBe('idle');
      });

      it("leaves revealState='revealed' alone (already settled)", () => {
        useWorldStore.setState({ revealState: 'revealed' });
        useWorldStore.getState().setDocumentMode(true);
        expect(useWorldStore.getState().revealState).toBe('revealed');
      });

      it('does NOT fast-forward when exiting doc mode (mode === false)', () => {
        // Mid-reveal exit shouldn't happen in practice (DocumentShell
        // is the only thing that calls setDocumentMode(false), and
        // by then revealState is whatever it was when entering doc
        // mode — already snapped). Still, document the contract:
        // the fast-forward only fires on entry.
        useWorldStore.setState({ revealState: 'swinging', documentMode: true });
        useWorldStore.getState().setDocumentMode(false);
        expect(useWorldStore.getState().revealState).toBe('swinging');
      });
    });
  });
});
