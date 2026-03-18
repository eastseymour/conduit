/**
 * Core Conduit SDK Types
 *
 * Defines the foundational domain types for the banking data extraction SDK:
 * - Account: bank account representation
 * - Transaction: individual financial transaction
 * - BankAdapter: interface for bank-specific automation
 * - ConduitConfig: SDK configuration
 * - LinkSession: user-facing link flow session
 *
 * Design: "Make illegal states unrepresentable"
 * - Account types are an exhaustive enum — no freeform strings
 * - Transaction amounts use number (cents/minor units recommended by consumer)
 * - LinkSession uses a discriminated union for session state
 * - BankAdapter is a contract interface — adapters must satisfy all methods
 */

// ─── Account Types ───────────────────────────────────────────────────

/**
 * Exhaustive enumeration of supported account types.
 * Using a const object + type extraction pattern for runtime access + type safety.
 */
export const AccountType = {
  Checking: 'checking',
  Savings: 'savings',
  CreditCard: 'credit_card',
  Loan: 'loan',
  Investment: 'investment',
  Mortgage: 'mortgage',
  LineOfCredit: 'line_of_credit',
  Other: 'other',
} as const;

export type AccountTypeName = (typeof AccountType)[keyof typeof AccountType];

/**
 * Represents a bank account.
 *
 * Invariants:
 * - `id` is unique within a single bank adapter session
 * - `accountNumber` may be masked (e.g., "****1234") — never guaranteed to be full
 * - `routingNumber` is only present for US depository accounts
 * - `balance.current` reflects the most recently fetched value
 */
export interface Account {
  /** Unique identifier for this account within the adapter session */
  readonly id: string;

  /** Human-readable account name (e.g., "Personal Checking") */
  readonly name: string;

  /** Official account name from the bank, if different from `name` */
  readonly officialName?: string;

  /** Account type classification */
  readonly type: AccountTypeName;

  /** Account number — may be masked */
  readonly accountNumber: string;

  /** Routing number (US depository accounts only) */
  readonly routingNumber?: string;

  /** Balance information */
  readonly balance: AccountBalance;

  /** ISO 4217 currency code (e.g., "USD", "EUR") */
  readonly currency: string;

  /** Institution/bank identifier this account belongs to */
  readonly institutionId: string;
}

/**
 * Balance information for an account.
 *
 * Invariants:
 * - `current` is always present — it's the last known balance
 * - `available` may differ from `current` (e.g., pending transactions)
 * - `limit` only applies to credit/line-of-credit accounts
 */
export interface AccountBalance {
  /** Current balance as reported by the bank */
  readonly current: number;

  /** Available balance (after pending transactions), if reported */
  readonly available?: number;

  /** Credit limit (credit cards, lines of credit), if applicable */
  readonly limit?: number;
}

// ─── Transaction Types ───────────────────────────────────────────────

/**
 * Transaction status — pending transactions may be modified or reversed.
 */
export const TransactionStatus = {
  Pending: 'pending',
  Posted: 'posted',
} as const;

export type TransactionStatusName = (typeof TransactionStatus)[keyof typeof TransactionStatus];

/**
 * Represents a single financial transaction.
 *
 * Invariants:
 * - `id` is unique within a single account's transaction history
 * - `amount` is signed: negative = debit/outflow, positive = credit/inflow
 * - `date` is the transaction date (not the posting date)
 * - `status` distinguishes pending from settled transactions
 */
export interface Transaction {
  /** Unique identifier for this transaction */
  readonly id: string;

  /** Account this transaction belongs to */
  readonly accountId: string;

  /**
   * Transaction amount (signed).
   * - Negative: debit / money leaving account
   * - Positive: credit / money entering account
   */
  readonly amount: number;

  /** ISO 4217 currency code (e.g., "USD") */
  readonly currency: string;

  /** Transaction date (ISO 8601 string, e.g., "2024-01-15") */
  readonly date: string;

  /** Transaction description / merchant name as shown by the bank */
  readonly description: string;

  /** Cleaned/normalized merchant name, if available */
  readonly merchantName?: string;

  /** Transaction category assigned by the bank, if available */
  readonly category?: string;

  /** Whether this transaction is pending or posted */
  readonly status: TransactionStatusName;

  /** Bank-specific transaction type (e.g., "ACH", "wire", "POS") */
  readonly transactionType?: string;
}

// ─── Bank Adapter Interface ──────────────────────────────────────────

/**
 * Supported bank identifiers — each maps to a concrete adapter implementation.
 * New banks are added by implementing BankAdapter and registering here.
 */
export interface BankAdapterMetadata {
  /** Unique identifier for this bank adapter */
  readonly bankId: string;

  /** Human-readable bank name */
  readonly displayName: string;

  /** Bank's primary website URL */
  readonly baseUrl: string;

  /** Bank's login page URL */
  readonly loginUrl: string;

  /** Whether this adapter supports transaction fetching */
  readonly supportsTransactions: boolean;

  /** Whether this adapter supports account number extraction */
  readonly supportsAccountNumbers: boolean;

  /** Whether this adapter supports routing number extraction */
  readonly supportsRoutingNumbers: boolean;
}

/**
 * Interface for bank-specific automation adapters.
 *
 * Each bank has unique login pages, MFA flows, and data layouts.
 * A BankAdapter encapsulates all bank-specific automation logic.
 *
 * Postconditions:
 * - `getAccounts()` returns all accessible accounts after successful auth
 * - `getTransactions()` returns transactions within the specified date range
 * - `cleanup()` releases all resources — must always be called, even on error
 *
 * Invariants:
 * - An adapter is single-use: one auth flow, one data extraction, then cleanup
 * - Methods must be called in order: authenticate → getAccounts → getTransactions → cleanup
 * - Calling methods out of order throws an error
 */
export interface BankAdapter {
  /** Metadata describing this adapter's capabilities */
  readonly metadata: BankAdapterMetadata;

  /**
   * Authenticate with the bank.
   * @returns true if authentication succeeded, false if failed
   */
  authenticate(): Promise<boolean>;

  /**
   * Fetch all accounts accessible after authentication.
   * @precondition Must be authenticated first
   * @returns Array of accounts
   */
  getAccounts(): Promise<readonly Account[]>;

  /**
   * Fetch transactions for a specific account.
   * @precondition Must be authenticated first
   * @param accountId - The account to fetch transactions for
   * @param startDate - Start of date range (ISO 8601)
   * @param endDate - End of date range (ISO 8601)
   * @returns Array of transactions
   */
  getTransactions(
    accountId: string,
    startDate: string,
    endDate: string,
  ): Promise<readonly Transaction[]>;

  /**
   * Clean up all resources. Must be called when done.
   * Safe to call multiple times (idempotent).
   */
  cleanup(): Promise<void>;
}

// ─── Conduit Configuration ───────────────────────────────────────────

/**
 * Log level for SDK diagnostics.
 */
export const LogLevel = {
  None: 'none',
  Error: 'error',
  Warn: 'warn',
  Info: 'info',
  Debug: 'debug',
} as const;

export type LogLevelName = (typeof LogLevel)[keyof typeof LogLevel];

/**
 * Configuration for the Conduit SDK.
 *
 * Invariants:
 * - `clientId` must be non-empty — validated at construction
 * - `environment` determines the target API endpoint
 * - Timeouts must be positive numbers
 */
export interface ConduitConfig {
  /** Client ID issued by Conduit */
  readonly clientId: string;

  /** Secret key for server-side use (never embed in mobile apps) */
  readonly secret?: string;

  /** Target environment */
  readonly environment: 'sandbox' | 'development' | 'production';

  /** Language/locale for UI strings (default: 'en') */
  readonly locale?: string;

  /** Log level for SDK diagnostics (default: 'warn') */
  readonly logLevel?: LogLevelName;

  /** Custom timeout for bank page loads in ms (default: 30000) */
  readonly navigationTimeoutMs?: number;

  /** Custom timeout for MFA response in ms (default: 300000 = 5 min) */
  readonly mfaTimeoutMs?: number;

  /** Whether to show the browser preview UI (default: true) */
  readonly showPreview?: boolean;
}

/**
 * Validates a ConduitConfig.
 * @throws if invariants are violated
 */
export function assertValidConfig(config: ConduitConfig): asserts config is ConduitConfig {
  if (!config.clientId || config.clientId.trim().length === 0) {
    throw new Error('ConduitConfig.clientId must be a non-empty string');
  }
  if (
    config.navigationTimeoutMs !== undefined &&
    (config.navigationTimeoutMs <= 0 || !Number.isFinite(config.navigationTimeoutMs))
  ) {
    throw new Error('ConduitConfig.navigationTimeoutMs must be a positive finite number');
  }
  if (
    config.mfaTimeoutMs !== undefined &&
    (config.mfaTimeoutMs <= 0 || !Number.isFinite(config.mfaTimeoutMs))
  ) {
    throw new Error('ConduitConfig.mfaTimeoutMs must be a positive finite number');
  }
}

// ─── Link Session ────────────────────────────────────────────────────

/**
 * Link session phases — tracks the user-facing link flow lifecycle.
 *
 * Flow: created → institution_selected → authenticating → extracting → succeeded
 * Error/cancel can occur from any active state.
 */
export const LinkSessionPhase = {
  Created: 'created',
  InstitutionSelected: 'institution_selected',
  Authenticating: 'authenticating',
  MfaRequired: 'mfa_required',
  Extracting: 'extracting',
  Succeeded: 'succeeded',
  Failed: 'failed',
  Cancelled: 'cancelled',
} as const;

export type LinkSessionPhaseName = (typeof LinkSessionPhase)[keyof typeof LinkSessionPhase];

/**
 * Discriminated union for link session states.
 * Each state carries only the data relevant to that phase.
 */

export interface LinkSessionCreated {
  readonly phase: typeof LinkSessionPhase.Created;
  readonly sessionId: string;
  readonly createdAt: number;
}

export interface LinkSessionInstitutionSelected {
  readonly phase: typeof LinkSessionPhase.InstitutionSelected;
  readonly sessionId: string;
  readonly createdAt: number;
  readonly institutionId: string;
  readonly institutionName: string;
}

export interface LinkSessionAuthenticating {
  readonly phase: typeof LinkSessionPhase.Authenticating;
  readonly sessionId: string;
  readonly createdAt: number;
  readonly institutionId: string;
}

export interface LinkSessionMfaRequired {
  readonly phase: typeof LinkSessionPhase.MfaRequired;
  readonly sessionId: string;
  readonly createdAt: number;
  readonly institutionId: string;
  readonly mfaChallengeType: string;
}

export interface LinkSessionExtracting {
  readonly phase: typeof LinkSessionPhase.Extracting;
  readonly sessionId: string;
  readonly createdAt: number;
  readonly institutionId: string;
  readonly progress: number; // 0.0 to 1.0
}

export interface LinkSessionSucceeded {
  readonly phase: typeof LinkSessionPhase.Succeeded;
  readonly sessionId: string;
  readonly createdAt: number;
  readonly completedAt: number;
  readonly institutionId: string;
  readonly accounts: readonly Account[];
}

export interface LinkSessionFailed {
  readonly phase: typeof LinkSessionPhase.Failed;
  readonly sessionId: string;
  readonly createdAt: number;
  readonly failedAt: number;
  readonly error: LinkError;
}

export interface LinkSessionCancelled {
  readonly phase: typeof LinkSessionPhase.Cancelled;
  readonly sessionId: string;
  readonly createdAt: number;
  readonly cancelledAt: number;
}

/**
 * Complete LinkSession type — discriminated union on `phase`.
 * Use `session.phase` to narrow and access state-specific fields.
 */
export type LinkSession =
  | LinkSessionCreated
  | LinkSessionInstitutionSelected
  | LinkSessionAuthenticating
  | LinkSessionMfaRequired
  | LinkSessionExtracting
  | LinkSessionSucceeded
  | LinkSessionFailed
  | LinkSessionCancelled;

// ─── Link Error Types ────────────────────────────────────────────────

export const LinkErrorCode = {
  InstitutionNotSupported: 'INSTITUTION_NOT_SUPPORTED',
  AuthenticationFailed: 'AUTHENTICATION_FAILED',
  MfaFailed: 'MFA_FAILED',
  MfaTimeout: 'MFA_TIMEOUT',
  ExtractionFailed: 'EXTRACTION_FAILED',
  Timeout: 'TIMEOUT',
  NetworkError: 'NETWORK_ERROR',
  InternalError: 'INTERNAL_ERROR',
  UserCancelled: 'USER_CANCELLED',
} as const;

export type LinkErrorCodeName = (typeof LinkErrorCode)[keyof typeof LinkErrorCode];

export interface LinkError {
  readonly code: LinkErrorCodeName;
  readonly message: string;
  readonly institutionId?: string;
  readonly displayMessage?: string;
}

// ─── Link Session Transition Validation ──────────────────────────────

/**
 * Valid transitions for the LinkSession state machine.
 */
const VALID_LINK_TRANSITIONS: Record<LinkSessionPhaseName, readonly LinkSessionPhaseName[]> = {
  [LinkSessionPhase.Created]: [LinkSessionPhase.InstitutionSelected, LinkSessionPhase.Cancelled],
  [LinkSessionPhase.InstitutionSelected]: [
    LinkSessionPhase.Authenticating,
    LinkSessionPhase.Cancelled,
  ],
  [LinkSessionPhase.Authenticating]: [
    LinkSessionPhase.MfaRequired,
    LinkSessionPhase.Extracting,
    LinkSessionPhase.Failed,
    LinkSessionPhase.Cancelled,
  ],
  [LinkSessionPhase.MfaRequired]: [
    LinkSessionPhase.Authenticating,
    LinkSessionPhase.Failed,
    LinkSessionPhase.Cancelled,
  ],
  [LinkSessionPhase.Extracting]: [
    LinkSessionPhase.Succeeded,
    LinkSessionPhase.Failed,
    LinkSessionPhase.Cancelled,
  ],
  [LinkSessionPhase.Succeeded]: [],
  [LinkSessionPhase.Failed]: [],
  [LinkSessionPhase.Cancelled]: [],
} as const;

/**
 * Validates a link session state transition.
 */
export function isValidLinkTransition(
  from: LinkSessionPhaseName,
  to: LinkSessionPhaseName,
): boolean {
  const allowed = VALID_LINK_TRANSITIONS[from];
  return allowed.includes(to);
}

/**
 * Asserts a link session transition is valid, throwing if not.
 */
export function assertValidLinkTransition(
  from: LinkSessionPhaseName,
  to: LinkSessionPhaseName,
): void {
  if (!isValidLinkTransition(from, to)) {
    throw new Error(
      `Invalid link session transition: ${from} → ${to}. ` +
        `Valid transitions from ${from}: [${VALID_LINK_TRANSITIONS[from].join(', ')}]`,
    );
  }
}
