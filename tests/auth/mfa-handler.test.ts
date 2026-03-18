import { MfaHandler } from '../../src/auth/mfa-handler';
import { AuthStateMachine } from '../../src/auth/auth-state-machine';
import {
  AuthCallbacks,
  AuthEvent,
  MfaChallenge,
  MfaResponse,
  ConduitAuthError,
} from '../../src/auth/types';
import type { BrowserDriver, MfaSubmitResult } from '../../src/browser/types';

// ─── Helpers ─────────────────────────────────────────────────────────

function createStateMachineInLoggingIn(): AuthStateMachine {
  const sm = new AuthStateMachine('test-mfa-session');
  sm.transition('logging_in', { bankId: 'chase' });
  return sm;
}

function createMockBrowserDriver(
  submitMfaResponse: jest.Mock = jest.fn().mockResolvedValue({
    outcome: 'success',
    sessionToken: 'tok_mfa',
  } as MfaSubmitResult),
): BrowserDriver {
  return {
    navigateToLogin: jest.fn().mockResolvedValue(undefined),
    submitCredentials: jest.fn(),
    submitMfaResponse,
    handleRememberDevice: jest.fn().mockResolvedValue(undefined),
    cleanup: jest.fn().mockResolvedValue(undefined),
  };
}

function createMockCallbacks(
  onMfaResponse: MfaResponse | null = null,
): AuthCallbacks {
  return {
    onStateChange: jest.fn(),
    onMfaRequired: jest.fn().mockResolvedValue(onMfaResponse),
  };
}

const smsChallenge: MfaChallenge = {
  challengeId: 'c1',
  type: 'sms_code',
  maskedPhoneNumber: '***1234',
};

const smsResponse: MfaResponse = {
  challengeId: 'c1',
  type: 'sms_code',
  code: '123456',
};

// ─── Tests ───────────────────────────────────────────────────────────

describe('MfaHandler', () => {
  // ─── Construction ────────────────────────────────────────────────

  describe('construction', () => {
    it('should throw if maxRetries < 1', () => {
      const sm = createStateMachineInLoggingIn();
      const browser = createMockBrowserDriver();
      const callbacks = createMockCallbacks();

      expect(() => new MfaHandler(sm, browser, callbacks, 0, 60_000)).toThrow(ConduitAuthError);
      expect(() => new MfaHandler(sm, browser, callbacks, 0, 60_000)).toThrow(
        'maxRetries must be at least 1',
      );
    });
  });

  // ─── Successful MFA ──────────────────────────────────────────────

  describe('successful MFA', () => {
    it('should handle successful MFA on first attempt', async () => {
      const sm = createStateMachineInLoggingIn();
      const browser = createMockBrowserDriver();
      const callbacks = createMockCallbacks(smsResponse);

      const handler = new MfaHandler(sm, browser, callbacks, 3, 60_000);
      const result = await handler.handleMfaFlow(smsChallenge);

      expect(result.outcome).toBe('success');
      if (result.outcome === 'success') {
        expect(result.sessionToken).toBe('tok_mfa');
      }
    });

    it('should transition through mfa_required → mfa_submitting', async () => {
      const sm = createStateMachineInLoggingIn();
      const browser = createMockBrowserDriver();
      const callbacks = createMockCallbacks(smsResponse);

      const handler = new MfaHandler(sm, browser, callbacks, 3, 60_000);
      await handler.handleMfaFlow(smsChallenge);

      // After successful MFA, state should be mfa_submitting (caller handles success transition)
      expect(sm.state).toBe('mfa_submitting');
    });

    it('should call onMfaRequired with challenge', async () => {
      const sm = createStateMachineInLoggingIn();
      const browser = createMockBrowserDriver();
      const callbacks = createMockCallbacks(smsResponse);

      const handler = new MfaHandler(sm, browser, callbacks, 3, 60_000);
      await handler.handleMfaFlow(smsChallenge);

      expect(callbacks.onMfaRequired).toHaveBeenCalledWith(smsChallenge);
    });

    it('should submit MFA response to browser', async () => {
      const sm = createStateMachineInLoggingIn();
      const browser = createMockBrowserDriver();
      const callbacks = createMockCallbacks(smsResponse);

      const handler = new MfaHandler(sm, browser, callbacks, 3, 60_000);
      await handler.handleMfaFlow(smsChallenge);

      expect(browser.submitMfaResponse).toHaveBeenCalledWith(smsResponse);
    });
  });

  // ─── MFA Cancellation ────────────────────────────────────────────

  describe('MFA cancellation', () => {
    it('should return failed when host app cancels (returns null)', async () => {
      const sm = createStateMachineInLoggingIn();
      const browser = createMockBrowserDriver();
      const callbacks = createMockCallbacks(null); // null = cancel

      const handler = new MfaHandler(sm, browser, callbacks, 3, 60_000);
      const result = await handler.handleMfaFlow(smsChallenge);

      expect(result.outcome).toBe('failed');
      if (result.outcome === 'failed') {
        expect(result.reason).toBe('MFA cancelled by user');
      }
    });

    it('should not submit to browser when cancelled', async () => {
      const sm = createStateMachineInLoggingIn();
      const browser = createMockBrowserDriver();
      const callbacks = createMockCallbacks(null);

      const handler = new MfaHandler(sm, browser, callbacks, 3, 60_000);
      await handler.handleMfaFlow(smsChallenge);

      expect(browser.submitMfaResponse).not.toHaveBeenCalled();
    });
  });

  // ─── MFA Retry Flow ──────────────────────────────────────────────

  describe('MFA retry flow', () => {
    it('should handle retry when bank returns new challenge', async () => {
      const secondChallenge: MfaChallenge = {
        challengeId: 'c2',
        type: 'sms_code',
        maskedPhoneNumber: '***1234',
      };

      const sm = createStateMachineInLoggingIn();
      const browser = createMockBrowserDriver(
        jest.fn()
          .mockResolvedValueOnce({
            outcome: 'mfa_required',
            challenge: secondChallenge,
          } as MfaSubmitResult)
          .mockResolvedValueOnce({
            outcome: 'success',
            sessionToken: 'tok_retry',
          } as MfaSubmitResult),
      );

      const onMfaRequired = jest.fn()
        .mockResolvedValueOnce({
          challengeId: 'c1',
          type: 'sms_code',
          code: 'wrong',
        } as MfaResponse)
        .mockResolvedValueOnce({
          challengeId: 'c2',
          type: 'sms_code',
          code: '123456',
        } as MfaResponse);

      const callbacks: AuthCallbacks = {
        onStateChange: jest.fn(),
        onMfaRequired,
      };

      const handler = new MfaHandler(sm, browser, callbacks, 3, 60_000);
      const result = await handler.handleMfaFlow(smsChallenge);

      expect(result.outcome).toBe('success');
      expect(onMfaRequired).toHaveBeenCalledTimes(2);
      expect(browser.submitMfaResponse).toHaveBeenCalledTimes(2);
    });

    it('should fail after max retries', async () => {
      const makeChallenge = (id: number): MfaChallenge => ({
        challengeId: `c${id}`,
        type: 'sms_code',
        maskedPhoneNumber: '***1234',
      });

      const sm = createStateMachineInLoggingIn();
      const browser = createMockBrowserDriver(
        jest.fn()
          .mockResolvedValueOnce({ outcome: 'mfa_required', challenge: makeChallenge(2) })
          .mockResolvedValueOnce({ outcome: 'mfa_required', challenge: makeChallenge(3) }),
      );

      let callCount = 0;
      const onMfaRequired = jest.fn().mockImplementation((ch: MfaChallenge) => {
        callCount++;
        return Promise.resolve({
          challengeId: ch.challengeId,
          type: 'sms_code',
          code: `attempt_${callCount}`,
        } as MfaResponse);
      });

      const callbacks: AuthCallbacks = {
        onStateChange: jest.fn(),
        onMfaRequired,
      };

      const handler = new MfaHandler(sm, browser, callbacks, 2, 60_000);
      const result = await handler.handleMfaFlow(makeChallenge(1));

      expect(result.outcome).toBe('failed');
      if (result.outcome === 'failed') {
        expect(result.reason).toContain('MFA failed after 2 attempts');
      }
    });
  });

  // ─── MFA Failure Outcomes ────────────────────────────────────────

  describe('MFA failure outcomes', () => {
    it('should return failed when bank rejects MFA', async () => {
      const sm = createStateMachineInLoggingIn();
      const browser = createMockBrowserDriver(
        jest.fn().mockResolvedValue({
          outcome: 'failed',
          reason: 'Invalid code',
        } as MfaSubmitResult),
      );
      const callbacks = createMockCallbacks(smsResponse);

      const handler = new MfaHandler(sm, browser, callbacks, 3, 60_000);
      const result = await handler.handleMfaFlow(smsChallenge);

      expect(result.outcome).toBe('failed');
      if (result.outcome === 'failed') {
        expect(result.reason).toBe('Invalid code');
      }
    });

    it('should return locked when account gets locked during MFA', async () => {
      const retryAfter = new Date('2026-01-01T00:30:00Z');
      const sm = createStateMachineInLoggingIn();
      const browser = createMockBrowserDriver(
        jest.fn().mockResolvedValue({
          outcome: 'locked',
          reason: 'Too many attempts',
          retryAfter,
        } as MfaSubmitResult),
      );
      const callbacks = createMockCallbacks(smsResponse);

      const handler = new MfaHandler(sm, browser, callbacks, 3, 60_000);
      const result = await handler.handleMfaFlow(smsChallenge);

      expect(result.outcome).toBe('locked');
      if (result.outcome === 'locked') {
        expect(result.reason).toBe('Too many attempts');
        expect(result.retryAfter).toEqual(retryAfter);
      }
    });
  });

  // ─── MFA Response Validation ─────────────────────────────────────

  describe('MFA response validation', () => {
    it('should reject mismatched challengeId', async () => {
      const sm = createStateMachineInLoggingIn();
      const browser = createMockBrowserDriver();
      const callbacks: AuthCallbacks = {
        onStateChange: jest.fn(),
        onMfaRequired: jest.fn().mockResolvedValue({
          challengeId: 'wrong_id',
          type: 'sms_code',
          code: '123456',
        } as MfaResponse),
      };

      const handler = new MfaHandler(sm, browser, callbacks, 3, 60_000);

      try {
        await handler.handleMfaFlow(smsChallenge);
        fail('Should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(ConduitAuthError);
        expect((e as ConduitAuthError).message).toContain('does not match');
        expect((e as ConduitAuthError).code).toBe('MFA_MISMATCH');
      }
    });

    it('should reject empty code', async () => {
      const sm = createStateMachineInLoggingIn();
      const browser = createMockBrowserDriver();
      const callbacks: AuthCallbacks = {
        onStateChange: jest.fn(),
        onMfaRequired: jest.fn().mockResolvedValue({
          challengeId: 'c1',
          type: 'sms_code',
          code: '',
        } as MfaResponse),
      };

      const handler = new MfaHandler(sm, browser, callbacks, 3, 60_000);

      try {
        await handler.handleMfaFlow(smsChallenge);
        fail('Should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(ConduitAuthError);
        expect((e as ConduitAuthError).message).toContain('MFA code must be non-empty');
      }
    });
  });

  // ─── MFA Timeout ─────────────────────────────────────────────────

  describe('MFA timeout', () => {
    it('should timeout if host app does not respond', async () => {
      const sm = createStateMachineInLoggingIn();
      const browser = createMockBrowserDriver();
      const callbacks: AuthCallbacks = {
        onStateChange: jest.fn(),
        onMfaRequired: jest.fn().mockImplementation(
          () => new Promise((resolve) => setTimeout(() => resolve(smsResponse), 500)),
        ),
      };

      const handler = new MfaHandler(sm, browser, callbacks, 3, 50); // 50ms timeout

      try {
        await handler.handleMfaFlow(smsChallenge);
        fail('Should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(ConduitAuthError);
        expect((e as ConduitAuthError).message).toContain('timed out');
        expect((e as ConduitAuthError).code).toBe('MFA_TIMEOUT');
      }
    }, 10000);
  });

  // ─── Different MFA Challenge Types ───────────────────────────────

  describe('different MFA challenge types', () => {
    it('should handle email code challenge', async () => {
      const emailChallenge: MfaChallenge = {
        challengeId: 'email1',
        type: 'email_code',
        maskedEmail: 'u***@example.com',
      };

      const sm = createStateMachineInLoggingIn();
      const browser = createMockBrowserDriver();
      const callbacks: AuthCallbacks = {
        onStateChange: jest.fn(),
        onMfaRequired: jest.fn().mockResolvedValue({
          challengeId: 'email1',
          type: 'email_code',
          code: '654321',
        } as MfaResponse),
      };

      const handler = new MfaHandler(sm, browser, callbacks, 3, 60_000);
      const result = await handler.handleMfaFlow(emailChallenge);

      expect(result.outcome).toBe('success');
    });

    it('should handle security questions challenge', async () => {
      const sqChallenge: MfaChallenge = {
        challengeId: 'sq1',
        type: 'security_questions',
        questions: ['What city?', 'What pet?'],
      };

      const sm = createStateMachineInLoggingIn();
      const browser = createMockBrowserDriver();
      const callbacks: AuthCallbacks = {
        onStateChange: jest.fn(),
        onMfaRequired: jest.fn().mockResolvedValue({
          challengeId: 'sq1',
          type: 'security_questions',
          answers: ['NYC', 'Fluffy'],
        } as MfaResponse),
      };

      const handler = new MfaHandler(sm, browser, callbacks, 3, 60_000);
      const result = await handler.handleMfaFlow(sqChallenge);

      expect(result.outcome).toBe('success');
    });

    it('should handle push notification challenge', async () => {
      const pushChallenge: MfaChallenge = {
        challengeId: 'push1',
        type: 'push_notification',
        deviceHint: 'iPhone 15',
      };

      const sm = createStateMachineInLoggingIn();
      const browser = createMockBrowserDriver();
      const callbacks: AuthCallbacks = {
        onStateChange: jest.fn(),
        onMfaRequired: jest.fn().mockResolvedValue({
          challengeId: 'push1',
          type: 'push_notification',
          approved: true,
        } as MfaResponse),
      };

      const handler = new MfaHandler(sm, browser, callbacks, 3, 60_000);
      const result = await handler.handleMfaFlow(pushChallenge);

      expect(result.outcome).toBe('success');
    });
  });
});
