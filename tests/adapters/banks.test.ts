/**
 * Tests for built-in bank adapter configurations.
 * Verifies that Chase, Bank of America, and Wells Fargo adapters
 * are well-formed and pass validation.
 */

import { chaseAdapter } from '../../src/adapters/banks/chase';
import { bankOfAmericaAdapter } from '../../src/adapters/banks/bank-of-america';
import { wellsFargoAdapter } from '../../src/adapters/banks/wells-fargo';
import { validateBankAdapterConfig } from '../../src/adapters/validation';
import type { BankAdapterConfig } from '../../src/adapters/types';

const allAdapters: [string, BankAdapterConfig][] = [
  ['Chase', chaseAdapter],
  ['Bank of America', bankOfAmericaAdapter],
  ['Wells Fargo', wellsFargoAdapter],
];

describe.each(allAdapters)('%s adapter', (bankName, adapter) => {
  it('passes validation', () => {
    const result = validateBankAdapterConfig(adapter);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('has a valid bankId', () => {
    expect(adapter.bankId).toMatch(/^[a-z][a-z0-9_]*$/);
  });

  it('has a non-empty name', () => {
    expect(adapter.name.trim().length).toBeGreaterThan(0);
  });

  it('has an https loginUrl', () => {
    expect(adapter.loginUrl).toMatch(/^https:\/\//);
  });

  it('has login selectors with all required fields', () => {
    expect(adapter.selectors.login.usernameInput.length).toBeGreaterThan(0);
    expect(adapter.selectors.login.passwordInput.length).toBeGreaterThan(0);
    expect(adapter.selectors.login.submitButton.length).toBeGreaterThan(0);
  });

  it('has at least one MFA detection rule', () => {
    expect(adapter.mfaDetector.rules.length).toBeGreaterThan(0);
  });

  it('has MFA rules with valid challenge types', () => {
    const validTypes = ['sms_code', 'email_code', 'security_questions', 'push_notification'];
    for (const rule of adapter.mfaDetector.rules) {
      expect(validTypes).toContain(rule.challengeType);
    }
  });

  it('has MFA rules sorted by priority', () => {
    const priorities = adapter.mfaDetector.rules
      .map((r) => r.priority ?? 100)
      .filter((p): p is number => p !== undefined);
    for (let i = 1; i < priorities.length; i++) {
      expect(priorities[i]).toBeGreaterThanOrEqual(priorities[i - 1]!);
    }
  });

  it('has MFA selectors defined', () => {
    expect(adapter.selectors.mfa).toBeDefined();
  });

  it('has a success indicator in MFA detector', () => {
    expect(adapter.mfaDetector.successIndicator).toBeDefined();
    expect(adapter.mfaDetector.successIndicator!.length).toBeGreaterThan(0);
  });

  it('has a failure indicator in MFA detector', () => {
    expect(adapter.mfaDetector.failureIndicator).toBeDefined();
    expect(adapter.mfaDetector.failureIndicator!.length).toBeGreaterThan(0);
  });

  it('has a detection timeout', () => {
    expect(adapter.mfaDetector.detectionTimeoutMs).toBeGreaterThan(0);
  });
});

describe('Chase adapter specifics', () => {
  it('has bankId "chase"', () => {
    expect(chaseAdapter.bankId).toBe('chase');
  });

  it('has account page selectors', () => {
    expect(chaseAdapter.selectors.accountPage).toBeDefined();
    expect(chaseAdapter.selectors.accountPage!.accountsList).toBeTruthy();
  });

  it('has transaction table selectors', () => {
    expect(chaseAdapter.selectors.transactionTable).toBeDefined();
  });

  it('has accounts extractor', () => {
    expect(chaseAdapter.extractors.accounts).toBeDefined();
    expect(chaseAdapter.extractors.accounts!.fields.length).toBeGreaterThan(0);
  });

  it('has transactions extractor', () => {
    expect(chaseAdapter.extractors.transactions).toBeDefined();
    expect(chaseAdapter.extractors.transactions!.fields.length).toBeGreaterThan(0);
  });

  it('has 4 MFA detection rules', () => {
    expect(chaseAdapter.mfaDetector.rules).toHaveLength(4);
  });
});

describe('Bank of America adapter specifics', () => {
  it('has bankId "bofa"', () => {
    expect(bankOfAmericaAdapter.bankId).toBe('bofa');
  });

  it('has account and transaction extractors', () => {
    expect(bankOfAmericaAdapter.extractors.accounts).toBeDefined();
    expect(bankOfAmericaAdapter.extractors.transactions).toBeDefined();
  });

  it('has transaction category field extractor', () => {
    const fields = bankOfAmericaAdapter.extractors.transactions!.fields;
    const categoryField = fields.find((f) => f.fieldName === 'category');
    expect(categoryField).toBeDefined();
    expect(categoryField!.required).toBe(false);
  });
});

describe('Wells Fargo adapter specifics', () => {
  it('has bankId "wells_fargo"', () => {
    expect(wellsFargoAdapter.bankId).toBe('wells_fargo');
  });

  it('has account details extractor (routing number)', () => {
    expect(wellsFargoAdapter.extractors.accountDetails).toBeDefined();
    const fields = wellsFargoAdapter.extractors.accountDetails!.fields;
    const routingField = fields.find((f) => f.fieldName === 'routingNumber');
    expect(routingField).toBeDefined();
    expect(routingField!.required).toBe(true);
  });

  it('has higher detection timeout than Chase', () => {
    expect(wellsFargoAdapter.mfaDetector.detectionTimeoutMs).toBeGreaterThan(
      chaseAdapter.mfaDetector.detectionTimeoutMs!,
    );
  });
});

describe('all adapters have unique bankIds', () => {
  it('no duplicate bankIds across adapters', () => {
    const bankIds = allAdapters.map(([_, adapter]) => adapter.bankId);
    const unique = new Set(bankIds);
    expect(unique.size).toBe(bankIds.length);
  });
});
