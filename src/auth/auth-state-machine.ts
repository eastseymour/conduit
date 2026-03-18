/**
 * Auth State Machine — enforces valid state transitions.
 *
 * Invariants:
 * 1. State can only transition via explicitly allowed paths (VALID_TRANSITIONS)
 * 2. Every transition emits an event to listeners
 * 3. The state machine is the single source of truth for current auth state
 * 4. Invalid transitions throw ConduitAuthError with INVALID_STATE_TRANSITION code
 */

import {
  AuthState,
  AuthEvent,
  VALID_TRANSITIONS,
  ConduitAuthError,
} from './types';

export type StateChangeListener = (event: AuthEvent) => void;

export class AuthStateMachine {
  private _state: AuthState;
  private readonly _sessionId: string;
  private readonly _listeners: Set<StateChangeListener> = new Set();

  /**
   * Precondition: sessionId must be non-empty
   * Postcondition: machine starts in 'idle' state
   */
  constructor(sessionId: string) {
    if (!sessionId || sessionId.trim().length === 0) {
      throw new ConduitAuthError(
        'Session ID must be non-empty',
        'INVALID_STATE_TRANSITION',
      );
    }
    this._sessionId = sessionId;
    this._state = 'idle';
  }

  /** Current state — read-only access */
  get state(): AuthState {
    return this._state;
  }

  get sessionId(): string {
    return this._sessionId;
  }

  /**
   * Attempt a state transition.
   *
   * Precondition: `to` must be a valid successor of the current state
   * Postcondition: state is updated and all listeners are notified
   *
   * @throws ConduitAuthError if transition is invalid
   */
  transition(to: AuthState, eventData: Omit<AuthEvent, 'sessionId' | 'timestamp' | 'type'>): void {
    const allowed = VALID_TRANSITIONS[this._state];
    if (!allowed.includes(to)) {
      throw new ConduitAuthError(
        `Invalid state transition: ${this._state} → ${to}. Allowed: [${allowed.join(', ')}]`,
        'INVALID_STATE_TRANSITION',
      );
    }

    this._state = to;

    const event: AuthEvent = {
      ...eventData,
      type: to,
      sessionId: this._sessionId,
      timestamp: new Date(),
    } as AuthEvent;

    this._notifyListeners(event);
  }

  /**
   * Register a listener for state changes.
   * Returns an unsubscribe function.
   */
  onStateChange(listener: StateChangeListener): () => void {
    this._listeners.add(listener);
    return () => {
      this._listeners.delete(listener);
    };
  }

  /**
   * Reset to idle state. Only valid from terminal states (authenticated, auth_failed).
   */
  reset(): void {
    if (this._state !== 'authenticated' && this._state !== 'auth_failed') {
      throw new ConduitAuthError(
        `Cannot reset from state "${this._state}". Must be in authenticated or auth_failed state.`,
        'INVALID_STATE_TRANSITION',
      );
    }
    this.transition('idle', {});
  }

  /**
   * Check if a transition to the given state is valid from the current state.
   */
  canTransitionTo(to: AuthState): boolean {
    return VALID_TRANSITIONS[this._state].includes(to);
  }

  /**
   * Check if the current state is a terminal state (authenticated or auth_failed).
   */
  isTerminal(): boolean {
    return this._state === 'authenticated' || this._state === 'auth_failed';
  }

  /**
   * Check if the machine is currently in an MFA-related state.
   */
  isInMfaFlow(): boolean {
    return this._state === 'mfa_required' || this._state === 'mfa_submitting';
  }

  private _notifyListeners(event: AuthEvent): void {
    for (const listener of this._listeners) {
      try {
        listener(event);
      } catch {
        // Listeners must not throw — swallow errors to protect the state machine
        // In production, this should log to a monitoring system
      }
    }
  }
}
