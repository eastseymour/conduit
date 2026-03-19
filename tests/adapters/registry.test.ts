/**
 * Tests for the BankAdapterRegistry.
 */

import {
  BankAdapterRegistry,
  AdapterRegistrationError,
  createDefaultRegistry,
} from '../../src/adapters/registry';
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

describe('BankAdapterRegistry', () => {
  let registry: BankAdapterRegistry;

  beforeEach(() => {
    registry = new BankAdapterRegistry();
  });

  describe('register', () => {
    it('registers a valid adapter', () => {
      registry.register(makeValidConfig());
      expect(registry.has('test_bank')).toBe(true);
      expect(registry.size).toBe(1);
    });

    it('throws AdapterRegistrationError for invalid config', () => {
      expect(() => registry.register(makeValidConfig({ bankId: '' }))).toThrow(
        AdapterRegistrationError,
      );
    });

    it('throws AdapterRegistrationError for duplicate bankId', () => {
      registry.register(makeValidConfig());
      expect(() => registry.register(makeValidConfig())).toThrow(AdapterRegistrationError);
    });

    it('error includes bankId and validation errors', () => {
      registry.register(makeValidConfig());
      try {
        registry.register(makeValidConfig());
        fail('Expected AdapterRegistrationError');
      } catch (err) {
        expect(err).toBeInstanceOf(AdapterRegistrationError);
        const regErr = err as AdapterRegistrationError;
        expect(regErr.bankId).toBe('test_bank');
        expect(regErr.validationErrors.length).toBeGreaterThan(0);
        expect(regErr.validationErrors[0]).toContain('already registered');
      }
    });
  });

  describe('get', () => {
    it('returns the adapter for a registered bankId', () => {
      const config = makeValidConfig();
      registry.register(config);
      const retrieved = registry.get('test_bank');
      expect(retrieved).toBeDefined();
      expect(retrieved?.bankId).toBe('test_bank');
    });

    it('returns undefined for unknown bankId', () => {
      expect(registry.get('nonexistent')).toBeUndefined();
    });
  });

  describe('has', () => {
    it('returns true for registered bankId', () => {
      registry.register(makeValidConfig());
      expect(registry.has('test_bank')).toBe(true);
    });

    it('returns false for unregistered bankId', () => {
      expect(registry.has('test_bank')).toBe(false);
    });
  });

  describe('list', () => {
    it('returns empty array for empty registry', () => {
      expect(registry.list()).toEqual([]);
    });

    it('returns summaries sorted alphabetically by name', () => {
      registry.register(makeValidConfig({ bankId: 'z_bank', name: 'Zeta Bank' }));
      registry.register(makeValidConfig({ bankId: 'a_bank', name: 'Alpha Bank' }));
      registry.register(makeValidConfig({ bankId: 'm_bank', name: 'Middle Bank' }));

      const list = registry.list();
      expect(list).toHaveLength(3);
      expect(list[0]?.name).toBe('Alpha Bank');
      expect(list[1]?.name).toBe('Middle Bank');
      expect(list[2]?.name).toBe('Zeta Bank');
    });

    it('includes correct capabilities in summaries', () => {
      registry.register(
        makeValidConfig({
          bankId: 'full_bank',
          name: 'Full Bank',
          extractors: {
            accounts: {
              readySelector: '.accounts',
              fields: [
                {
                  fieldName: 'n',
                  selector: '.n',
                  strategy: { type: 'textContent' },
                  required: true,
                },
              ],
            },
            transactions: {
              readySelector: '.tx',
              fields: [
                {
                  fieldName: 't',
                  selector: '.t',
                  strategy: { type: 'textContent' },
                  required: true,
                },
              ],
            },
          },
        }),
      );
      registry.register(
        makeValidConfig({
          bankId: 'basic_bank',
          name: 'Basic Bank',
          extractors: {},
        }),
      );

      const list = registry.list();
      const full = list.find((s) => s.bankId === 'full_bank');
      const basic = list.find((s) => s.bankId === 'basic_bank');

      expect(full?.supportsAccounts).toBe(true);
      expect(full?.supportsTransactions).toBe(true);
      expect(basic?.supportsAccounts).toBe(false);
      expect(basic?.supportsTransactions).toBe(false);
    });
  });

  describe('search', () => {
    beforeEach(() => {
      registry.register(makeValidConfig({ bankId: 'chase', name: 'Chase' }));
      registry.register(
        makeValidConfig({
          bankId: 'bofa',
          name: 'Bank of America',
          extractors: {
            accounts: {
              readySelector: '.accounts',
              fields: [
                {
                  fieldName: 'n',
                  selector: '.n',
                  strategy: { type: 'textContent' },
                  required: true,
                },
              ],
            },
          },
        }),
      );
      registry.register(makeValidConfig({ bankId: 'wells_fargo', name: 'Wells Fargo' }));
    });

    it('returns all banks when no options', () => {
      const results = registry.search();
      expect(results).toHaveLength(3);
    });

    it('filters by query (case-insensitive)', () => {
      const results = registry.search({ query: 'cha' });
      expect(results).toHaveLength(1);
      expect(results[0]?.bankId).toBe('chase');
    });

    it('matches bankId in query', () => {
      const results = registry.search({ query: 'bofa' });
      expect(results).toHaveLength(1);
      expect(results[0]?.bankId).toBe('bofa');
    });

    it('filters by requireAccounts', () => {
      const results = registry.search({ requireAccounts: true });
      expect(results).toHaveLength(1);
      expect(results[0]?.bankId).toBe('bofa');
    });

    it('returns empty for no matches', () => {
      const results = registry.search({ query: 'nonexistent' });
      expect(results).toHaveLength(0);
    });

    it('combines query and requireAccounts', () => {
      const results = registry.search({ query: 'bank', requireAccounts: true });
      expect(results).toHaveLength(1);
      expect(results[0]?.bankId).toBe('bofa');
    });

    it('handles empty query string', () => {
      const results = registry.search({ query: '' });
      expect(results).toHaveLength(3);
    });

    it('handles whitespace-only query', () => {
      const results = registry.search({ query: '   ' });
      expect(results).toHaveLength(3);
    });
  });

  describe('getBankIds', () => {
    it('returns all registered bankIds', () => {
      registry.register(makeValidConfig({ bankId: 'bank_a', name: 'Bank A' }));
      registry.register(makeValidConfig({ bankId: 'bank_b', name: 'Bank B' }));
      const ids = registry.getBankIds();
      expect(ids).toContain('bank_a');
      expect(ids).toContain('bank_b');
      expect(ids).toHaveLength(2);
    });
  });

  describe('clear', () => {
    it('removes all adapters', () => {
      registry.register(makeValidConfig());
      expect(registry.size).toBe(1);
      registry.clear();
      expect(registry.size).toBe(0);
      expect(registry.has('test_bank')).toBe(false);
    });
  });

  describe('size', () => {
    it('returns 0 for empty registry', () => {
      expect(registry.size).toBe(0);
    });

    it('increments as adapters are registered', () => {
      registry.register(makeValidConfig({ bankId: 'bank_a', name: 'A' }));
      expect(registry.size).toBe(1);
      registry.register(makeValidConfig({ bankId: 'bank_b', name: 'B' }));
      expect(registry.size).toBe(2);
    });
  });
});

describe('createDefaultRegistry', () => {
  it('creates a registry with 3 built-in adapters', () => {
    const registry = createDefaultRegistry();
    expect(registry.size).toBe(3);
  });

  it('includes Chase adapter', () => {
    const registry = createDefaultRegistry();
    expect(registry.has('chase')).toBe(true);
    const chase = registry.get('chase');
    expect(chase?.name).toBe('Chase');
  });

  it('includes Bank of America adapter', () => {
    const registry = createDefaultRegistry();
    expect(registry.has('bofa')).toBe(true);
    const bofa = registry.get('bofa');
    expect(bofa?.name).toBe('Bank of America');
  });

  it('includes Wells Fargo adapter', () => {
    const registry = createDefaultRegistry();
    expect(registry.has('wells_fargo')).toBe(true);
    const wf = registry.get('wells_fargo');
    expect(wf?.name).toBe('Wells Fargo');
  });

  it('all built-in adapters pass validation', () => {
    // This implicitly tests that registration succeeds, which requires validation
    const registry = createDefaultRegistry();
    const bankIds = registry.getBankIds();
    expect(bankIds).toHaveLength(3);
    for (const bankId of bankIds) {
      expect(registry.get(bankId)).toBeDefined();
    }
  });
});
