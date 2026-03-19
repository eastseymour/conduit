import { AuthStateMachine } from '../../src/auth/auth-state-machine';
import {
  ConduitAuthError,
  VALID_TRANSITIONS,
  AuthState,
  type AuthEvent,
} from '../../src/auth/types';

describe('AuthStateMachine', () => {
  let sm: AuthStateMachine;

  beforeEach(() => {
    sm = new AuthStateMachine('test-session-123');
  });

  // ─── Construction ──────────────────────────────────────────────────

  describe('construction', () => {
    it('should start in idle state', () => {
      expect(sm.state).toBe('idle');
    });

    it('should store the session ID', () => {
      expect(sm.sessionId).toBe('test-session-123');
    });

    it('should throw if sessionId is empty', () => {
      expect(() => new AuthStateMachine('')).toThrow(ConduitAuthError);
      expect(() => new AuthStateMachine('')).toThrow('Session ID must be non-empty');
    });

    it('should throw if sessionId is whitespace-only', () => {
      expect(() => new AuthStateMachine('   ')).toThrow(ConduitAuthError);
    });
  });

  // ─── Valid Transitions ─────────────────────────────────────────────

  describe('valid transitions', () => {
    it('should transition from idle to logging_in', () => {
      sm.transition('logging_in', { bankId: 'chase' });
      expect(sm.state).toBe('logging_in');
    });

    it('should transition from logging_in to mfa_required', () => {
      sm.transition('logging_in', { bankId: 'chase' });
      sm.transition('mfa_required', {
        challenge: {
          challengeId: 'c1',
          type: 'sms_code' as const,
          maskedPhoneNumber: '***1234',
        },
      });
      expect(sm.state).toBe('mfa_required');
    });

    it('should transition from logging_in to authenticated', () => {
      sm.transition('logging_in', { bankId: 'chase' });
      sm.transition('authenticated', { sessionToken: 'tok_123' });
      expect(sm.state).toBe('authenticated');
    });

    it('should transition from logging_in to auth_failed', () => {
      sm.transition('logging_in', { bankId: 'chase' });
      sm.transition('auth_failed', { reason: 'Bad password', isLocked: false });
      expect(sm.state).toBe('auth_failed');
    });

    it('should transition from mfa_required to mfa_submitting', () => {
      sm.transition('logging_in', { bankId: 'chase' });
      sm.transition('mfa_required', {
        challenge: { challengeId: 'c1', type: 'sms_code' as const, maskedPhoneNumber: '***1234' },
      });
      sm.transition('mfa_submitting', { challengeType: 'sms_code' });
      expect(sm.state).toBe('mfa_submitting');
    });

    it('should transition from mfa_submitting to authenticated', () => {
      sm.transition('logging_in', { bankId: 'chase' });
      sm.transition('mfa_required', {
        challenge: { challengeId: 'c1', type: 'sms_code' as const, maskedPhoneNumber: '***1234' },
      });
      sm.transition('mfa_submitting', { challengeType: 'sms_code' });
      sm.transition('authenticated', { sessionToken: 'tok_456' });
      expect(sm.state).toBe('authenticated');
    });

    it('should transition from mfa_submitting back to mfa_required (retry)', () => {
      sm.transition('logging_in', { bankId: 'chase' });
      sm.transition('mfa_required', {
        challenge: { challengeId: 'c1', type: 'sms_code' as const, maskedPhoneNumber: '***1234' },
      });
      sm.transition('mfa_submitting', { challengeType: 'sms_code' });
      sm.transition('mfa_required', {
        challenge: { challengeId: 'c2', type: 'sms_code' as const, maskedPhoneNumber: '***1234' },
      });
      expect(sm.state).toBe('mfa_required');
    });

    it('should transition from authenticated to idle (reset)', () => {
      sm.transition('logging_in', { bankId: 'chase' });
      sm.transition('authenticated', { sessionToken: 'tok' });
      sm.transition('idle', {});
      expect(sm.state).toBe('idle');
    });

    it('should transition from auth_failed to idle (reset)', () => {
      sm.transition('logging_in', { bankId: 'chase' });
      sm.transition('auth_failed', { reason: 'bad password', isLocked: false });
      sm.transition('idle', {});
      expect(sm.state).toBe('idle');
    });
  });

  // ─── Invalid Transitions ───────────────────────────────────────────

  describe('invalid transitions', () => {
    it('should throw on invalid transition from idle to authenticated', () => {
      expect(() => sm.transition('authenticated', { sessionToken: 'tok' })).toThrow(
        ConduitAuthError,
      );
      expect(() => sm.transition('authenticated', { sessionToken: 'tok' })).toThrow(
        'Invalid state transition: idle → authenticated',
      );
    });

    it('should throw on invalid transition from idle to mfa_required', () => {
      expect(() =>
        sm.transition('mfa_required', {
          challenge: { challengeId: 'c1', type: 'sms_code' as const, maskedPhoneNumber: '***1234' },
        }),
      ).toThrow(ConduitAuthError);
    });

    it('should throw on invalid transition from logging_in to idle', () => {
      sm.transition('logging_in', { bankId: 'chase' });
      expect(() => sm.transition('idle', {})).toThrow(ConduitAuthError);
    });

    it('should throw on invalid transition from mfa_required to authenticated', () => {
      sm.transition('logging_in', { bankId: 'chase' });
      sm.transition('mfa_required', {
        challenge: { challengeId: 'c1', type: 'sms_code' as const, maskedPhoneNumber: '***1234' },
      });
      expect(() => sm.transition('authenticated', { sessionToken: 'tok' })).toThrow(
        ConduitAuthError,
      );
    });

    it('should have INVALID_STATE_TRANSITION error code', () => {
      try {
        sm.transition('authenticated', { sessionToken: 'tok' });
        fail('Should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(ConduitAuthError);
        expect((e as ConduitAuthError).code).toBe('INVALID_STATE_TRANSITION');
      }
    });
  });

  // ─── Event Listeners ───────────────────────────────────────────────

  describe('event listeners', () => {
    it('should notify listeners on transition', () => {
      const events: AuthEvent[] = [];
      sm.onStateChange((event) => events.push(event));

      sm.transition('logging_in', { bankId: 'chase' });

      expect(events).toHaveLength(1);
      expect(events[0]!.type).toBe('logging_in');
      expect(events[0]!.sessionId).toBe('test-session-123');
      expect(events[0]!.timestamp).toBeInstanceOf(Date);
    });

    it('should notify multiple listeners', () => {
      let count1 = 0;
      let count2 = 0;
      sm.onStateChange(() => count1++);
      sm.onStateChange(() => count2++);

      sm.transition('logging_in', { bankId: 'chase' });

      expect(count1).toBe(1);
      expect(count2).toBe(1);
    });

    it('should allow unsubscribing', () => {
      let count = 0;
      const unsub = sm.onStateChange(() => count++);

      sm.transition('logging_in', { bankId: 'chase' });
      expect(count).toBe(1);

      unsub();
      sm.transition('authenticated', { sessionToken: 'tok' });
      expect(count).toBe(1); // Not incremented
    });

    it('should swallow listener errors without affecting state', () => {
      sm.onStateChange(() => {
        throw new Error('Listener error!');
      });
      const events: AuthEvent[] = [];
      sm.onStateChange((event) => events.push(event));

      sm.transition('logging_in', { bankId: 'chase' });

      // State should still update despite first listener throwing
      expect(sm.state).toBe('logging_in');
      // Second listener should still fire
      expect(events).toHaveLength(1);
    });

    it('should include event-specific data', () => {
      const events: AuthEvent[] = [];
      sm.onStateChange((event) => events.push(event));

      sm.transition('logging_in', { bankId: 'chase' });

      const event = events[0]!;
      expect(event.type).toBe('logging_in');
      if (event.type === 'logging_in') {
        expect(event.bankId).toBe('chase');
      }
    });
  });

  // ─── Helper Methods ────────────────────────────────────────────────

  describe('helper methods', () => {
    it('canTransitionTo returns true for valid transitions', () => {
      expect(sm.canTransitionTo('logging_in')).toBe(true);
    });

    it('canTransitionTo returns false for invalid transitions', () => {
      expect(sm.canTransitionTo('authenticated')).toBe(false);
    });

    it('isTerminal returns false for non-terminal states', () => {
      expect(sm.isTerminal()).toBe(false);
      sm.transition('logging_in', { bankId: 'chase' });
      expect(sm.isTerminal()).toBe(false);
    });

    it('isTerminal returns true for authenticated', () => {
      sm.transition('logging_in', { bankId: 'chase' });
      sm.transition('authenticated', { sessionToken: 'tok' });
      expect(sm.isTerminal()).toBe(true);
    });

    it('isTerminal returns true for auth_failed', () => {
      sm.transition('logging_in', { bankId: 'chase' });
      sm.transition('auth_failed', { reason: 'bad', isLocked: false });
      expect(sm.isTerminal()).toBe(true);
    });

    it('isInMfaFlow returns true for mfa_required', () => {
      sm.transition('logging_in', { bankId: 'chase' });
      sm.transition('mfa_required', {
        challenge: { challengeId: 'c1', type: 'sms_code' as const, maskedPhoneNumber: '***1234' },
      });
      expect(sm.isInMfaFlow()).toBe(true);
    });

    it('isInMfaFlow returns true for mfa_submitting', () => {
      sm.transition('logging_in', { bankId: 'chase' });
      sm.transition('mfa_required', {
        challenge: { challengeId: 'c1', type: 'sms_code' as const, maskedPhoneNumber: '***1234' },
      });
      sm.transition('mfa_submitting', { challengeType: 'sms_code' });
      expect(sm.isInMfaFlow()).toBe(true);
    });

    it('isInMfaFlow returns false for non-MFA states', () => {
      expect(sm.isInMfaFlow()).toBe(false);
    });
  });

  // ─── Reset ─────────────────────────────────────────────────────────

  describe('reset', () => {
    it('should reset from authenticated to idle', () => {
      sm.transition('logging_in', { bankId: 'chase' });
      sm.transition('authenticated', { sessionToken: 'tok' });
      sm.reset();
      expect(sm.state).toBe('idle');
    });

    it('should reset from auth_failed to idle', () => {
      sm.transition('logging_in', { bankId: 'chase' });
      sm.transition('auth_failed', { reason: 'bad', isLocked: false });
      sm.reset();
      expect(sm.state).toBe('idle');
    });

    it('should throw when resetting from non-terminal state', () => {
      sm.transition('logging_in', { bankId: 'chase' });
      expect(() => sm.reset()).toThrow(ConduitAuthError);
      expect(() => sm.reset()).toThrow('Cannot reset from state "logging_in"');
    });
  });

  // ─── VALID_TRANSITIONS completeness ────────────────────────────────

  describe('VALID_TRANSITIONS completeness', () => {
    const allStates: AuthState[] = [
      'idle',
      'logging_in',
      'mfa_required',
      'mfa_submitting',
      'authenticated',
      'auth_failed',
    ];

    it('should have an entry for every state', () => {
      for (const state of allStates) {
        expect(VALID_TRANSITIONS[state]).toBeDefined();
        expect(Array.isArray(VALID_TRANSITIONS[state])).toBe(true);
      }
    });

    it('should only reference valid states in transitions', () => {
      for (const [_from, tos] of Object.entries(VALID_TRANSITIONS)) {
        for (const to of tos) {
          expect(allStates).toContain(to);
        }
      }
    });
  });
});
