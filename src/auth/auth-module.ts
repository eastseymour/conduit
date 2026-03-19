/**
 * AuthModule — orchestrates the complete bank authentication flow.
 *
 * Responsibilities:
 * 1. Accept credentials via SDK API
 * 2. Drive browser to navigate, fill, and submit login
 * 3. Detect and handle MFA challenges (delegated to MfaHandler)
 * 4. Surface MFA prompts to host app via callbacks
 * 5. Detect success/failure/locked outcomes
 * 6. Handle "remember this device" and session persistence
 * 7. Emit state events throughout the flow
 *
 * Invariants:
 * - Only one auth flow can be active per module instance at a time
 * - Credentials are never stored — only used transiently during login
 * - State transitions are enforced by AuthStateMachine
 * - All browser resources are cleaned up on completion (success or failure)
 */

import { AuthStateMachine } from './auth-state-machine';
import { MfaHandler } from './mfa-handler';
import type { BrowserDriver } from '../browser/types';
import {
  AuthCallbacks,
  AuthModuleOptions,
  AuthResult,
  AuthSession,
  Credentials,
  ConduitAuthError,
  DEFAULT_AUTH_OPTIONS,
  assertValidCredentials,
} from './types';

let sessionCounter = 0;

function generateSessionId(): string {
  sessionCounter += 1;
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 10);
  return `auth_${timestamp}_${random}_${sessionCounter}`;
}

export class AuthModule {
  private readonly _options: AuthModuleOptions;
  private _activeSession: AuthSession | null = null;
  private _stateMachine: AuthStateMachine | null = null;
  private _browserDriver: BrowserDriver | null = null;

  constructor(options: Partial<AuthModuleOptions> = {}) {
    this._options = { ...DEFAULT_AUTH_OPTIONS, ...options };
  }

  /**
   * Whether an auth flow is currently active.
   * Invariant: if active, _stateMachine and _activeSession are non-null.
   */
  get isActive(): boolean {
    return this._activeSession !== null;
  }

  /**
   * Current session, if any.
   */
  get session(): Readonly<AuthSession> | null {
    return this._activeSession ? { ...this._activeSession } : null;
  }

  /**
   * Start the authentication flow for a bank.
   *
   * Preconditions:
   * - No active auth flow (isActive === false)
   * - credentials.username and credentials.password are non-empty
   * - browserDriver is a valid BrowserDriver implementation
   * - callbacks implements AuthCallbacks
   *
   * Postconditions:
   * - Returns AuthResult indicating outcome
   * - Browser resources are cleaned up regardless of outcome
   * - Session state is updated to terminal state (authenticated or auth_failed)
   */
  async authenticate(
    bankId: string,
    credentials: Credentials,
    browserDriver: BrowserDriver,
    callbacks: AuthCallbacks,
  ): Promise<AuthResult> {
    // Invariant: only one auth flow at a time
    if (this._activeSession !== null) {
      throw new ConduitAuthError(
        'An authentication flow is already active. Complete or cancel it before starting a new one.',
        'INVALID_STATE_TRANSITION',
      );
    }

    // Validate inputs
    if (!bankId || bankId.trim().length === 0) {
      throw new ConduitAuthError('Bank ID must be non-empty', 'INVALID_CREDENTIALS');
    }
    assertValidCredentials(credentials);

    const sessionId = generateSessionId();
    this._stateMachine = new AuthStateMachine(sessionId);
    this._browserDriver = browserDriver;

    this._activeSession = {
      sessionId,
      bankId,
      startedAt: new Date(),
      state: 'idle',
    };

    // Wire up state change events to callbacks and session tracking
    this._stateMachine.onStateChange((event) => {
      if (this._activeSession) {
        this._activeSession.state = event.type;
      }
      callbacks.onStateChange(event);
    });

    try {
      const result = await this._executeAuthFlow(bankId, credentials, callbacks);
      return result;
    } finally {
      // Invariant: browser resources are always cleaned up
      await this._cleanup();
    }
  }

  /**
   * Cancel an active auth flow.
   *
   * Precondition: isActive === true
   * Postcondition: flow is terminated, state is auth_failed, resources cleaned up
   */
  async cancel(): Promise<void> {
    if (!this._activeSession || !this._stateMachine) {
      throw new ConduitAuthError('No active auth flow to cancel', 'INVALID_STATE_TRANSITION');
    }

    // Try to transition to auth_failed if possible
    if (this._stateMachine.canTransitionTo('auth_failed')) {
      this._stateMachine.transition('auth_failed', {
        reason: 'Cancelled by user',
        isLocked: false,
      });
    }

    await this._cleanup();
  }

  // ─── Private Implementation ──────────────────────────────────────

  private async _executeAuthFlow(
    bankId: string,
    credentials: Credentials,
    callbacks: AuthCallbacks,
  ): Promise<AuthResult> {
    const sm = this._stateMachine!;
    const browser = this._browserDriver!;

    // Wrap entire flow in a timeout
    return this._withTimeout(this._options.timeoutMs, 'AUTH_TIMEOUT', async () => {
      // Step 1: Navigate to bank login
      sm.transition('logging_in', { bankId });
      await browser.navigateToLogin(bankId);

      // Step 2: Submit credentials
      const loginResult = await browser.submitCredentials(credentials);

      // Step 3: Handle login result
      switch (loginResult.outcome) {
        case 'success':
          return this._handleSuccess(sm, browser, loginResult.sessionToken);

        case 'mfa_required':
          return this._handleMfaFlow(sm, browser, callbacks, loginResult.challenge);

        case 'failed':
          return this._handleFailure(sm, loginResult.reason);

        case 'locked':
          return this._handleLocked(sm, loginResult.reason, loginResult.retryAfter);
      }
    });
  }

  private async _handleSuccess(
    sm: AuthStateMachine,
    browser: BrowserDriver,
    sessionToken: string,
  ): Promise<AuthResult> {
    // Handle "remember this device" if configured
    await browser.handleRememberDevice(this._options.rememberDevice);

    sm.transition('authenticated', { sessionToken });

    const result: AuthResult = {
      status: 'success',
      sessionToken,
      rememberDevice: this._options.rememberDevice,
    };

    if (this._activeSession) {
      this._activeSession.result = result;
    }

    return result;
  }

  private async _handleMfaFlow(
    sm: AuthStateMachine,
    browser: BrowserDriver,
    callbacks: AuthCallbacks,
    initialChallenge: import('./types').MfaChallenge,
  ): Promise<AuthResult> {
    const mfaHandler = new MfaHandler(
      sm,
      browser,
      callbacks,
      this._options.maxMfaRetries,
      this._options.mfaTimeoutMs,
    );

    const mfaResult = await mfaHandler.handleMfaFlow(initialChallenge);

    switch (mfaResult.outcome) {
      case 'success':
        return this._handleSuccess(sm, browser, mfaResult.sessionToken);

      case 'failed':
        return this._handleFailure(sm, mfaResult.reason);

      case 'locked':
        return this._handleLocked(sm, mfaResult.reason, mfaResult.retryAfter);
    }
  }

  private _handleFailure(sm: AuthStateMachine, reason: string): AuthResult {
    sm.transition('auth_failed', { reason, isLocked: false });

    const result: AuthResult = { status: 'failed', reason };

    if (this._activeSession) {
      this._activeSession.result = result;
    }

    return result;
  }

  private _handleLocked(sm: AuthStateMachine, reason: string, retryAfter?: Date): AuthResult {
    sm.transition('auth_failed', { reason, isLocked: true });

    const result: AuthResult = { status: 'locked', reason, retryAfter };

    if (this._activeSession) {
      this._activeSession.result = result;
    }

    return result;
  }

  private async _withTimeout<T>(
    timeoutMs: number,
    errorCode: import('./types').ConduitAuthErrorCode,
    fn: () => Promise<T>,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new ConduitAuthError(`Operation timed out after ${timeoutMs}ms`, errorCode));
      }, timeoutMs);

      fn()
        .then((result) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch((error) => {
          clearTimeout(timer);
          reject(error);
        });
    });
  }

  private async _cleanup(): Promise<void> {
    try {
      if (this._browserDriver) {
        await this._browserDriver.cleanup();
      }
    } finally {
      this._browserDriver = null;
      this._activeSession = null;
      this._stateMachine = null;
    }
  }
}
