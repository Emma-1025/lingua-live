import type { SessionState } from '../models.js';

export type SessionControl = 'start' | 'pause' | 'resume' | 'stop';

export type UnavailableControlReason = 'invalid_transition' | 'no_audio_source';

export interface SessionTransitionSuccess {
  ok: true;
  control: SessionControl;
  previousState: SessionState;
  newState: SessionState;
}

export interface SessionTransitionFailure {
  ok: false;
  control: SessionControl;
  state: SessionState;
  reason: UnavailableControlReason;
}

export type SessionTransitionResult = SessionTransitionSuccess | SessionTransitionFailure;

export interface StartOptions {
  /** Whether a valid audio source is selected before starting. */
  hasAudioSource: boolean;
}

type StateChangeHandler = (change: {
  previousState: SessionState;
  newState: SessionState;
  control: SessionControl;
}) => void;

type UnavailableControlHandler = (event: {
  control: SessionControl;
  state: SessionState;
  reason: UnavailableControlReason;
}) => void;

/**
 * Owns the session state machine: stopped | capturing | paused.
 * Rejects invalid transitions and emits unavailable-control signals (Req 7.6).
 */
export class SessionManager {
  private state: SessionState = 'stopped';
  private readonly stateChangeHandlers = new Set<StateChangeHandler>();
  private readonly unavailableControlHandlers = new Set<UnavailableControlHandler>();

  getState(): SessionState {
    return this.state;
  }

  start(options: StartOptions): SessionTransitionResult {
    if (!options.hasAudioSource) {
      this.emitUnavailable('start', 'no_audio_source');
      return { ok: false, control: 'start', state: this.state, reason: 'no_audio_source' };
    }

    return this.transition('start', 'stopped', 'capturing');
  }

  pause(): SessionTransitionResult {
    return this.transition('pause', 'capturing', 'paused');
  }

  resume(): SessionTransitionResult {
    return this.transition('resume', 'paused', 'capturing');
  }

  stop(): SessionTransitionResult {
    if (this.state === 'stopped') {
      return this.reject('stop');
    }
    const previousState = this.state;
    this.state = 'stopped';
    this.emitStateChange(previousState, 'stopped', 'stop');
    return { ok: true, control: 'stop', previousState, newState: 'stopped' };
  }

  /** Transition capturing → paused when the audio source is lost (Req 1.5). */
  handleSourceLost(): SessionTransitionResult {
    return this.transition('pause', 'capturing', 'paused');
  }

  onStateChange(handler: StateChangeHandler): () => void {
    this.stateChangeHandlers.add(handler);
    return () => this.stateChangeHandlers.delete(handler);
  }

  onUnavailableControl(handler: UnavailableControlHandler): () => void {
    this.unavailableControlHandlers.add(handler);
    return () => this.unavailableControlHandlers.delete(handler);
  }

  private transition(
    control: SessionControl,
    from: SessionState,
    to: SessionState,
  ): SessionTransitionResult {
    if (this.state !== from) {
      return this.reject(control);
    }

    const previousState = this.state;
    this.state = to;
    this.emitStateChange(previousState, to, control);
    return { ok: true, control, previousState, newState: to };
  }

  private reject(control: SessionControl): SessionTransitionFailure {
    this.emitUnavailable(control, 'invalid_transition');
    return { ok: false, control, state: this.state, reason: 'invalid_transition' };
  }

  private emitStateChange(
    previousState: SessionState,
    newState: SessionState,
    control: SessionControl,
  ): void {
    for (const handler of this.stateChangeHandlers) {
      handler({ previousState, newState, control });
    }
  }

  private emitUnavailable(control: SessionControl, reason: UnavailableControlReason): void {
    for (const handler of this.unavailableControlHandlers) {
      handler({ control, state: this.state, reason });
    }
  }
}
