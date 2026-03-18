/**
 * Bank Adapter Registry — Central lookup for all registered bank adapters.
 *
 * Invariants:
 * 1. No two adapters may share the same bankId — enforced at registration time
 * 2. All registered adapters must pass validation — enforced at registration time
 * 3. Lookup by bankId returns undefined (not an error) for unknown banks
 * 4. Search results are sorted alphabetically by bank name
 */

import type {
  BankAdapterConfig,
  BankAdapterSummary,
  AdapterSearchOptions,
} from './types';
import { validateBankAdapterConfig } from './validation';

/**
 * Error thrown when adapter registration fails.
 */
export class AdapterRegistrationError extends Error {
  public readonly bankId: string;
  public readonly validationErrors: readonly string[];

  constructor(bankId: string, errors: readonly string[]) {
    super(`Failed to register adapter "${bankId}": ${errors.join('; ')}`);
    this.name = 'AdapterRegistrationError';
    this.bankId = bankId;
    this.validationErrors = errors;
    Object.setPrototypeOf(this, AdapterRegistrationError.prototype);
  }
}

/**
 * Central registry for bank adapter configurations.
 */
export class BankAdapterRegistry {
  private readonly adapters: Map<string, BankAdapterConfig> = new Map();

  /**
   * Register a bank adapter configuration.
   * @throws AdapterRegistrationError if validation fails or bankId is duplicate
   */
  register(config: BankAdapterConfig): void {
    const validation = validateBankAdapterConfig(config);
    if (!validation.valid) {
      throw new AdapterRegistrationError(config.bankId, validation.errors);
    }

    if (this.adapters.has(config.bankId)) {
      throw new AdapterRegistrationError(config.bankId, [
        `Adapter with bankId "${config.bankId}" is already registered`,
      ]);
    }

    this.adapters.set(config.bankId, config);
  }

  /** Look up an adapter by bankId. */
  get(bankId: string): BankAdapterConfig | undefined {
    return this.adapters.get(bankId);
  }

  /** Check if an adapter is registered for the given bankId. */
  has(bankId: string): boolean {
    return this.adapters.has(bankId);
  }

  /**
   * List all registered adapters as summaries (for UI display).
   * Results are sorted alphabetically by bank name.
   */
  list(): readonly BankAdapterSummary[] {
    return this.getSortedSummaries();
  }

  /**
   * Search for adapters matching the given criteria.
   * Results are sorted alphabetically by bank name.
   */
  search(options: AdapterSearchOptions = {}): readonly BankAdapterSummary[] {
    let summaries = this.getSortedSummaries();

    if (options.query && options.query.trim().length > 0) {
      const query = options.query.toLowerCase().trim();
      summaries = summaries.filter(
        (s) => s.name.toLowerCase().includes(query) || s.bankId.toLowerCase().includes(query),
      );
    }

    if (options.requireAccounts) {
      summaries = summaries.filter((s) => s.supportsAccounts);
    }

    if (options.requireTransactions) {
      summaries = summaries.filter((s) => s.supportsTransactions);
    }

    return summaries;
  }

  /** Get the total number of registered adapters. */
  get size(): number {
    return this.adapters.size;
  }

  /** Get all registered bankIds. */
  getBankIds(): readonly string[] {
    return Array.from(this.adapters.keys());
  }

  /** Remove all registered adapters. Primarily for testing. */
  clear(): void {
    this.adapters.clear();
  }

  private getSortedSummaries(): BankAdapterSummary[] {
    return Array.from(this.adapters.values())
      .map((config): BankAdapterSummary => ({
        bankId: config.bankId,
        name: config.name,
        logoUrl: config.logoUrl,
        supportsAccounts: config.extractors.accounts !== undefined,
        supportsTransactions: config.extractors.transactions !== undefined,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }
}

/**
 * Create a pre-populated registry with the built-in bank adapters.
 */
export function createDefaultRegistry(): BankAdapterRegistry {
  const { chaseAdapter } = require('./banks/chase') as { chaseAdapter: BankAdapterConfig };
  const { bankOfAmericaAdapter } = require('./banks/bank-of-america') as { bankOfAmericaAdapter: BankAdapterConfig };
  const { wellsFargoAdapter } = require('./banks/wells-fargo') as { wellsFargoAdapter: BankAdapterConfig };

  const registry = new BankAdapterRegistry();
  registry.register(chaseAdapter);
  registry.register(bankOfAmericaAdapter);
  registry.register(wellsFargoAdapter);
  return registry;
}
