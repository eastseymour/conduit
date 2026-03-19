/**
 * ConduitBrowserDriver — Concrete BrowserDriver implementation.
 *
 * Bridges the abstract BrowserDriver interface (used by AuthModule) to the
 * concrete BrowserEngine, using bank adapter configs (CSS selectors, MFA
 * detection rules) to automate login, MFA submission, and outcome detection.
 *
 * Invariants:
 * 1. navigateToLogin must be called before submitCredentials
 * 2. Form fill uses nativeInputValueSetter for React-controlled bank pages
 * 3. Outcome detection polls adapter selectors until timeout
 * 4. cleanup resets internal state but does NOT dispose the engine (caller owns it)
 */

import type { BrowserDriver, LoginSubmitResult, MfaSubmitResult } from '../browser/types';
import type { Credentials, MfaResponse, MfaChallenge, MfaChallengeType } from '../auth/types';
import type { BankAdapterConfig, MfaDetectionRule } from '../adapters/types';
import type { BankAdapterRegistry } from '../adapters/registry';
import type { BrowserEngine, ScriptResult } from './BrowserEngine';

// ─── Configuration ──────────────────────────────────────────────────

export interface ConduitBrowserDriverConfig {
  /** Delay in ms between filling form fields. Default: 150. */
  readonly formFillDelayMs?: number;
  /** Wait time in ms after clicking submit before detecting outcome. Default: 2000. */
  readonly postSubmitWaitMs?: number;
  /** Timeout in ms for polling MFA/success/failure indicators. Default: 15000. */
  readonly outcomeDetectionTimeoutMs?: number;
  /** Interval in ms between outcome detection polls. Default: 500. */
  readonly outcomeDetectionPollMs?: number;
  /** Timeout in ms for waiting for an element during form fill. Default: 10000. */
  readonly elementWaitTimeoutMs?: number;
}

const DEFAULT_DRIVER_CONFIG: Required<ConduitBrowserDriverConfig> = {
  formFillDelayMs: 150,
  postSubmitWaitMs: 2000,
  outcomeDetectionTimeoutMs: 15000,
  outcomeDetectionPollMs: 500,
  elementWaitTimeoutMs: 10000,
};

// ─── ConduitBrowserDriver ───────────────────────────────────────────

export class ConduitBrowserDriver implements BrowserDriver {
  private readonly _engine: BrowserEngine;
  private readonly _registry: BankAdapterRegistry;
  private readonly _config: Required<ConduitBrowserDriverConfig>;
  private _currentAdapter: BankAdapterConfig | null = null;

  constructor(
    engine: BrowserEngine,
    registry: BankAdapterRegistry,
    config: ConduitBrowserDriverConfig = {},
  ) {
    this._engine = engine;
    this._registry = registry;
    this._config = { ...DEFAULT_DRIVER_CONFIG, ...config };
  }

  /** The currently active bank adapter, if navigateToLogin has been called. */
  get currentAdapter(): BankAdapterConfig | null {
    return this._currentAdapter;
  }

  // ─── BrowserDriver Interface ────────────────────────────────────

  async navigateToLogin(bankId: string): Promise<void> {
    const adapter = this._registry.get(bankId);
    if (!adapter) {
      throw new Error(`No adapter registered for bank "${bankId}"`);
    }
    this._currentAdapter = adapter;

    const result = await this._engine.navigate(adapter.loginUrl);
    if (!result.success) {
      throw new Error(`Failed to navigate to ${adapter.loginUrl}: ${result.error ?? 'unknown'}`);
    }

    // Wait for login form to render (SPAs like Chase load the form asynchronously)
    const formReady = await this._engine.waitForElement(
      adapter.selectors.login.usernameInput,
      this._config.elementWaitTimeoutMs,
    );
    if (!formReady) {
      throw new Error(
        `Login form did not appear within ${this._config.elementWaitTimeoutMs}ms ` +
          `(looking for: ${adapter.selectors.login.usernameInput})`,
      );
    }
  }

  async submitCredentials(credentials: Credentials): Promise<LoginSubmitResult> {
    this._assertAdapterSet('submitCredentials');
    const adapter = this._currentAdapter!;
    const { login } = adapter.selectors;

    // Fill username
    const userResult = await this._fillInput(login.usernameInput, credentials.username);
    if (!userResult.success) {
      return { outcome: 'failed', reason: `Could not fill username: ${userResult.error}` };
    }

    await this._sleep(this._config.formFillDelayMs);

    // Fill password
    const passResult = await this._fillInput(login.passwordInput, credentials.password);
    if (!passResult.success) {
      return { outcome: 'failed', reason: `Could not fill password: ${passResult.error}` };
    }

    await this._sleep(this._config.formFillDelayMs);

    // Click submit
    const clickResult = await this._clickElement(login.submitButton);
    if (!clickResult.success) {
      return { outcome: 'failed', reason: `Could not click submit: ${clickResult.error}` };
    }

    // Wait for page to react (navigation, SPA update, etc.)
    await this._sleep(this._config.postSubmitWaitMs);

    // Check if a full navigation occurred (some banks redirect on login)
    const navigated = await this._engine.waitForNavigation(3000);
    if (navigated) {
      // Re-inject bridge if we navigated to a new page
      await this._engine.waitForPageReady(5000);
    }

    // Detect outcome
    return this._detectLoginOutcome();
  }

  async submitMfaResponse(response: MfaResponse): Promise<MfaSubmitResult> {
    this._assertAdapterSet('submitMfaResponse');
    const adapter = this._currentAdapter!;
    const { mfa } = adapter.selectors;

    switch (response.type) {
      case 'sms_code':
      case 'email_code': {
        if (!mfa.codeInput) {
          return { outcome: 'failed', reason: 'No MFA code input selector configured' };
        }

        // Wait for MFA code input to be present
        await this._engine.waitForElement(mfa.codeInput, this._config.elementWaitTimeoutMs);

        const fillResult = await this._fillInput(mfa.codeInput, response.code);
        if (!fillResult.success) {
          return { outcome: 'failed', reason: `Could not fill MFA code: ${fillResult.error}` };
        }

        await this._sleep(this._config.formFillDelayMs);

        if (mfa.submitButton) {
          const clickResult = await this._clickElement(mfa.submitButton);
          if (!clickResult.success) {
            return {
              outcome: 'failed',
              reason: `Could not click MFA submit: ${clickResult.error}`,
            };
          }
        }
        break;
      }

      case 'security_questions': {
        if (!mfa.securityQuestionInput) {
          return { outcome: 'failed', reason: 'No security question input selector configured' };
        }

        await this._engine.waitForElement(
          mfa.securityQuestionInput,
          this._config.elementWaitTimeoutMs,
        );

        const answer = response.answers[0] ?? '';
        const fillResult = await this._fillInput(mfa.securityQuestionInput, answer);
        if (!fillResult.success) {
          return { outcome: 'failed', reason: `Could not fill answer: ${fillResult.error}` };
        }

        await this._sleep(this._config.formFillDelayMs);

        if (mfa.submitButton) {
          await this._clickElement(mfa.submitButton);
        }
        break;
      }

      case 'push_notification': {
        // Push notifications are approved on-device; just wait for the bank to acknowledge
        break;
      }
    }

    // Wait for page reaction
    await this._sleep(this._config.postSubmitWaitMs);

    const navigated = await this._engine.waitForNavigation(3000);
    if (navigated) {
      await this._engine.waitForPageReady(5000);
    }

    // Detect outcome (same as post-credentials)
    return this._detectMfaOutcome();
  }

  async handleRememberDevice(remember: boolean): Promise<void> {
    this._assertAdapterSet('handleRememberDevice');
    const adapter = this._currentAdapter!;
    const checkboxSelector = adapter.selectors.login.rememberMeCheckbox;
    if (!checkboxSelector) return;

    // Try to find and set the checkbox; silently ignore if not found
    const found = await this._engine.waitForElement(checkboxSelector, 2000);
    if (!found) return;

    await this._engine.injectJavaScript(`(function() {
      var el = document.querySelector(${JSON.stringify(checkboxSelector)});
      if (!el) return;
      var shouldBeChecked = ${JSON.stringify(remember)};
      if (el.checked !== shouldBeChecked) { el.click(); }
    })()`);
  }

  async cleanup(): Promise<void> {
    this._currentAdapter = null;
  }

  // ─── Outcome Detection ──────────────────────────────────────────

  private async _detectLoginOutcome(): Promise<LoginSubmitResult> {
    const adapter = this._currentAdapter!;
    const detector = adapter.mfaDetector;
    const timeout = this._config.outcomeDetectionTimeoutMs;
    const poll = this._config.outcomeDetectionPollMs;
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      // 1. Check for success indicator
      if (detector.successIndicator) {
        const found = await this._engine.waitForElement(detector.successIndicator, poll);
        if (found) {
          const token = await this._extractSessionToken();
          return { outcome: 'success', sessionToken: token };
        }
      }

      // 2. Check for failure indicator
      if (detector.failureIndicator) {
        const found = await this._engine.waitForElement(detector.failureIndicator, poll);
        if (found) {
          const reason = await this._extractErrorMessage();
          return this._classifyFailure(reason);
        }
      }

      // 3. Check error message selector from login selectors
      if (adapter.selectors.login.errorMessage) {
        const found = await this._engine.waitForElement(adapter.selectors.login.errorMessage, 200);
        if (found) {
          const reason = await this._extractErrorMessage();
          return this._classifyFailure(reason);
        }
      }

      // 4. Check MFA rules (sorted by priority)
      const sortedRules = [...detector.rules].sort(
        (a, b) => (a.priority ?? 100) - (b.priority ?? 100),
      );
      for (const rule of sortedRules) {
        const found = await this._engine.waitForElement(rule.selector, 200);
        if (found) {
          const challenge = await this._buildMfaChallenge(rule);
          return { outcome: 'mfa_required', challenge };
        }
      }

      // 5. Check for account page (success without explicit indicator)
      if (adapter.selectors.accountPage?.accountsList) {
        const found = await this._engine.waitForElement(
          adapter.selectors.accountPage.accountsList,
          200,
        );
        if (found) {
          const token = await this._extractSessionToken();
          return { outcome: 'success', sessionToken: token };
        }
      }

      await this._sleep(poll);
    }

    // Timeout — couldn't determine outcome
    return {
      outcome: 'failed',
      reason: `Could not determine login outcome within ${timeout}ms`,
    };
  }

  private async _detectMfaOutcome(): Promise<MfaSubmitResult> {
    // Same detection logic applies after MFA submission
    const result = await this._detectLoginOutcome();
    return result;
  }

  // ─── MFA Challenge Construction ─────────────────────────────────

  private async _buildMfaChallenge(rule: MfaDetectionRule): Promise<MfaChallenge> {
    let contextText = '';
    if (rule.contextSelector) {
      const result = await this._engine.extractDOM(rule.contextSelector);
      if (result.success && result.html) {
        contextText = this._stripHtml(result.html).trim();
      }
    }

    const challengeId = `mfa_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;

    return this._buildChallengeForType(rule.challengeType, challengeId, contextText);
  }

  private _buildChallengeForType(
    type: MfaChallengeType,
    challengeId: string,
    context: string,
  ): MfaChallenge {
    switch (type) {
      case 'sms_code':
        return { challengeId, type: 'sms_code', maskedPhoneNumber: context || '***-****' };
      case 'email_code':
        return { challengeId, type: 'email_code', maskedEmail: context || '***@***.com' };
      case 'security_questions':
        return {
          challengeId,
          type: 'security_questions',
          questions: [context || 'Security question'],
        };
      case 'push_notification':
        return { challengeId, type: 'push_notification', deviceHint: context || 'your device' };
    }
  }

  // ─── Form Interaction Helpers ───────────────────────────────────

  /**
   * Fill an input field using the nativeInputValueSetter pattern.
   * This works on React/Angular-controlled inputs where setting .value
   * directly doesn't trigger change detection.
   */
  private async _fillInput(selector: string, value: string): Promise<ScriptResult> {
    return this._engine.injectJavaScript(`(function() {
      var el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return JSON.stringify({ success: false, error: 'Element not found: ${selector.replace(/'/g, "\\'")}' });

      // Focus the element first
      el.focus();

      // Use native setter to bypass React/Angular controlled input handling
      var nativeSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype, 'value'
      );
      if (nativeSetter && nativeSetter.set) {
        nativeSetter.set.call(el, ${JSON.stringify(value)});
      } else {
        el.value = ${JSON.stringify(value)};
      }

      // Dispatch events that frameworks listen for
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));

      return JSON.stringify({ success: true });
    })()`);
  }

  private async _clickElement(selector: string): Promise<ScriptResult> {
    return this._engine.injectJavaScript(`(function() {
      var el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return JSON.stringify({ success: false, error: 'Button not found: ${selector.replace(/'/g, "\\'")}' });
      el.click();
      return JSON.stringify({ success: true });
    })()`);
  }

  // ─── Extraction Helpers ─────────────────────────────────────────

  private async _extractSessionToken(): Promise<string> {
    try {
      const cookies = await this._engine.getCookies();
      const sessionCookies = cookies.filter(
        (c) =>
          c.name.toLowerCase().includes('session') ||
          c.name.toLowerCase().includes('token') ||
          c.name.toLowerCase().includes('auth') ||
          c.name.toLowerCase().includes('sid'),
      );
      if (sessionCookies.length > 0) {
        return `session_${Date.now()}_${sessionCookies.map((c) => c.name).join('_')}`;
      }
    } catch {
      /* cookie extraction is best-effort */
    }
    return `session_${Date.now()}`;
  }

  private async _extractErrorMessage(): Promise<string> {
    const adapter = this._currentAdapter!;
    const errorSelector = adapter.selectors.login.errorMessage;
    if (!errorSelector) return 'Login failed';

    try {
      const result = await this._engine.extractDOM(errorSelector);
      if (result.success && result.html) {
        const text = this._stripHtml(result.html).trim();
        return text || 'Login failed';
      }
    } catch {
      /* best-effort */
    }
    return 'Login failed';
  }

  private _classifyFailure(reason: string): LoginSubmitResult {
    const lower = reason.toLowerCase();
    const isLocked =
      lower.includes('locked') ||
      lower.includes('suspended') ||
      lower.includes('disabled') ||
      lower.includes('frozen');

    if (isLocked) {
      return { outcome: 'locked', reason };
    }
    return { outcome: 'failed', reason };
  }

  // ─── Utilities ──────────────────────────────────────────────────

  private _stripHtml(html: string): string {
    return html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ');
  }

  private _sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private _assertAdapterSet(operation: string): void {
    if (!this._currentAdapter) {
      throw new Error(
        `Cannot call ${operation} before navigateToLogin. ` +
          `Call navigateToLogin(bankId) first to set the active bank adapter.`,
      );
    }
  }
}
