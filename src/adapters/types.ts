/**
 * Bank Adapter Framework — Pluggable Per-Bank Scripts (CDT-7)
 *
 * Defines the core interface for bank-specific automation adapters.
 * Each bank has unique login pages, MFA flows, and data layouts.
 * Adapters encapsulate all bank-specific CSS selectors, data extractors,
 * and MFA detection logic.
 *
 * Design: "Make illegal states unrepresentable"
 * - BankAdapterConfig uses readonly properties and required fields
 * - SelectorMap groups selectors by page/purpose — no dangling selectors
 * - MfaDetector is a structured set of checks, not a freeform callback
 * - ExtractorConfig uses typed extraction strategies
 *
 * Invariants:
 * 1. Every adapter must have a unique bankId (enforced by registry)
 * 2. Every adapter must define login selectors — cannot create an adapter without them
 * 3. Selectors are CSS selector strings — validated at registration time
 * 4. MFA detector must define at least one detection method
 * 5. Extractors are ordered arrays — extraction proceeds in order
 */

import type { MfaChallengeType } from '../auth/types';

// ─── CSS Selector Definitions ────────────────────────────────────────

/**
 * CSS selectors for the bank's login page.
 * All fields are required — every bank must have identifiable login fields.
 */
export interface LoginSelectors {
  /** CSS selector for the username/email input field */
  readonly usernameInput: string;
  /** CSS selector for the password input field */
  readonly passwordInput: string;
  /** CSS selector for the login submit button */
  readonly submitButton: string;
  /** CSS selector for the "remember me" checkbox, if present */
  readonly rememberMeCheckbox?: string;
  /** CSS selector for login error messages displayed on the page */
  readonly errorMessage?: string;
}

/**
 * CSS selectors for MFA/2FA challenge prompts.
 */
export interface MfaSelectors {
  /** CSS selector for the MFA code input field (SMS/email codes) */
  readonly codeInput?: string;
  /** CSS selector for the MFA submit button */
  readonly submitButton?: string;
  /** CSS selector for security question text elements */
  readonly securityQuestionText?: string;
  /** CSS selector for security question answer input */
  readonly securityQuestionInput?: string;
  /** CSS selector for "resend code" link/button */
  readonly resendCodeButton?: string;
  /** CSS selector for "try another method" link/button */
  readonly alternateMethodLink?: string;
  /** CSS selector for the MFA prompt container/wrapper */
  readonly promptContainer?: string;
}

/**
 * CSS selectors for the account summary/dashboard page.
 */
export interface AccountPageSelectors {
  /** CSS selector for the accounts list container */
  readonly accountsList: string;
  /** CSS selector for individual account rows/items */
  readonly accountItem: string;
  /** CSS selector for account name within an account item */
  readonly accountName: string;
  /** CSS selector for account number (may be masked) */
  readonly accountNumber?: string;
  /** CSS selector for account balance */
  readonly accountBalance: string;
  /** CSS selector for account type indicator */
  readonly accountType?: string;
}

/**
 * CSS selectors for the transaction history table/list.
 */
export interface TransactionTableSelectors {
  /** CSS selector for the transactions container */
  readonly transactionsList: string;
  /** CSS selector for individual transaction rows */
  readonly transactionRow: string;
  /** CSS selector for transaction date within a row */
  readonly transactionDate: string;
  /** CSS selector for transaction description/merchant */
  readonly transactionDescription: string;
  /** CSS selector for transaction amount */
  readonly transactionAmount: string;
  /** CSS selector for transaction status (pending/posted) */
  readonly transactionStatus?: string;
  /** CSS selector for transaction category */
  readonly transactionCategory?: string;
  /** CSS selector for "load more" / pagination button */
  readonly loadMoreButton?: string;
  /** CSS selector for date range picker or filter */
  readonly dateRangeFilter?: string;
}

/**
 * Complete set of CSS selectors for a bank adapter.
 * Groups all selectors by page/purpose.
 *
 * Invariant: login selectors are always required.
 */
export interface BankSelectors {
  /** Selectors for the login page (required) */
  readonly login: LoginSelectors;
  /** Selectors for MFA/2FA prompts */
  readonly mfa: MfaSelectors;
  /** Selectors for the account dashboard */
  readonly accountPage?: AccountPageSelectors;
  /** Selectors for transaction history */
  readonly transactionTable?: TransactionTableSelectors;
}

// ─── Extractor Definitions ───────────────────────────────────────────

/**
 * Strategy for extracting a value from a DOM element.
 * Discriminated union — each strategy extracts differently.
 */
export type ExtractionStrategy =
  | { readonly type: 'textContent' }
  | { readonly type: 'innerText' }
  | { readonly type: 'attribute'; readonly attributeName: string }
  | { readonly type: 'value' }
  | { readonly type: 'regex'; readonly pattern: string; readonly groupIndex?: number };

/**
 * Named transforms that can be applied to extracted values.
 */
export type ExtractorTransform =
  | 'trim'
  | 'parseAmount'
  | 'parseDate'
  | 'stripWhitespace'
  | 'maskAccountNumber'
  | 'uppercase'
  | 'lowercase';

/**
 * Defines how to extract a specific field from the page.
 */
export interface FieldExtractor {
  /** Name of the field being extracted (e.g., "accountName", "balance") */
  readonly fieldName: string;
  /** CSS selector to locate the element */
  readonly selector: string;
  /** How to extract the value from the element */
  readonly strategy: ExtractionStrategy;
  /** Optional transform to apply after extraction */
  readonly transform?: ExtractorTransform;
  /** Whether this field is required — extraction fails if required field is missing */
  readonly required: boolean;
}

/**
 * Configuration for extracting data from a specific page type.
 */
export interface PageExtractorConfig {
  /** Ordered list of field extractors — processed in sequence */
  readonly fields: readonly FieldExtractor[];
  /**
   * CSS selector that must be present before extraction starts.
   * Used to wait for the page to be ready.
   */
  readonly readySelector: string;
  /**
   * Maximum time in ms to wait for the ready selector.
   * Default: 10000
   */
  readonly readyTimeoutMs?: number;
}

/**
 * Complete extraction configuration for a bank adapter.
 */
export interface BankExtractors {
  /** How to extract account data from the accounts page */
  readonly accounts?: PageExtractorConfig;
  /** How to extract transaction data from the transactions page */
  readonly transactions?: PageExtractorConfig;
  /** How to extract account numbers (may require navigating to a different page) */
  readonly accountDetails?: PageExtractorConfig;
}

// ─── MFA Detection ───────────────────────────────────────────────────

/**
 * A single MFA detection rule.
 * When the specified selector is found on the page, the corresponding
 * MFA challenge type is triggered.
 */
export interface MfaDetectionRule {
  /** CSS selector that indicates this type of MFA is being requested */
  readonly selector: string;
  /** The type of MFA challenge this selector represents */
  readonly challengeType: MfaChallengeType;
  /** Optional additional selector to extract context (e.g., masked phone number) */
  readonly contextSelector?: string;
  /** Priority when multiple rules match (lower = higher priority). Default: 100 */
  readonly priority?: number;
}

/**
 * MFA detection configuration for a bank adapter.
 *
 * Invariant: at least one rule must be defined.
 */
export interface MfaDetector {
  /** Ordered list of detection rules (checked in priority order) */
  readonly rules: readonly MfaDetectionRule[];
  /** Max time in ms to wait for MFA prompt after login submission. Default: 5000 */
  readonly detectionTimeoutMs?: number;
  /** CSS selector that indicates successful login (no MFA needed) */
  readonly successIndicator?: string;
  /** CSS selector that indicates login failure */
  readonly failureIndicator?: string;
}

// ─── Bank Adapter Configuration ──────────────────────────────────────

/**
 * Complete configuration for a bank-specific adapter.
 *
 * This is the main interface that CDT-7 defines. Each bank implements
 * one of these configurations, which is then registered in the adapter
 * registry for lookup by bankId.
 *
 * Invariants:
 * 1. bankId is unique across all registered adapters
 * 2. name is human-readable and non-empty
 * 3. loginUrl is a valid URL
 * 4. selectors.login is fully populated (all required fields)
 * 5. mfaDetector.rules has at least one entry
 */
export interface BankAdapterConfig {
  /** Unique identifier for this bank (e.g., "chase", "bofa", "wells_fargo") */
  readonly bankId: string;
  /** Human-readable bank name (e.g., "Chase", "Bank of America") */
  readonly name: string;
  /** Bank's login page URL */
  readonly loginUrl: string;
  /** Optional bank logo URL for UI display */
  readonly logoUrl?: string;
  /** All CSS selectors organized by page type */
  readonly selectors: BankSelectors;
  /** Data extraction configuration */
  readonly extractors: BankExtractors;
  /** MFA detection configuration */
  readonly mfaDetector: MfaDetector;
}

// ─── Adapter Registry Types ──────────────────────────────────────────

/**
 * Summary information about a registered bank adapter.
 * Used for display in the bank selection UI.
 */
export interface BankAdapterSummary {
  /** Unique bank identifier */
  readonly bankId: string;
  /** Human-readable bank name */
  readonly name: string;
  /** Bank logo URL */
  readonly logoUrl?: string;
  /** Whether this adapter supports account extraction */
  readonly supportsAccounts: boolean;
  /** Whether this adapter supports transaction extraction */
  readonly supportsTransactions: boolean;
}

/**
 * Options for searching/filtering bank adapters.
 */
export interface AdapterSearchOptions {
  /** Text to search in bank name (case-insensitive) */
  readonly query?: string;
  /** Only return adapters that support account extraction */
  readonly requireAccounts?: boolean;
  /** Only return adapters that support transaction extraction */
  readonly requireTransactions?: boolean;
}
