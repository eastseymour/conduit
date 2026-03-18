/**
 * Tests for the bank adapter type system.
 *
 * Verifies that the type contracts compile correctly and that
 * runtime const objects have the expected values.
 */

import type {
  LoginSelectors,
  MfaSelectors,
  AccountPageSelectors,
  TransactionTableSelectors,
  BankSelectors,
  ExtractionStrategy,
  FieldExtractor,
  PageExtractorConfig,
  BankExtractors,
  MfaDetectionRule,
  MfaDetector,
  BankAdapterConfig,
  BankAdapterSummary,
  AdapterSearchOptions,
} from '../../src/adapters/types';

describe('Adapter Types', () => {
  describe('LoginSelectors', () => {
    it('requires username, password, submit', () => {
      const selectors: LoginSelectors = {
        usernameInput: '#user',
        passwordInput: '#pass',
        submitButton: '#submit',
      };
      expect(selectors.usernameInput).toBe('#user');
      expect(selectors.passwordInput).toBe('#pass');
      expect(selectors.submitButton).toBe('#submit');
    });

    it('allows optional rememberMe and errorMessage', () => {
      const selectors: LoginSelectors = {
        usernameInput: '#user',
        passwordInput: '#pass',
        submitButton: '#submit',
        rememberMeCheckbox: '#remember',
        errorMessage: '.error',
      };
      expect(selectors.rememberMeCheckbox).toBe('#remember');
      expect(selectors.errorMessage).toBe('.error');
    });
  });

  describe('MfaSelectors', () => {
    it('all fields are optional', () => {
      const selectors: MfaSelectors = {};
      expect(selectors.codeInput).toBeUndefined();
    });

    it('accepts all optional fields', () => {
      const selectors: MfaSelectors = {
        codeInput: '#code',
        submitButton: '#submit',
        securityQuestionText: '.question',
        securityQuestionInput: '#answer',
        resendCodeButton: '.resend',
        alternateMethodLink: '.alt',
        promptContainer: '.prompt',
      };
      expect(selectors.codeInput).toBe('#code');
    });
  });

  describe('ExtractionStrategy', () => {
    it('supports textContent strategy', () => {
      const s: ExtractionStrategy = { type: 'textContent' };
      expect(s.type).toBe('textContent');
    });

    it('supports attribute strategy with attributeName', () => {
      const s: ExtractionStrategy = { type: 'attribute', attributeName: 'href' };
      expect(s.type).toBe('attribute');
      expect(s.attributeName).toBe('href');
    });

    it('supports regex strategy with pattern and groupIndex', () => {
      const s: ExtractionStrategy = { type: 'regex', pattern: '\\d+', groupIndex: 1 };
      expect(s.type).toBe('regex');
      expect(s.pattern).toBe('\\d+');
      expect(s.groupIndex).toBe(1);
    });

    it('supports value strategy', () => {
      const s: ExtractionStrategy = { type: 'value' };
      expect(s.type).toBe('value');
    });

    it('supports innerText strategy', () => {
      const s: ExtractionStrategy = { type: 'innerText' };
      expect(s.type).toBe('innerText');
    });
  });

  describe('FieldExtractor', () => {
    it('constructs with all required fields', () => {
      const extractor: FieldExtractor = {
        fieldName: 'balance',
        selector: '.balance',
        strategy: { type: 'textContent' },
        required: true,
      };
      expect(extractor.fieldName).toBe('balance');
      expect(extractor.required).toBe(true);
      expect(extractor.transform).toBeUndefined();
    });

    it('includes optional transform', () => {
      const extractor: FieldExtractor = {
        fieldName: 'amount',
        selector: '.amount',
        strategy: { type: 'textContent' },
        transform: 'parseAmount',
        required: true,
      };
      expect(extractor.transform).toBe('parseAmount');
    });
  });

  describe('MfaDetectionRule', () => {
    it('requires selector and challengeType', () => {
      const rule: MfaDetectionRule = {
        selector: '#otp-input',
        challengeType: 'sms_code',
      };
      expect(rule.selector).toBe('#otp-input');
      expect(rule.challengeType).toBe('sms_code');
    });

    it('allows optional contextSelector and priority', () => {
      const rule: MfaDetectionRule = {
        selector: '#otp-input',
        challengeType: 'sms_code',
        contextSelector: '.phone-mask',
        priority: 10,
      };
      expect(rule.contextSelector).toBe('.phone-mask');
      expect(rule.priority).toBe(10);
    });
  });

  describe('BankAdapterConfig', () => {
    it('constructs a minimal valid config', () => {
      const config: BankAdapterConfig = {
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
          rules: [
            { selector: '#otp', challengeType: 'sms_code' },
          ],
        },
      };
      expect(config.bankId).toBe('test_bank');
      expect(config.name).toBe('Test Bank');
      expect(config.logoUrl).toBeUndefined();
    });
  });

  describe('BankAdapterSummary', () => {
    it('contains display information', () => {
      const summary: BankAdapterSummary = {
        bankId: 'chase',
        name: 'Chase',
        logoUrl: 'https://chase.com/logo.png',
        supportsAccounts: true,
        supportsTransactions: true,
      };
      expect(summary.bankId).toBe('chase');
      expect(summary.supportsAccounts).toBe(true);
    });
  });

  describe('AdapterSearchOptions', () => {
    it('all fields are optional', () => {
      const options: AdapterSearchOptions = {};
      expect(options.query).toBeUndefined();
    });

    it('accepts all optional fields', () => {
      const options: AdapterSearchOptions = {
        query: 'chase',
        requireAccounts: true,
        requireTransactions: false,
      };
      expect(options.query).toBe('chase');
    });
  });
});
