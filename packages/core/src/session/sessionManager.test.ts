import { describe, expect, it, vi } from 'vitest';
import { SessionManager } from './sessionManager.js';

describe('SessionManager', () => {
  it('starts in stopped state', () => {
    const manager = new SessionManager();
    expect(manager.getState()).toBe('stopped');
  });

  describe('valid transitions', () => {
    it('stopped → capturing on start with audio source', () => {
      const manager = new SessionManager();
      const result = manager.start({ hasAudioSource: true });

      expect(result).toEqual({
        ok: true,
        control: 'start',
        previousState: 'stopped',
        newState: 'capturing',
      });
      expect(manager.getState()).toBe('capturing');
    });

    it('capturing → paused on pause', () => {
      const manager = new SessionManager();
      manager.start({ hasAudioSource: true });

      const result = manager.pause();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.newState).toBe('paused');
      }
      expect(manager.getState()).toBe('paused');
    });

    it('paused → capturing on resume', () => {
      const manager = new SessionManager();
      manager.start({ hasAudioSource: true });
      manager.pause();

      const result = manager.resume();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.newState).toBe('capturing');
      }
      expect(manager.getState()).toBe('capturing');
    });

    it('capturing → stopped on stop', () => {
      const manager = new SessionManager();
      manager.start({ hasAudioSource: true });

      const result = manager.stop();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.newState).toBe('stopped');
      }
      expect(manager.getState()).toBe('stopped');
    });

    it('paused → stopped on stop', () => {
      const manager = new SessionManager();
      manager.start({ hasAudioSource: true });
      manager.pause();

      const result = manager.stop();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.newState).toBe('stopped');
      }
      expect(manager.getState()).toBe('stopped');
    });

    it('capturing → paused on source lost', () => {
      const manager = new SessionManager();
      manager.start({ hasAudioSource: true });

      const result = manager.handleSourceLost();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.newState).toBe('paused');
      }
      expect(manager.getState()).toBe('paused');
    });
  });

  describe('invalid transitions', () => {
    it.each([
      ['pause', 'stopped'] as const,
      ['resume', 'stopped'] as const,
      ['stop', 'stopped'] as const,
    ])('rejects %s while stopped', (control, expectedState) => {
      const manager = new SessionManager();
      const unavailable = vi.fn();
      manager.onUnavailableControl(unavailable);

      const result =
        control === 'pause'
          ? manager.pause()
          : control === 'resume'
            ? manager.resume()
            : manager.stop();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe('invalid_transition');
        expect(result.state).toBe(expectedState);
      }
      expect(manager.getState()).toBe('stopped');
      expect(unavailable).toHaveBeenCalledWith({
        control,
        state: 'stopped',
        reason: 'invalid_transition',
      });
    });

    it('rejects start without audio source and stays stopped', () => {
      const manager = new SessionManager();
      const unavailable = vi.fn();
      manager.onUnavailableControl(unavailable);

      const result = manager.start({ hasAudioSource: false });

      expect(result).toEqual({
        ok: false,
        control: 'start',
        state: 'stopped',
        reason: 'no_audio_source',
      });
      expect(manager.getState()).toBe('stopped');
      expect(unavailable).toHaveBeenCalledWith({
        control: 'start',
        state: 'stopped',
        reason: 'no_audio_source',
      });
    });

    it('rejects resume while capturing', () => {
      const manager = new SessionManager();
      manager.start({ hasAudioSource: true });
      const unavailable = vi.fn();
      manager.onUnavailableControl(unavailable);

      const result = manager.resume();

      expect(result.ok).toBe(false);
      expect(manager.getState()).toBe('capturing');
      expect(unavailable).toHaveBeenCalledWith({
        control: 'resume',
        state: 'capturing',
        reason: 'invalid_transition',
      });
    });

    it('rejects pause while paused', () => {
      const manager = new SessionManager();
      manager.start({ hasAudioSource: true });
      manager.pause();

      const result = manager.pause();

      expect(result.ok).toBe(false);
      expect(manager.getState()).toBe('paused');
    });

    it('rejects start while capturing', () => {
      const manager = new SessionManager();
      manager.start({ hasAudioSource: true });

      const result = manager.start({ hasAudioSource: true });

      expect(result.ok).toBe(false);
      expect(manager.getState()).toBe('capturing');
    });

    it('rejects source lost while stopped or paused', () => {
      const stopped = new SessionManager();
      expect(stopped.handleSourceLost().ok).toBe(false);
      expect(stopped.getState()).toBe('stopped');

      const paused = new SessionManager();
      paused.start({ hasAudioSource: true });
      paused.pause();
      expect(paused.handleSourceLost().ok).toBe(false);
      expect(paused.getState()).toBe('paused');
    });
  });

  describe('state change events', () => {
    it('emits on every successful transition', () => {
      const manager = new SessionManager();
      const changes: string[] = [];
      manager.onStateChange(({ previousState, newState, control }) => {
        changes.push(`${previousState}->${newState}:${control}`);
      });

      manager.start({ hasAudioSource: true });
      manager.pause();
      manager.resume();
      manager.stop();

      expect(changes).toEqual([
        'stopped->capturing:start',
        'capturing->paused:pause',
        'paused->capturing:resume',
        'capturing->stopped:stop',
      ]);
    });

    it('does not emit state change on rejected transition', () => {
      const manager = new SessionManager();
      const changes = vi.fn();
      manager.onStateChange(changes);

      manager.resume();

      expect(changes).not.toHaveBeenCalled();
      expect(manager.getState()).toBe('stopped');
    });
  });
});
