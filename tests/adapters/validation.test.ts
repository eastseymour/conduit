/**
 * Tests for adapter validation utilities.
 */

import {
  validateBankAdapterConfig,
  assertValidBankAdapterConfig,
} from '../../src/adapters/validation';
import type { BankAdapterConfig } from '../../src/adapters/types';

function makeValidConfig(overrides: Partial<BankAdapterConfig> = {}): BankAdapterConfig {
  return {
    bankId: 'test_bank',
    name: 'Test Bank',
    loginUrl: 'https://test.bank.com/login',
    selectors: {
      login: {
        usernameInput: '#user',
        passwordInput: '#pass',
        submitButton: '#submit',
      },
      mfa: {},
    },
    extractors: {},
    mfaDetector: {
      rules: [{ selector: '#otp', challengeType: 'sms_code' }],
    },
    ...overrides,
  } as BankAdapterConfig;
}

describe('validateBankAdapterConfig', () => {
  describe('valid configs', () => {
    it('accepts a minimal valid config', () => {
      const result = validateBankAdapterConfig(makeValidConfig());
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('accepts a full config with all optional fields', () => {
      const config = makeValidConfig({
        logoUrl: 'https://test.bank.com/logo.png',
        selectors: {
          login: {
            usernameInput: '#user',
            passwordInput: '#pass',
            submitButton: '#submit',
            rememberMeCheckbox: '#remember',
            errorMessage: '.error',
          },
          mfa: {
            codeInput: '#code',
            submitButton: '#mfa-submit',
          },
          accountPage: {
            accountsList: '.accounts',
            accountItem: '.account',
            accountName: '.name',
            accountBalance: '.balance',
          },
          transactionTable: {
            transactionsList: '.transactions',
            transactionRow: '.tx-row',
            transactionDate: '.date',
            transactionDescription: '.desc',
            transactionAmount: '.amount',
          },
        },
        extractors: {
          accounts: {
            readySelector: '.accounts',
            fields: [
              {
                fieldName: 'name',
                selector: '.name',
                strategy: { type: 'textContent' },
                required: true,
              },
            ],
          },
        },
      });
      const result = validateBankAdapterConfig(config);
      expect(result.valid).toBe(true);
    });
  });

  describe('bankId validation', () => {
    it('rejects empty bankId', () => {
      const result = validateBankAdapterConfig(makeValidConfig({ bankId: '' }));
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(expect.stringContaining('bankId'));
    });

    it('rejects bankId with uppercase', () => {
      const result = validateBankAdapterConfig(makeValidConfig({ bankId: 'TestBank' }));
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(expect.stringContaining('bankId'));
    });

    it('rejects bankId starting with number', () => {
      const result = validateBankAdapterConfig(makeValidConfig({ bankId: '1bank' }));
      expect(result.valid).toBe(false);
    });

    it('rejects bankId with spaces', () => {
      const result = validateBankAdapterConfig(makeValidConfig({ bankId: 'test bank' }));
      expect(result.valid).toBe(false);
    });

    it('accepts bankId with underscores', () => {
      const result = validateBankAdapterConfig(makeValidConfig({ bankId: 'test_bank_123' }));
      expect(result.valid).toBe(true);
    });
  });

  describe('name validation', () => {
    it('rejects empty name', () => {
      const result = validateBankAdapterConfig(makeValidConfig({ name: '' }));
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(expect.stringContaining('name'));
    });

    it('rejects whitespace-only name', () => {
      const result = validateBankAdapterConfig(makeValidConfig({ name: '   ' }));
      expect(result.valid).toBe(false);
    });
  });

  describe('loginUrl validation', () => {
    it('rejects empty loginUrl', () => {
      const result = validateBankAdapterConfig(makeValidConfig({ loginUrl: '' }));
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(expect.stringContaining('loginUrl'));
    });

    it('rejects invalid URL', () => {
      const result = validateBankAdapterConfig(makeValidConfig({ loginUrl: 'not-a-url' }));
      expect(result.valid).toBe(false);
    });

    it('accepts http URL', () => {
      const result = validateBankAdapterConfig(
        makeValidConfig({ loginUrl: 'http://test.com/login' }),
      );
      expect(result.valid).toBe(true);
    });

    it('accepts https URL', () => {
      const result = validateBankAdapterConfig(
        makeValidConfig({ loginUrl: 'https://test.com/login' }),
      );
      expect(result.valid).toBe(true);
    });
  });

  describe('login selectors validation', () => {
    it('rejects empty usernameInput', () => {
      const result = validateBankAdapterConfig(
        makeValidConfig({
          selectors: {
            login: { usernameInput: '', passwordInput: '#pass', submitButton: '#submit' },
            mfa: {},
          },
        }),
      );
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(expect.stringContaining('usernameInput'));
    });

    it('rejects empty passwordInput', () => {
      const result = validateBankAdapterConfig(
        makeValidConfig({
          selectors: {
            login: { usernameInput: '#user', passwordInput: '', submitButton: '#submit' },
            mfa: {},
          },
        }),
      );
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(expect.stringContaining('passwordInput'));
    });

    it('rejects empty submitButton', () => {
      const result = validateBankAdapterConfig(
        makeValidConfig({
          selectors: {
            login: { usernameInput: '#user', passwordInput: '#pass', submitButton: '' },
            mfa: {},
          },
        }),
      );
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(expect.stringContaining('submitButton'));
    });
  });

  describe('MFA detector validation', () => {
    it('rejects empty rules array', () => {
      const result = validateBankAdapterConfig(
        makeValidConfig({
          mfaDetector: { rules: [] },
        }),
      );
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(expect.stringContaining('at least one'));
    });

    it('rejects rule with empty selector', () => {
      const result = validateBankAdapterConfig(
        makeValidConfig({
          mfaDetector: {
            rules: [{ selector: '', challengeType: 'sms_code' }],
          },
        }),
      );
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(expect.stringContaining('selector'));
    });

    it('rejects negative priority', () => {
      const result = validateBankAdapterConfig(
        makeValidConfig({
          mfaDetector: {
            rules: [{ selector: '#otp', challengeType: 'sms_code', priority: -1 }],
          },
        }),
      );
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(expect.stringContaining('priority'));
    });

    it('rejects negative detectionTimeoutMs', () => {
      const result = validateBankAdapterConfig(
        makeValidConfig({
          mfaDetector: {
            rules: [{ selector: '#otp', challengeType: 'sms_code' }],
            detectionTimeoutMs: -100,
          },
        }),
      );
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(expect.stringContaining('detectionTimeoutMs'));
    });

    it('warns about duplicate selectors', () => {
      const result = validateBankAdapterConfig(
        makeValidConfig({
          mfaDetector: {
            rules: [
              { selector: '#otp', challengeType: 'sms_code' },
              { selector: '#otp', challengeType: 'email_code' },
            ],
          },
        }),
      );
      expect(result.valid).toBe(true); // Warnings don't fail
      expect(result.warnings).toContainEqual(expect.stringContaining('duplicated'));
    });
  });

  describe('extractor validation', () => {
    it('rejects empty readySelector in extractors', () => {
      const result = validateBankAdapterConfig(
        makeValidConfig({
          extractors: {
            accounts: {
              readySelector: '',
              fields: [
                {
                  fieldName: 'name',
                  selector: '.name',
                  strategy: { type: 'textContent' },
                  required: true,
                },
              ],
            },
          },
        }),
      );
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(expect.stringContaining('readySelector'));
    });

    it('rejects invalid regex pattern', () => {
      const result = validateBankAdapterConfig(
        makeValidConfig({
          extractors: {
            accounts: {
              readySelector: '.accounts',
              fields: [
                {
                  fieldName: 'balance',
                  selector: '.balance',
                  strategy: { type: 'regex', pattern: '[invalid(' },
                  required: true,
                },
              ],
            },
          },
        }),
      );
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(expect.stringContaining('regex'));
    });

    it('rejects attribute strategy with empty attributeName', () => {
      const result = validateBankAdapterConfig(
        makeValidConfig({
          extractors: {
            accounts: {
              readySelector: '.accounts',
              fields: [
                {
                  fieldName: 'link',
                  selector: 'a',
                  strategy: { type: 'attribute', attributeName: '' },
                  required: true,
                },
              ],
            },
          },
        }),
      );
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(expect.stringContaining('attributeName'));
    });

    it('warns about empty fields array', () => {
      const result = validateBankAdapterConfig(
        makeValidConfig({
          extractors: {
            accounts: {
              readySelector: '.accounts',
              fields: [],
            },
          },
        }),
      );
      expect(result.valid).toBe(true);
      expect(result.warnings).toContainEqual(expect.stringContaining('empty'));
    });

    it('warns about duplicate fieldNames', () => {
      const result = validateBankAdapterConfig(
        makeValidConfig({
          extractors: {
            accounts: {
              readySelector: '.accounts',
              fields: [
                {
                  fieldName: 'name',
                  selector: '.name1',
                  strategy: { type: 'textContent' },
                  required: true,
                },
                {
                  fieldName: 'name',
                  selector: '.name2',
                  strategy: { type: 'textContent' },
                  required: true,
                },
              ],
            },
          },
        }),
      );
      expect(result.valid).toBe(true);
      expect(result.warnings).toContainEqual(expect.stringContaining('duplicated'));
    });

    it('rejects negative readyTimeoutMs', () => {
      const result = validateBankAdapterConfig(
        makeValidConfig({
          extractors: {
            accounts: {
              readySelector: '.accounts',
              readyTimeoutMs: -5000,
              fields: [],
            },
          },
        }),
      );
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(expect.stringContaining('readyTimeoutMs'));
    });
  });

  describe('logoUrl validation', () => {
    it('warns about invalid logoUrl', () => {
      const result = validateBankAdapterConfig(makeValidConfig({ logoUrl: 'not-a-url' }));
      expect(result.valid).toBe(true); // Warnings don't fail
      expect(result.warnings).toContainEqual(expect.stringContaining('logoUrl'));
    });
  });
});

describe('assertValidBankAdapterConfig', () => {
  it('does not throw for valid config', () => {
    expect(() => assertValidBankAdapterConfig(makeValidConfig())).not.toThrow();
  });

  it('throws for invalid config with descriptive message', () => {
    expect(() => assertValidBankAdapterConfig(makeValidConfig({ bankId: '' }))).toThrow(
      /Invalid bank adapter config/,
    );
  });
});
