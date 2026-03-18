/**
 * Tests for the BankSelectorController.
 */

import { BankSelectorController, type BankSelectorState } from '../../src/ui/BankSelector';
import { BankAdapterRegistry } from '../../src/adapters/registry';
import { createDefaultRegistry } from '../../src/adapters/registry';
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

describe('BankSelectorController', () => {
  let registry: BankAdapterRegistry;
  let controller: BankSelectorController;

  beforeEach(() => {
    registry = new BankAdapterRegistry();
    registry.register(makeValidConfig({ bankId: 'alpha_bank', name: 'Alpha Bank' }));
    registry.register(makeValidConfig({ bankId: 'beta_bank', name: 'Beta Bank' }));
    registry.register(makeValidConfig({ bankId: 'gamma_bank', name: 'Gamma Bank' }));
    controller = new BankSelectorController(registry);
  });

  afterEach(() => {
    controller.dispose();
  });

  describe('initial state', () => {
    it('has empty query', () => {
      expect(controller.getState().query).toBe('');
    });

    it('has all banks in allBanks and filteredBanks', () => {
      const state = controller.getState();
      expect(state.allBanks).toHaveLength(3);
      expect(state.filteredBanks).toHaveLength(3);
    });

    it('has no selected bank', () => {
      expect(controller.getState().selectedBank).toBeNull();
    });

    it('is not searching', () => {
      expect(controller.getState().isSearching).toBe(false);
    });

    it('banks are sorted alphabetically', () => {
      const names = controller.getState().allBanks.map((b) => b.name);
      expect(names).toEqual(['Alpha Bank', 'Beta Bank', 'Gamma Bank']);
    });
  });

  describe('subscribe', () => {
    it('emits current state immediately on subscribe', () => {
      const states: BankSelectorState[] = [];
      controller.subscribe((s) => states.push(s));
      expect(states).toHaveLength(1);
      expect(states[0]?.query).toBe('');
    });

    it('emits on subsequent state changes', () => {
      const states: BankSelectorState[] = [];
      controller.subscribe((s) => states.push(s));
      controller.setQuery('alpha');
      expect(states).toHaveLength(2);
    });

    it('returns unsubscribe function', () => {
      const states: BankSelectorState[] = [];
      const unsub = controller.subscribe((s) => states.push(s));
      unsub();
      controller.setQuery('alpha');
      expect(states).toHaveLength(1); // Only the initial emit
    });
  });

  describe('setQuery', () => {
    it('filters banks by name', () => {
      controller.setQuery('alpha');
      const state = controller.getState();
      expect(state.filteredBanks).toHaveLength(1);
      expect(state.filteredBanks[0]?.bankId).toBe('alpha_bank');
    });

    it('is case-insensitive', () => {
      controller.setQuery('BETA');
      expect(controller.getState().filteredBanks).toHaveLength(1);
    });

    it('matches bankId too', () => {
      controller.setQuery('gamma_bank');
      expect(controller.getState().filteredBanks).toHaveLength(1);
    });

    it('shows all banks for empty query', () => {
      controller.setQuery('alpha');
      controller.setQuery('');
      expect(controller.getState().filteredBanks).toHaveLength(3);
    });

    it('sets isSearching to true when query is non-empty', () => {
      controller.setQuery('alpha');
      expect(controller.getState().isSearching).toBe(true);
    });

    it('sets isSearching to false when query is cleared', () => {
      controller.setQuery('alpha');
      controller.setQuery('');
      expect(controller.getState().isSearching).toBe(false);
    });

    it('clears selection if selected bank is no longer visible', () => {
      controller.select('alpha_bank');
      expect(controller.getState().selectedBank?.bankId).toBe('alpha_bank');
      controller.setQuery('beta');
      expect(controller.getState().selectedBank).toBeNull();
    });

    it('preserves selection if selected bank is still visible', () => {
      controller.select('alpha_bank');
      controller.setQuery('alpha');
      expect(controller.getState().selectedBank?.bankId).toBe('alpha_bank');
    });

    it('trims whitespace from query', () => {
      controller.setQuery('  alpha  ');
      expect(controller.getState().query).toBe('alpha');
      expect(controller.getState().filteredBanks).toHaveLength(1);
    });

    it('does not emit if query is unchanged', () => {
      const states: BankSelectorState[] = [];
      controller.subscribe((s) => states.push(s));
      controller.setQuery('alpha');
      controller.setQuery('alpha'); // Same query again
      expect(states).toHaveLength(2); // Initial + first setQuery
    });
  });

  describe('select', () => {
    it('selects a bank from filtered results', () => {
      const result = controller.select('alpha_bank');
      expect(result).toBe(true);
      expect(controller.getState().selectedBank?.bankId).toBe('alpha_bank');
    });

    it('returns false for unknown bankId', () => {
      const result = controller.select('nonexistent');
      expect(result).toBe(false);
      expect(controller.getState().selectedBank).toBeNull();
    });

    it('returns false for bankId not in filtered results', () => {
      controller.setQuery('alpha');
      const result = controller.select('beta_bank');
      expect(result).toBe(false);
    });
  });

  describe('clearSelection', () => {
    it('clears the selected bank', () => {
      controller.select('alpha_bank');
      controller.clearSelection();
      expect(controller.getState().selectedBank).toBeNull();
    });

    it('is a no-op when no bank is selected', () => {
      const states: BankSelectorState[] = [];
      controller.subscribe((s) => states.push(s));
      controller.clearSelection();
      expect(states).toHaveLength(1); // Only initial
    });
  });

  describe('reset', () => {
    it('clears query, selection, and shows all banks', () => {
      controller.setQuery('alpha');
      controller.select('alpha_bank');
      controller.reset();

      const state = controller.getState();
      expect(state.query).toBe('');
      expect(state.selectedBank).toBeNull();
      expect(state.filteredBanks).toHaveLength(3);
      expect(state.isSearching).toBe(false);
    });
  });

  describe('dispose', () => {
    it('removes all listeners', () => {
      const states: BankSelectorState[] = [];
      controller.subscribe((s) => states.push(s));
      controller.dispose();
      controller.setQuery('alpha');
      expect(states).toHaveLength(1); // Only initial
    });
  });
});

describe('BankSelectorController with default registry', () => {
  it('works with the default registry (3 banks)', () => {
    const registry = createDefaultRegistry();
    const controller = new BankSelectorController(registry);

    const state = controller.getState();
    expect(state.allBanks).toHaveLength(3);

    // Should find "Chase" by query
    controller.setQuery('chase');
    expect(controller.getState().filteredBanks).toHaveLength(1);
    expect(controller.getState().filteredBanks[0]?.bankId).toBe('chase');

    controller.dispose();
  });
});
