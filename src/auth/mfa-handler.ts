/**
 * MfaHandler — manages the MFA challenge/response loop.
 *
 * Responsibilities:
 * 1. Surface MFA challenges to the host app via callbacks
 * 2. Accept MFA responses and validate them
 * 3. Submit MFA responses to the bank via browser driver
 * 4. Handle retry logic (up to maxRetries)
 * 5. Detect when MFA succeeds, fails, or when account gets locked
 *
 * Invariants:
 * - MFA retries never exceed maxRetries
 * - Every MFA response is validated before submission
 * - State machine transitions are always valid
 * - Null response from host app (cancellation) terminates the flow
 */

import { AuthStateMachine } from './auth-state-machine';
import type { BrowserDriver, MfaSubmitResult } from '../browser/types';
import { AuthCallbacks, MfaChallenge, ConduitAuthError, assertValidMfaResponse } from './types';

/**
 * Result of the MFA flow — discriminated union.
 */
export type MfaFlowResult =
  | { readonly outcome: 'success'; readonly sessionToken: string }
  | { readonly outcome: 'failed'; readonly reason: string }
  | { readonly outcome: 'locked'; readonly reason: string; readonly retryAfter?: Date };

export class MfaHandler {
  private readonly _stateMachine: AuthStateMachine;
  private readonly _browser: BrowserDriver;
  private readonly _callbacks: AuthCallbacks;
  private readonly _maxRetries: number;
  private readonly _mfaTimeoutMs: number;

  constructor(
    stateMachine: AuthStateMachine,
    browser: BrowserDriver,
    callbacks: AuthCallbacks,
    maxRetries: number,
    mfaTimeoutMs: number,
  ) {
    // Preconditions
    if (maxRetries < 1) {
      throw new ConduitAuthError('maxRetries must be at least 1', 'MFA_MAX_RETRIES');
    }

    this._stateMachine = stateMachine;
    this._browser = browser;
    this._callbacks = callbacks;
    this._maxRetries = maxRetries;
    this._mfaTimeoutMs = mfaTimeoutMs;
  }

  /**
   * Handle the complete MFA flow starting from an initial challenge.
   *
   * Precondition: state machine is in 'logging_in' or 'mfa_submitting' state
   * Postcondition: returns MfaFlowResult (success, failed, or locked)
   *
   * The loop structure:
   *   1. Transition to mfa_required, surface challenge to host
   *   2. Wait for host response (with timeout)
   *   3. Validate response, transition to mfa_submitting
   *   4. Submit to bank
   *   5. If bank returns another MFA challenge, loop (up to maxRetries)
   *   6. If bank returns success/failed/locked, return result
   */
  async handleMfaFlow(initialChallenge: MfaChallenge): Promise<MfaFlowResult> {
    let currentChallenge = initialChallenge;
    let retriesUsed = 0;

    while (retriesUsed < this._maxRetries) {
      // Step 1: Transition to mfa_required and surface challenge
      this._stateMachine.transition('mfa_required', {
        challenge: currentChallenge,
      });

      // Step 2: Wait for host app to respond
      const mfaResponse = await this._waitForMfaResponse(currentChallenge);

      // Null response means the host app cancelled
      if (mfaResponse === null) {
        return { outcome: 'failed', reason: 'MFA cancelled by user' };
      }

      // Step 3: Validate the response
      assertValidMfaResponse(mfaResponse, currentChallenge);

      // Step 4: Transition to mfa_submitting
      this._stateMachine.transition('mfa_submitting', {
        challengeType: currentChallenge.type,
      });

      // Step 5: Submit to bank
      const result: MfaSubmitResult = await this._browser.submitMfaResponse(mfaResponse);

      // Step 6: Handle result
      switch (result.outcome) {
        case 'success':
          return { outcome: 'success', sessionToken: result.sessionToken };

        case 'mfa_required':
          // Another MFA challenge — loop with the new challenge
          currentChallenge = result.challenge;
          retriesUsed += 1;
          break;

        case 'failed':
          return { outcome: 'failed', reason: result.reason };

        case 'locked':
          return { outcome: 'locked', reason: result.reason, retryAfter: result.retryAfter };
      }
    }

    // Exhausted all retries
    return {
      outcome: 'failed',
      reason: `MFA failed after ${this._maxRetries} attempts`,
    };
  }

  /**
   * Wait for the host app to respond to an MFA challenge.
   * Applies a timeout — if the host doesn't respond in time, throws.
   */
  private async _waitForMfaResponse(
    challenge: MfaChallenge,
  ): Promise<import('./types').MfaResponse | null> {
    return new Promise<import('./types').MfaResponse | null>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(
          new ConduitAuthError(
            `MFA response timed out after ${this._mfaTimeoutMs}ms`,
            'MFA_TIMEOUT',
          ),
        );
      }, this._mfaTimeoutMs);

      this._callbacks
        .onMfaRequired(challenge)
        .then((response) => {
          clearTimeout(timer);
          resolve(response);
        })
        .catch((error) => {
          clearTimeout(timer);
          reject(error);
        });
    });
  }
}
