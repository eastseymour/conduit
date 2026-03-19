/**
 * Bank Adapter Framework — public API.
 *
 * This module provides the pluggable adapter system for different banks.
 * Each adapter defines CSS selectors for login fields, MFA prompts,
 * account pages, and transaction tables.
 */

// Types
export type {
  LoginSelectors,
  MfaSelectors,
  AccountPageSelectors,
  TransactionTableSelectors,
  BankSelectors,
  ExtractionStrategy,
  ExtractorTransform,
  FieldExtractor,
  PageExtractorConfig,
  BankExtractors,
  MfaDetectionRule,
  MfaDetector,
  BankAdapterConfig,
  BankAdapterSummary,
  AdapterSearchOptions,
} from './types';

// Registry
export { BankAdapterRegistry, AdapterRegistrationError, createDefaultRegistry } from './registry';

// Validation
export {
  validateBankAdapterConfig,
  assertValidBankAdapterConfig,
  type AdapterValidationResult,
} from './validation';

// Built-in adapters
export { chaseAdapter } from './banks/chase';
export { bankOfAmericaAdapter } from './banks/bank-of-america';
export { wellsFargoAdapter } from './banks/wells-fargo';
