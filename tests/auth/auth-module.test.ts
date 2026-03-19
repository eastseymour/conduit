import { AuthModule } from '../../src/auth/auth-module';
import {
  AuthCallbacks,
  AuthEvent,
  MfaChallenge,
  MfaResponse,
  ConduitAuthError,
} from '../../src/auth/types';
import type { BrowserDriver, LoginSubmitResult, MfaSubmitResult } from '../../src/browser/types';

// ─── Mock Browser Driver ─────────────────────────────────────────────

function createMockBrowserDriver(overrides: Partial<BrowserDriver> = {}): BrowserDriver {
  return {
    navigateToLogin: jest.fn().mockResolvedValue(undefined),
    submitCredentials: jest.fn().mockResolvedValue({
      outcome: 'success',
      sessionToken: 'tok_default',
    } as LoginSubmitResult),
    submitMfaResponse: jest.fn().mockResolvedValue({
      outcome: 'success',
      sessionToken: 'tok_mfa',
    } as MfaSubmitResult),
    handleRememberDevice: jest.fn().mockResolvedValue(undefined),
    cleanup: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

// ─── Mock Callbacks ──────────────────────────────────────────────────

function createMockCallbacks(onMfaResponse: MfaResponse | null = null): {
  callbacks: AuthCallbacks;
  events: AuthEvent[];
} {
  const events: AuthEvent[] = [];
  return {
    events,
    callbacks: {
      onStateChange: jest.fn((event: AuthEvent) => events.push(event)),
      onMfaRequired: jest.fn().mockResolvedValue(onMfaResponse),
    },
  };
}

// ─── Tests ───────────────────────────────────────────────────────────

describe('AuthModule', () => {
  let authModule: AuthModule;

  beforeEach(() => {
    authModule = new AuthModule();
  });

  // ─── Successful Login (No MFA) ───────────────────────────────────

  describe('successful login without MFA', () => {
    it('should authenticate successfully', async () => {
      const browser = createMockBrowserDriver();
      const { callbacks, events: _events } = createMockCallbacks();

      const result = await authModule.authenticate(
        'chase',
        { username: 'user', password: 'pass' },
        browser,
        callbacks,
      );

      expect(result.status).toBe('success');
      if (result.status === 'success') {
        expect(result.sessionToken).toBe('tok_default');
        expect(result.rememberDevice).toBe(false);
      }
    });

    it('should emit correct state events', async () => {
      const browser = createMockBrowserDriver();
      const { callbacks, events } = createMockCallbacks();

      await authModule.authenticate(
        'chase',
        { username: 'user', password: 'pass' },
        browser,
        callbacks,
      );

      const stateSequence = events.map((e) => e.type);
      expect(stateSequence).toEqual(['logging_in', 'authenticated']);
    });

    it('should navigate to bank login page', async () => {
      const browser = createMockBrowserDriver();
      const { callbacks } = createMockCallbacks();

      await authModule.authenticate(
        'chase',
        { username: 'user', password: 'pass' },
        browser,
        callbacks,
      );

      expect(browser.navigateToLogin).toHaveBeenCalledWith('chase');
    });

    it('should submit credentials', async () => {
      const browser = createMockBrowserDriver();
      const { callbacks } = createMockCallbacks();

      await authModule.authenticate(
        'chase',
        { username: 'user', password: 'pass' },
        browser,
        callbacks,
      );

      expect(browser.submitCredentials).toHaveBeenCalledWith({
        username: 'user',
        password: 'pass',
      });
    });

    it('should handle remember device', async () => {
      const browser = createMockBrowserDriver();
      const { callbacks } = createMockCallbacks();

      const module = new AuthModule({ rememberDevice: true });
      await module.authenticate(
        'chase',
        { username: 'user', password: 'pass' },
        browser,
        callbacks,
      );

      expect(browser.handleRememberDevice).toHaveBeenCalledWith(true);
    });

    it('should clean up browser after success', async () => {
      const browser = createMockBrowserDriver();
      const { callbacks } = createMockCallbacks();

      await authModule.authenticate(
        'chase',
        { username: 'user', password: 'pass' },
        browser,
        callbacks,
      );

      expect(browser.cleanup).toHaveBeenCalled();
    });
  });

  // ─── Failed Login ──────────────────────────────────────────────────

  describe('failed login', () => {
    it('should return failed result on bad credentials', async () => {
      const browser = createMockBrowserDriver({
        submitCredentials: jest.fn().mockResolvedValue({
          outcome: 'failed',
          reason: 'Invalid username or password',
        } as LoginSubmitResult),
      });
      const { callbacks, events: _events } = createMockCallbacks();

      const result = await authModule.authenticate(
        'chase',
        { username: 'user', password: 'wrong' },
        browser,
        callbacks,
      );

      expect(result.status).toBe('failed');
      if (result.status === 'failed') {
        expect(result.reason).toBe('Invalid username or password');
      }
    });

    it('should emit logging_in then auth_failed events', async () => {
      const browser = createMockBrowserDriver({
        submitCredentials: jest.fn().mockResolvedValue({
          outcome: 'failed',
          reason: 'Bad creds',
        }),
      });
      const { callbacks, events } = createMockCallbacks();

      await authModule.authenticate(
        'chase',
        { username: 'user', password: 'wrong' },
        browser,
        callbacks,
      );

      const stateSequence = events.map((e) => e.type);
      expect(stateSequence).toEqual(['logging_in', 'auth_failed']);
    });

    it('should clean up browser after failure', async () => {
      const browser = createMockBrowserDriver({
        submitCredentials: jest.fn().mockResolvedValue({
          outcome: 'failed',
          reason: 'Bad creds',
        }),
      });
      const { callbacks } = createMockCallbacks();

      await authModule.authenticate(
        'chase',
        { username: 'user', password: 'wrong' },
        browser,
        callbacks,
      );

      expect(browser.cleanup).toHaveBeenCalled();
    });
  });

  // ─── Account Locked ────────────────────────────────────────────────

  describe('account locked', () => {
    it('should return locked result', async () => {
      const retryAfter = new Date('2026-01-01T00:30:00Z');
      const browser = createMockBrowserDriver({
        submitCredentials: jest.fn().mockResolvedValue({
          outcome: 'locked',
          reason: 'Too many failed attempts',
          retryAfter,
        } as LoginSubmitResult),
      });
      const { callbacks, events: _events } = createMockCallbacks();

      const result = await authModule.authenticate(
        'chase',
        { username: 'user', password: 'pass' },
        browser,
        callbacks,
      );

      expect(result.status).toBe('locked');
      if (result.status === 'locked') {
        expect(result.reason).toBe('Too many failed attempts');
        expect(result.retryAfter).toEqual(retryAfter);
      }
    });

    it('should emit auth_failed event for locked accounts', async () => {
      const browser = createMockBrowserDriver({
        submitCredentials: jest.fn().mockResolvedValue({
          outcome: 'locked',
          reason: 'Too many attempts',
        }),
      });
      const { callbacks, events } = createMockCallbacks();

      await authModule.authenticate(
        'chase',
        { username: 'user', password: 'pass' },
        browser,
        callbacks,
      );

      const failEvent = events.find((e) => e.type === 'auth_failed');
      expect(failEvent).toBeDefined();
      if (failEvent?.type === 'auth_failed') {
        expect(failEvent.isLocked).toBe(true);
      }
    });
  });

  // ─── MFA Flow ──────────────────────────────────────────────────────

  describe('MFA flow', () => {
    const smsChallenge: MfaChallenge = {
      challengeId: 'c1',
      type: 'sms_code',
      maskedPhoneNumber: '***1234',
    };

    it('should handle SMS MFA challenge and succeed', async () => {
      const browser = createMockBrowserDriver({
        submitCredentials: jest.fn().mockResolvedValue({
          outcome: 'mfa_required',
          challenge: smsChallenge,
        } as LoginSubmitResult),
        submitMfaResponse: jest.fn().mockResolvedValue({
          outcome: 'success',
          sessionToken: 'tok_after_mfa',
        } as MfaSubmitResult),
      });

      const mfaResponse: MfaResponse = {
        challengeId: 'c1',
        type: 'sms_code',
        code: '123456',
      };
      const { callbacks, events: _events } = createMockCallbacks(mfaResponse);

      const result = await authModule.authenticate(
        'chase',
        { username: 'user', password: 'pass' },
        browser,
        callbacks,
      );

      expect(result.status).toBe('success');
      if (result.status === 'success') {
        expect(result.sessionToken).toBe('tok_after_mfa');
      }
    });

    it('should emit correct event sequence for MFA flow', async () => {
      const browser = createMockBrowserDriver({
        submitCredentials: jest.fn().mockResolvedValue({
          outcome: 'mfa_required',
          challenge: smsChallenge,
        }),
        submitMfaResponse: jest.fn().mockResolvedValue({
          outcome: 'success',
          sessionToken: 'tok_mfa',
        }),
      });

      const mfaResponse: MfaResponse = {
        challengeId: 'c1',
        type: 'sms_code',
        code: '123456',
      };
      const { callbacks, events } = createMockCallbacks(mfaResponse);

      await authModule.authenticate(
        'chase',
        { username: 'user', password: 'pass' },
        browser,
        callbacks,
      );

      const stateSequence = events.map((e) => e.type);
      expect(stateSequence).toEqual([
        'logging_in',
        'mfa_required',
        'mfa_submitting',
        'authenticated',
      ]);
    });

    it('should surface MFA challenge to host app via callback', async () => {
      const browser = createMockBrowserDriver({
        submitCredentials: jest.fn().mockResolvedValue({
          outcome: 'mfa_required',
          challenge: smsChallenge,
        }),
        submitMfaResponse: jest.fn().mockResolvedValue({
          outcome: 'success',
          sessionToken: 'tok_mfa',
        }),
      });

      const mfaResponse: MfaResponse = {
        challengeId: 'c1',
        type: 'sms_code',
        code: '123456',
      };
      const { callbacks } = createMockCallbacks(mfaResponse);

      await authModule.authenticate(
        'chase',
        { username: 'user', password: 'pass' },
        browser,
        callbacks,
      );

      expect(callbacks.onMfaRequired).toHaveBeenCalledWith(smsChallenge);
    });

    it('should handle MFA cancellation by host app', async () => {
      const browser = createMockBrowserDriver({
        submitCredentials: jest.fn().mockResolvedValue({
          outcome: 'mfa_required',
          challenge: smsChallenge,
        }),
      });

      // Host app returns null to cancel
      const { callbacks, events: _events } = createMockCallbacks(null);

      const result = await authModule.authenticate(
        'chase',
        { username: 'user', password: 'pass' },
        browser,
        callbacks,
      );

      expect(result.status).toBe('failed');
      if (result.status === 'failed') {
        expect(result.reason).toBe('MFA cancelled by user');
      }
    });

    it('should handle email code MFA', async () => {
      const emailChallenge: MfaChallenge = {
        challengeId: 'c2',
        type: 'email_code',
        maskedEmail: 'u***@example.com',
      };

      const browser = createMockBrowserDriver({
        submitCredentials: jest.fn().mockResolvedValue({
          outcome: 'mfa_required',
          challenge: emailChallenge,
        }),
        submitMfaResponse: jest.fn().mockResolvedValue({
          outcome: 'success',
          sessionToken: 'tok_email',
        }),
      });

      const mfaResponse: MfaResponse = {
        challengeId: 'c2',
        type: 'email_code',
        code: '654321',
      };
      const { callbacks } = createMockCallbacks(mfaResponse);

      const result = await authModule.authenticate(
        'chase',
        { username: 'user', password: 'pass' },
        browser,
        callbacks,
      );

      expect(result.status).toBe('success');
    });

    it('should handle security questions MFA', async () => {
      const sqChallenge: MfaChallenge = {
        challengeId: 'c3',
        type: 'security_questions',
        questions: ['What is your pet name?'],
      };

      const browser = createMockBrowserDriver({
        submitCredentials: jest.fn().mockResolvedValue({
          outcome: 'mfa_required',
          challenge: sqChallenge,
        }),
        submitMfaResponse: jest.fn().mockResolvedValue({
          outcome: 'success',
          sessionToken: 'tok_sq',
        }),
      });

      const mfaResponse: MfaResponse = {
        challengeId: 'c3',
        type: 'security_questions',
        answers: ['Fluffy'],
      };
      const { callbacks } = createMockCallbacks(mfaResponse);

      const result = await authModule.authenticate(
        'chase',
        { username: 'user', password: 'pass' },
        browser,
        callbacks,
      );

      expect(result.status).toBe('success');
    });

    it('should handle push notification MFA', async () => {
      const pushChallenge: MfaChallenge = {
        challengeId: 'c4',
        type: 'push_notification',
        deviceHint: 'iPhone 15',
      };

      const browser = createMockBrowserDriver({
        submitCredentials: jest.fn().mockResolvedValue({
          outcome: 'mfa_required',
          challenge: pushChallenge,
        }),
        submitMfaResponse: jest.fn().mockResolvedValue({
          outcome: 'success',
          sessionToken: 'tok_push',
        }),
      });

      const mfaResponse: MfaResponse = {
        challengeId: 'c4',
        type: 'push_notification',
        approved: true,
      };
      const { callbacks } = createMockCallbacks(mfaResponse);

      const result = await authModule.authenticate(
        'chase',
        { username: 'user', password: 'pass' },
        browser,
        callbacks,
      );

      expect(result.status).toBe('success');
    });

    it('should handle MFA retry when bank requires new challenge', async () => {
      const firstChallenge: MfaChallenge = {
        challengeId: 'c1',
        type: 'sms_code',
        maskedPhoneNumber: '***1234',
      };
      const secondChallenge: MfaChallenge = {
        challengeId: 'c2',
        type: 'sms_code',
        maskedPhoneNumber: '***1234',
      };

      const browser = createMockBrowserDriver({
        submitCredentials: jest.fn().mockResolvedValue({
          outcome: 'mfa_required',
          challenge: firstChallenge,
        }),
        submitMfaResponse: jest
          .fn()
          .mockResolvedValueOnce({
            outcome: 'mfa_required',
            challenge: secondChallenge,
          } as MfaSubmitResult)
          .mockResolvedValueOnce({
            outcome: 'success',
            sessionToken: 'tok_retry',
          } as MfaSubmitResult),
      });

      const onMfaRequired = jest
        .fn()
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

      const events: AuthEvent[] = [];
      const callbacks: AuthCallbacks = {
        onStateChange: jest.fn((e) => events.push(e)),
        onMfaRequired,
      };

      const result = await authModule.authenticate(
        'chase',
        { username: 'user', password: 'pass' },
        browser,
        callbacks,
      );

      expect(result.status).toBe('success');
      expect(onMfaRequired).toHaveBeenCalledTimes(2);

      const stateSequence = events.map((e) => e.type);
      expect(stateSequence).toEqual([
        'logging_in',
        'mfa_required', // first challenge
        'mfa_submitting', // submitting first response
        'mfa_required', // second challenge (retry)
        'mfa_submitting', // submitting second response
        'authenticated',
      ]);
    });

    it('should fail after max MFA retries', async () => {
      const module = new AuthModule({ maxMfaRetries: 2 });

      const makeChallenge = (id: number): MfaChallenge => ({
        challengeId: `c${id}`,
        type: 'sms_code',
        maskedPhoneNumber: '***1234',
      });

      const browser = createMockBrowserDriver({
        submitCredentials: jest.fn().mockResolvedValue({
          outcome: 'mfa_required',
          challenge: makeChallenge(1),
        }),
        submitMfaResponse: jest
          .fn()
          .mockResolvedValueOnce({ outcome: 'mfa_required', challenge: makeChallenge(2) })
          .mockResolvedValueOnce({ outcome: 'mfa_required', challenge: makeChallenge(3) }),
      });

      let _callCount = 0;
      const onMfaRequired = jest.fn().mockImplementation((ch: MfaChallenge) => {
        _callCount++;
        return Promise.resolve({
          challengeId: ch.challengeId,
          type: 'sms_code',
          code: 'wrong',
        } as MfaResponse);
      });

      const events: AuthEvent[] = [];
      const callbacks: AuthCallbacks = {
        onStateChange: jest.fn((e) => events.push(e)),
        onMfaRequired,
      };

      const result = await module.authenticate(
        'chase',
        { username: 'user', password: 'pass' },
        browser,
        callbacks,
      );

      expect(result.status).toBe('failed');
      if (result.status === 'failed') {
        expect(result.reason).toContain('MFA failed after 2 attempts');
      }
    });

    it('should handle account locked during MFA', async () => {
      const browser = createMockBrowserDriver({
        submitCredentials: jest.fn().mockResolvedValue({
          outcome: 'mfa_required',
          challenge: smsChallenge,
        }),
        submitMfaResponse: jest.fn().mockResolvedValue({
          outcome: 'locked',
          reason: 'Account locked after too many MFA attempts',
        } as MfaSubmitResult),
      });

      const mfaResponse: MfaResponse = {
        challengeId: 'c1',
        type: 'sms_code',
        code: '123456',
      };
      const { callbacks } = createMockCallbacks(mfaResponse);

      const result = await authModule.authenticate(
        'chase',
        { username: 'user', password: 'pass' },
        browser,
        callbacks,
      );

      expect(result.status).toBe('locked');
    });
  });

  // ─── Input Validation ──────────────────────────────────────────────

  describe('input validation', () => {
    it('should throw for empty bank ID', async () => {
      const browser = createMockBrowserDriver();
      const { callbacks } = createMockCallbacks();

      await expect(
        authModule.authenticate('', { username: 'user', password: 'pass' }, browser, callbacks),
      ).rejects.toThrow(ConduitAuthError);
    });

    it('should throw for empty username', async () => {
      const browser = createMockBrowserDriver();
      const { callbacks } = createMockCallbacks();

      await expect(
        authModule.authenticate('chase', { username: '', password: 'pass' }, browser, callbacks),
      ).rejects.toThrow(ConduitAuthError);
    });

    it('should throw for empty password', async () => {
      const browser = createMockBrowserDriver();
      const { callbacks } = createMockCallbacks();

      await expect(
        authModule.authenticate('chase', { username: 'user', password: '' }, browser, callbacks),
      ).rejects.toThrow(ConduitAuthError);
    });
  });

  // ─── Concurrent Auth Flows ─────────────────────────────────────────

  describe('concurrent auth prevention', () => {
    it('should prevent concurrent auth flows', async () => {
      // Create a browser that takes a while to respond
      const browser = createMockBrowserDriver({
        submitCredentials: jest.fn().mockImplementation(
          () =>
            new Promise((resolve) =>
              setTimeout(
                () =>
                  resolve({
                    outcome: 'success',
                    sessionToken: 'tok',
                  }),
                100,
              ),
            ),
        ),
      });
      const { callbacks: cb1 } = createMockCallbacks();
      const { callbacks: cb2 } = createMockCallbacks();

      // Start first auth flow (don't await)
      const firstPromise = authModule.authenticate(
        'chase',
        { username: 'user', password: 'pass' },
        browser,
        cb1,
      );

      // Immediately try second auth flow
      await expect(
        authModule.authenticate('boa', { username: 'user2', password: 'pass2' }, browser, cb2),
      ).rejects.toThrow('already active');

      // Clean up first auth flow
      await firstPromise;
    });
  });

  // ─── Session State Tracking ────────────────────────────────────────

  describe('session tracking', () => {
    it('should report isActive correctly', async () => {
      expect(authModule.isActive).toBe(false);

      // After completion, should be inactive
      const browser = createMockBrowserDriver();
      const { callbacks } = createMockCallbacks();

      await authModule.authenticate(
        'chase',
        { username: 'user', password: 'pass' },
        browser,
        callbacks,
      );

      expect(authModule.isActive).toBe(false);
    });

    it('should have null session when not active', () => {
      expect(authModule.session).toBeNull();
    });
  });

  // ─── Timeout ───────────────────────────────────────────────────────

  describe('timeout', () => {
    it('should timeout if auth takes too long', async () => {
      const module = new AuthModule({ timeoutMs: 50 });
      const browser = createMockBrowserDriver({
        submitCredentials: jest.fn().mockImplementation(
          () =>
            new Promise((resolve) =>
              setTimeout(
                () =>
                  resolve({
                    outcome: 'success',
                    sessionToken: 'tok',
                  }),
                200,
              ),
            ),
        ),
      });
      const { callbacks } = createMockCallbacks();

      await expect(
        module.authenticate('chase', { username: 'user', password: 'pass' }, browser, callbacks),
      ).rejects.toThrow(ConduitAuthError);

      await expect(
        module.authenticate('chase', { username: 'user', password: 'pass' }, browser, callbacks),
      ).rejects.toThrow('timed out');
    }, 10000);
  });

  // ─── Browser Error Handling ────────────────────────────────────────

  describe('browser error handling', () => {
    it('should clean up browser even when it throws', async () => {
      const cleanup = jest.fn().mockResolvedValue(undefined);
      const browser = createMockBrowserDriver({
        navigateToLogin: jest.fn().mockRejectedValue(new Error('Navigation failed')),
        cleanup,
      });
      const { callbacks } = createMockCallbacks();

      await expect(
        authModule.authenticate(
          'chase',
          { username: 'user', password: 'pass' },
          browser,
          callbacks,
        ),
      ).rejects.toThrow('Navigation failed');

      expect(cleanup).toHaveBeenCalled();
    });
  });

  // ─── Cancel ────────────────────────────────────────────────────────

  describe('cancel', () => {
    it('should throw when no active flow to cancel', async () => {
      await expect(authModule.cancel()).rejects.toThrow('No active auth flow to cancel');
    });
  });

  // ─── Options ───────────────────────────────────────────────────────

  describe('options', () => {
    it('should use default options when none provided', () => {
      const module = new AuthModule();
      // Just verify it creates without error
      expect(module).toBeDefined();
    });

    it('should merge partial options with defaults', async () => {
      const module = new AuthModule({ rememberDevice: true });
      const browser = createMockBrowserDriver();
      const { callbacks } = createMockCallbacks();

      await module.authenticate(
        'chase',
        { username: 'user', password: 'pass' },
        browser,
        callbacks,
      );

      expect(browser.handleRememberDevice).toHaveBeenCalledWith(true);
    });
  });
});
