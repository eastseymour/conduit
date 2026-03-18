/**
 * Browser automation interface — abstracts the embedded browser.
 *
 * This is the port/adapter boundary. The auth module depends on this
 * interface, not on a concrete browser implementation.
 *
 * Concrete implementations (e.g., Puppeteer, Playwright, Expo WebView)
 * will implement this interface.
 */

import type {
  Credentials,
  MfaChallenge,
  MfaResponse,
} from '../auth/types';

/**
 * Result of submitting credentials to a bank login page.
 * Discriminated union: exactly one of success, mfa_required, failed, locked.
 */
export type LoginSubmitResult =
  | { readonly outcome: 'success'; readonly sessionToken: string }
  | { readonly outcome: 'mfa_required'; readonly challenge: MfaChallenge }
  | { readonly outcome: 'failed'; readonly reason: string }
  | { readonly outcome: 'locked'; readonly reason: string; readonly retryAfter?: Date };

/**
 * Result of submitting an MFA response.
 * Discriminated union: success, needs another MFA challenge, or failed.
 */
export type MfaSubmitResult =
  | { readonly outcome: 'success'; readonly sessionToken: string }
  | { readonly outcome: 'mfa_required'; readonly challenge: MfaChallenge }
  | { readonly outcome: 'failed'; readonly reason: string }
  | { readonly outcome: 'locked'; readonly reason: string; readonly retryAfter?: Date };

/**
 * Interface for browser automation drivers.
 *
 * Postconditions for each method:
 * - navigateToLogin: browser is on the bank's login page
 * - submitCredentials: credentials are filled and submitted, result indicates next step
 * - submitMfaResponse: MFA response is submitted, result indicates next step
 * - handleRememberDevice: "remember this device" is accepted or declined
 * - cleanup: all browser resources are released
 */
export interface BrowserDriver {
  /**
   * Navigate to the bank's login page.
   * @param bankId - Identifier for the bank (used to look up URL)
   */
  navigateToLogin(bankId: string): Promise<void>;

  /**
   * Fill in credentials and submit the login form.
   * @param credentials - Username and password
   * @returns Result indicating success, MFA required, failure, or locked
   */
  submitCredentials(credentials: Credentials): Promise<LoginSubmitResult>;

  /**
   * Submit an MFA response to the bank.
   * @param response - The MFA response from the host app
   * @returns Result indicating success, another MFA needed, failure, or locked
   */
  submitMfaResponse(response: MfaResponse): Promise<MfaSubmitResult>;

  /**
   * Handle the "remember this device" prompt if present.
   * @param remember - Whether to accept or decline
   */
  handleRememberDevice(remember: boolean): Promise<void>;

  /**
   * Clean up browser resources. Must be called when auth flow completes.
   */
  cleanup(): Promise<void>;
}
