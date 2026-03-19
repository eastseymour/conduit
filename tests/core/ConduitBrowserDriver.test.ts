/**
 * Tests for ConduitBrowserDriver — the concrete BrowserDriver implementation.
 */

import { ConduitBrowserDriver } from '../../src/core/ConduitBrowserDriver';
import type { ConduitBrowserDriverConfig } from '../../src/core/ConduitBrowserDriver';
import { BankAdapterRegistry } from '../../src/adapters/registry';
import { chaseAdapter } from '../../src/adapters/banks/chase';
import type { BrowserEngine, ScriptResult, NavigationResult, DOMExtractionResult } from '../../src/core/BrowserEngine';
import type { Credentials } from '../../src/auth/types';

// ─── Mock Factory ─────────────────────────────────────────────────

function createMockEngine(): jest.Mocked<Pick<
  BrowserEngine,
  'navigate' | 'waitForElement' | 'waitForPageReady' | 'waitForNavigation' |
  'injectJavaScript' | 'extractDOM' | 'getCookies'
>> & BrowserEngine {
  return {
    navigate: jest.fn<Promise<NavigationResult>, [string, number?]>().mockResolvedValue({
      success: true, url: 'https://example.com', statusCode: 200,
      redirectChain: [], durationMs: 100,
    }),
    waitForElement: jest.fn<Promise<boolean>, [string, number?, number?]>().mockResolvedValue(true),
    waitForPageReady: jest.fn<Promise<boolean>, [number?]>().mockResolvedValue(true),
    waitForNavigation: jest.fn<Promise<boolean>, [number?]>().mockResolvedValue(false),
    injectJavaScript: jest.fn<Promise<ScriptResult>, [string, number?]>().mockResolvedValue({
      success: true, result: JSON.stringify({ success: true }),
    }),
    extractDOM: jest.fn<Promise<DOMExtractionResult>, [string?, string?]>().mockResolvedValue({
      success: true, html: '', selector: '',
    }),
    getCookies: jest.fn().mockResolvedValue([]),
  } as unknown as jest.Mocked<Pick<
    BrowserEngine,
    'navigate' | 'waitForElement' | 'waitForPageReady' | 'waitForNavigation' |
    'injectJavaScript' | 'extractDOM' | 'getCookies'
  >> & BrowserEngine;
}

const FAST_CONFIG: ConduitBrowserDriverConfig = {
  formFillDelayMs: 0,
  postSubmitWaitMs: 0,
  outcomeDetectionTimeoutMs: 200,
  outcomeDetectionPollMs: 10,
  elementWaitTimeoutMs: 100,
};

const TEST_CREDENTIALS: Credentials = { username: 'testuser', password: 'testpass' };

// ─── Tests ────────────────────────────────────────────────────────

describe('ConduitBrowserDriver', () => {
  let engine: ReturnType<typeof createMockEngine>;
  let registry: BankAdapterRegistry;
  let driver: ConduitBrowserDriver;

  beforeEach(() => {
    engine = createMockEngine();
    registry = new BankAdapterRegistry();
    registry.register(chaseAdapter);
    driver = new ConduitBrowserDriver(engine, registry, FAST_CONFIG);
  });

  // ─── navigateToLogin ────────────────────────────────────────────

  describe('navigateToLogin', () => {
    it('navigates to the bank login URL and waits for form', async () => {
      await driver.navigateToLogin('chase');
      expect(engine.navigate).toHaveBeenCalledWith(chaseAdapter.loginUrl);
      expect(engine.waitForElement).toHaveBeenCalledWith(
        chaseAdapter.selectors.login.usernameInput,
        FAST_CONFIG.elementWaitTimeoutMs,
      );
      expect(driver.currentAdapter).toBe(chaseAdapter);
    });

    it('throws for unknown bankId', async () => {
      await expect(driver.navigateToLogin('unknown_bank')).rejects.toThrow(
        'No adapter registered for bank "unknown_bank"',
      );
    });

    it('throws when navigation fails', async () => {
      engine.navigate.mockResolvedValue({
        success: false, url: chaseAdapter.loginUrl, statusCode: null,
        redirectChain: [], durationMs: 100, error: 'Connection timeout',
      });
      await expect(driver.navigateToLogin('chase')).rejects.toThrow(
        'Failed to navigate',
      );
    });

    it('throws when login form does not appear', async () => {
      engine.waitForElement.mockResolvedValue(false);
      await expect(driver.navigateToLogin('chase')).rejects.toThrow(
        'Login form did not appear',
      );
    });
  });

  // ─── submitCredentials ──────────────────────────────────────────

  describe('submitCredentials', () => {
    beforeEach(async () => {
      await driver.navigateToLogin('chase');
      // Reset mocks after navigateToLogin calls
      engine.waitForElement.mockReset().mockResolvedValue(false);
      engine.injectJavaScript.mockReset().mockResolvedValue({
        success: true, result: JSON.stringify({ success: true }),
      });
    });

    it('returns success when success indicator is found', async () => {
      // Make successIndicator match
      engine.waitForElement.mockImplementation(async (selector: string) => {
        if (selector === chaseAdapter.mfaDetector.successIndicator) return true;
        return false;
      });
      engine.getCookies.mockResolvedValue([
        { name: 'session_id', value: 'abc', domain: 'chase.com', path: '/' },
      ]);

      const result = await driver.submitCredentials(TEST_CREDENTIALS);
      expect(result.outcome).toBe('success');
      if (result.outcome === 'success') {
        expect(result.sessionToken).toContain('session_');
      }
    });

    it('returns mfa_required when MFA rule selector matches', async () => {
      // Match the first MFA rule (SMS OTP)
      const smsRule = chaseAdapter.mfaDetector.rules[0]!;
      engine.waitForElement.mockImplementation(async (selector: string) => {
        if (selector === smsRule.selector) return true;
        return false;
      });

      const result = await driver.submitCredentials(TEST_CREDENTIALS);
      expect(result.outcome).toBe('mfa_required');
      if (result.outcome === 'mfa_required') {
        expect(result.challenge.type).toBe(smsRule.challengeType);
        expect(result.challenge.challengeId).toBeDefined();
      }
    });

    it('returns failed when error message is found', async () => {
      const failureIndicator = chaseAdapter.mfaDetector.failureIndicator;
      engine.waitForElement.mockImplementation(async (selector: string) => {
        if (selector === failureIndicator) return true;
        return false;
      });
      engine.extractDOM.mockResolvedValue({
        success: true, html: '<div>Invalid username or password</div>',
      });

      const result = await driver.submitCredentials(TEST_CREDENTIALS);
      expect(result.outcome).toBe('failed');
      if (result.outcome === 'failed') {
        expect(result.reason).toContain('Invalid username or password');
      }
    });

    it('returns locked when error message contains "locked"', async () => {
      const failureIndicator = chaseAdapter.mfaDetector.failureIndicator;
      engine.waitForElement.mockImplementation(async (selector: string) => {
        if (selector === failureIndicator) return true;
        return false;
      });
      engine.extractDOM.mockResolvedValue({
        success: true, html: '<div>Your account has been locked</div>',
      });

      const result = await driver.submitCredentials(TEST_CREDENTIALS);
      expect(result.outcome).toBe('locked');
    });

    it('returns failed when form fill fails', async () => {
      engine.injectJavaScript.mockResolvedValue({
        success: false, error: 'Element not found',
      });

      const result = await driver.submitCredentials(TEST_CREDENTIALS);
      expect(result.outcome).toBe('failed');
      if (result.outcome === 'failed') {
        expect(result.reason).toContain('Could not fill username');
      }
    });

    it('fills username then password then clicks submit', async () => {
      // Let it timeout (no indicators match) so we can inspect call order
      const result = await driver.submitCredentials(TEST_CREDENTIALS);

      // Should have at least 3 injectJavaScript calls: fill username, fill password, click submit
      expect(engine.injectJavaScript.mock.calls.length).toBeGreaterThanOrEqual(3);

      // First call should reference the username selector
      const firstCall = engine.injectJavaScript.mock.calls[0]![0] as string;
      expect(firstCall).toContain(chaseAdapter.selectors.login.usernameInput);

      // Second call should reference the password selector
      const secondCall = engine.injectJavaScript.mock.calls[1]![0] as string;
      expect(secondCall).toContain(chaseAdapter.selectors.login.passwordInput);

      // Third call should reference the submit button
      const thirdCall = engine.injectJavaScript.mock.calls[2]![0] as string;
      expect(thirdCall).toContain(chaseAdapter.selectors.login.submitButton);
    });
  });

  // ─── submitMfaResponse ──────────────────────────────────────────

  describe('submitMfaResponse', () => {
    beforeEach(async () => {
      await driver.navigateToLogin('chase');
      engine.waitForElement.mockReset().mockResolvedValue(false);
      engine.injectJavaScript.mockReset().mockResolvedValue({
        success: true, result: JSON.stringify({ success: true }),
      });
    });

    it('fills SMS code input and detects success', async () => {
      // After MFA submit, success indicator found
      const successIndicator = chaseAdapter.mfaDetector.successIndicator;
      engine.waitForElement.mockImplementation(async (selector: string) => {
        if (selector === successIndicator) return true;
        if (selector === chaseAdapter.selectors.mfa.codeInput) return true;
        return false;
      });

      const result = await driver.submitMfaResponse({
        challengeId: 'test_challenge',
        type: 'sms_code',
        code: '123456',
      });

      expect(result.outcome).toBe('success');
      // Should have filled the code input
      const fillCalls = engine.injectJavaScript.mock.calls.filter(
        (call) => (call[0] as string).includes('123456'),
      );
      expect(fillCalls.length).toBeGreaterThanOrEqual(1);
    });

    it('handles security questions', async () => {
      const successIndicator = chaseAdapter.mfaDetector.successIndicator;
      engine.waitForElement.mockImplementation(async (selector: string) => {
        if (selector === successIndicator) return true;
        if (selector === chaseAdapter.selectors.mfa.securityQuestionInput) return true;
        return false;
      });

      const result = await driver.submitMfaResponse({
        challengeId: 'test_challenge',
        type: 'security_questions',
        answers: ['MyPetName'],
      });

      expect(result.outcome).toBe('success');
    });

    it('handles push notification (no form fill, just waits)', async () => {
      const successIndicator = chaseAdapter.mfaDetector.successIndicator;
      engine.waitForElement.mockImplementation(async (selector: string) => {
        if (selector === successIndicator) return true;
        return false;
      });

      const result = await driver.submitMfaResponse({
        challengeId: 'test_challenge',
        type: 'push_notification',
        approved: true,
      });

      expect(result.outcome).toBe('success');
    });
  });

  // ─── handleRememberDevice ───────────────────────────────────────

  describe('handleRememberDevice', () => {
    beforeEach(async () => {
      await driver.navigateToLogin('chase');
      engine.waitForElement.mockReset();
      engine.injectJavaScript.mockReset().mockResolvedValue({ success: true });
    });

    it('clicks checkbox when found and remember=true', async () => {
      engine.waitForElement.mockResolvedValue(true);
      await driver.handleRememberDevice(true);
      expect(engine.injectJavaScript).toHaveBeenCalled();
      const script = engine.injectJavaScript.mock.calls[0]![0] as string;
      expect(script).toContain('true');
    });

    it('clicks checkbox when found and remember=false', async () => {
      engine.waitForElement.mockResolvedValue(true);
      await driver.handleRememberDevice(false);
      const script = engine.injectJavaScript.mock.calls[0]![0] as string;
      expect(script).toContain('false');
    });

    it('does nothing when checkbox not found', async () => {
      engine.waitForElement.mockResolvedValue(false);
      await driver.handleRememberDevice(true);
      expect(engine.injectJavaScript).not.toHaveBeenCalled();
    });
  });

  // ─── cleanup ────────────────────────────────────────────────────

  describe('cleanup', () => {
    it('resets current adapter to null', async () => {
      await driver.navigateToLogin('chase');
      expect(driver.currentAdapter).not.toBeNull();
      await driver.cleanup();
      expect(driver.currentAdapter).toBeNull();
    });
  });

  // ─── Error cases ────────────────────────────────────────────────

  describe('error cases', () => {
    it('throws when submitCredentials called before navigateToLogin', async () => {
      await expect(driver.submitCredentials(TEST_CREDENTIALS)).rejects.toThrow(
        'Cannot call submitCredentials before navigateToLogin',
      );
    });

    it('throws when submitMfaResponse called before navigateToLogin', async () => {
      await expect(
        driver.submitMfaResponse({
          challengeId: 'test', type: 'sms_code', code: '123',
        }),
      ).rejects.toThrow('Cannot call submitMfaResponse before navigateToLogin');
    });

    it('throws when handleRememberDevice called before navigateToLogin', async () => {
      await expect(driver.handleRememberDevice(true)).rejects.toThrow(
        'Cannot call handleRememberDevice before navigateToLogin',
      );
    });
  });
});
