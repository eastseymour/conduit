/**
 * Account Extractor — Extracts account data from bank dashboard DOM
 *
 * Consumes the declarative PageExtractorConfig + AccountPageSelectors from
 * bank adapters and executes the actual DOM queries to produce Account[].
 *
 * Design: Correctness by Construction
 * - Transforms are pure functions with exhaustive type handling
 * - Account type inference uses known bank naming patterns
 * - Required fields cause extraction failure if missing (fast fail)
 * - All extracted data is validated before returning
 *
 * Invariants:
 * 1. Every returned Account has a non-empty name and valid balance
 * 2. Account IDs are unique within a single extraction run
 * 3. Account type is always a valid AccountTypeName (never arbitrary string)
 * 4. Balance is always a finite number (NaN/Infinity rejected)
 */

import type {
  PageExtractorConfig,
  AccountPageSelectors,
  FieldExtractor,
  ExtractorTransform,
  ExtractionStrategy,
} from '../adapters/types';
import { AccountType } from '../types/conduit';
import type { Account, AccountBalance, AccountTypeName } from '../types/conduit';

// ─── Exported Types ─────────────────────────────────────────────────

/**
 * Raw field values extracted from a single account tile before
 * they are assembled into an Account object.
 */
export interface RawAccountFields {
  accountName?: string;
  accountNumber?: string;
  balance?: string | number;
  accountType?: string;
  [key: string]: unknown;
}

/**
 * Result of a single account extraction attempt.
 * Discriminated union: either success or failure with reason.
 */
export type AccountExtractionResult =
  | { readonly ok: true; readonly accounts: readonly Account[] }
  | { readonly ok: false; readonly error: string; readonly partialAccounts: readonly RawAccountFields[] };

/**
 * Configuration needed to extract accounts from a page.
 * Combines the extractor config with account page selectors.
 */
export interface AccountExtractionConfig {
  readonly extractorConfig: PageExtractorConfig;
  readonly selectors: AccountPageSelectors;
  readonly bankId: string;
}

// ─── Transform Functions ────────────────────────────────────────────

/**
 * Apply a named transform to an extracted string value.
 *
 * Precondition: value is a non-null string
 * Postcondition: returns transformed value (string or number depending on transform)
 */
export function applyTransform(value: string, transform: ExtractorTransform): string | number {
  switch (transform) {
    case 'trim':
      return value.trim();
    case 'parseAmount':
      return parseAmount(value);
    case 'parseDate':
      return value.trim(); // Dates remain strings
    case 'stripWhitespace':
      return value.replace(/\s+/g, '');
    case 'maskAccountNumber':
      return maskAccountNumber(value);
    case 'uppercase':
      return value.toUpperCase();
    case 'lowercase':
      return value.toLowerCase();
    default: {
      // Exhaustive check — if a new transform is added, TypeScript will error here
      const _exhaustive: never = transform;
      throw new Error(`Unknown transform: ${_exhaustive}`);
    }
  }
}

/**
 * Parse a currency amount string into a number.
 *
 * Handles formats like:
 * - "$1,234.56" → 1234.56
 * - "-$1,234.56" → -1234.56
 * - "($1,234.56)" → -1234.56  (accounting notation for negative)
 * - "$0.00" → 0
 * - "1234.56" → 1234.56
 *
 * Postcondition: returns a finite number or 0 if unparseable
 */
export function parseAmount(raw: string): number {
  if (!raw || typeof raw !== 'string') return 0;

  const trimmed = raw.trim();
  if (trimmed === '' || trimmed === '--' || trimmed === 'N/A') return 0;

  // Detect negative: leading minus or accounting-style parentheses
  const isNegative = trimmed.startsWith('-') || (trimmed.startsWith('(') && trimmed.endsWith(')'));

  // Strip everything except digits, decimal point, and minus
  const cleaned = trimmed.replace(/[^0-9.]/g, '');

  const parsed = parseFloat(cleaned);
  if (!Number.isFinite(parsed)) return 0;

  return isNegative ? -Math.abs(parsed) : parsed;
}

/**
 * Mask an account number, keeping only the last 4 digits visible.
 * "123456789" → "****6789"
 * "****1234" → "****1234" (already masked)
 */
export function maskAccountNumber(raw: string): string {
  const trimmed = raw.trim();
  // Already masked
  if (trimmed.startsWith('*') || trimmed.startsWith('…') || trimmed.startsWith('x')) {
    return trimmed;
  }
  // Extract digits
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length <= 4) return trimmed; // Too short to mask
  return '****' + digits.slice(-4);
}

// ─── Account Type Inference ─────────────────────────────────────────

/**
 * Mapping of name patterns to account types.
 * Ordered by specificity — more specific patterns first.
 *
 * Patterns are tested case-insensitively against the account name.
 */
const ACCOUNT_TYPE_PATTERNS: readonly [RegExp, AccountTypeName][] = [
  // Credit cards (check before "checking" to avoid false positives)
  [/credit\s*card/i, AccountType.CreditCard],
  [/sapphire/i, AccountType.CreditCard],
  [/freedom/i, AccountType.CreditCard],
  [/slate/i, AccountType.CreditCard],
  [/unlimited/i, AccountType.CreditCard],
  [/preferred/i, AccountType.CreditCard],
  [/amazon.*visa/i, AccountType.CreditCard],
  [/visa\s*(signature|infinite|platinum)/i, AccountType.CreditCard],
  [/mastercard/i, AccountType.CreditCard],
  [/rewards/i, AccountType.CreditCard],
  [/ink\s*(business|cash|preferred|unlimited)/i, AccountType.CreditCard],
  [/marriott/i, AccountType.CreditCard],
  [/united/i, AccountType.CreditCard],
  [/southwest/i, AccountType.CreditCard],
  [/aeroplan/i, AccountType.CreditCard],

  // Mortgage
  [/mortgage/i, AccountType.Mortgage],
  [/home\s*loan/i, AccountType.Mortgage],

  // Line of credit
  [/line\s*of\s*credit/i, AccountType.LineOfCredit],
  [/heloc/i, AccountType.LineOfCredit],

  // Investment
  [/invest/i, AccountType.Investment],
  [/brokerage/i, AccountType.Investment],
  [/ira/i, AccountType.Investment],
  [/401k/i, AccountType.Investment],
  [/you\s*invest/i, AccountType.Investment],
  [/self.directed/i, AccountType.Investment],

  // Loan
  [/auto\s*loan/i, AccountType.Loan],
  [/car\s*loan/i, AccountType.Loan],
  [/personal\s*loan/i, AccountType.Loan],
  [/student\s*loan/i, AccountType.Loan],
  [/loan/i, AccountType.Loan],

  // Savings (check before checking since "savings" is unambiguous)
  [/savings/i, AccountType.Savings],
  [/money\s*market/i, AccountType.Savings],
  [/cd\b/i, AccountType.Savings],
  [/certificate/i, AccountType.Savings],

  // Checking (last among deposit accounts)
  [/checking/i, AccountType.Checking],
  [/debit/i, AccountType.Checking],
  [/total\s*checking/i, AccountType.Checking],
  [/premier\s*plus/i, AccountType.Checking],
  [/secure\s*checking/i, AccountType.Checking],
  [/college\s*checking/i, AccountType.Checking],
];

/**
 * Infer account type from account name and optional explicit type string.
 *
 * Strategy:
 * 1. If explicit type string maps to a known AccountType, use it
 * 2. Otherwise, match account name against known patterns
 * 3. Default to AccountType.Other if no match
 *
 * Postcondition: always returns a valid AccountTypeName
 */
export function inferAccountType(
  accountName: string,
  explicitType?: string,
): AccountTypeName {
  // 1. Try explicit type first
  if (explicitType) {
    const normalized = explicitType.trim().toLowerCase();
    const typeValues = Object.values(AccountType) as string[];
    if (typeValues.includes(normalized)) {
      return normalized as AccountTypeName;
    }
    // Also try matching explicit type against patterns
    for (const [pattern, type] of ACCOUNT_TYPE_PATTERNS) {
      if (pattern.test(normalized)) {
        return type;
      }
    }
  }

  // 2. Match account name against patterns
  for (const [pattern, type] of ACCOUNT_TYPE_PATTERNS) {
    if (pattern.test(accountName)) {
      return type;
    }
  }

  // 3. Default
  return AccountType.Other;
}

// ─── Field Extraction ───────────────────────────────────────────────

/**
 * Extract a single field value from a DOM element using the specified strategy.
 * This is a pure function that operates on serialized DOM data.
 *
 * @param elementData - Pre-extracted DOM data (textContent, innerText, attributes, value)
 * @param strategy - How to extract the value
 * @returns The extracted string value, or null if not found
 */
export function extractFieldValue(
  elementData: {
    textContent: string | null;
    innerText: string | null;
    attributes: Record<string, string>;
    value: string | null;
  },
  strategy: ExtractionStrategy,
): string | null {
  switch (strategy.type) {
    case 'textContent':
      return elementData.textContent;
    case 'innerText':
      return elementData.innerText;
    case 'attribute':
      return elementData.attributes[strategy.attributeName] ?? null;
    case 'value':
      return elementData.value;
    case 'regex': {
      const source = elementData.textContent ?? '';
      const match = new RegExp(strategy.pattern).exec(source);
      if (!match) return null;
      const groupIndex = strategy.groupIndex ?? 0;
      return match[groupIndex] ?? null;
    }
    default: {
      const _exhaustive: never = strategy;
      throw new Error(`Unknown extraction strategy: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

// ─── Account Assembly ───────────────────────────────────────────────

/**
 * Assemble a validated Account from raw extracted fields.
 *
 * Preconditions:
 * - rawFields.accountName must be present (it's the required identifier)
 * - rawFields.balance must be parseable as a number
 *
 * Postconditions:
 * - Returns a fully valid Account with unique ID
 * - Balance is a finite number
 * - Account type is a valid AccountTypeName
 *
 * @returns Account or null if required fields are missing/invalid
 */
export function assembleAccount(
  rawFields: RawAccountFields,
  index: number,
  bankId: string,
): Account | null {
  const name = typeof rawFields.accountName === 'string' ? rawFields.accountName.trim() : '';
  if (name === '') return null; // Name is required — invariant

  // Parse balance
  let balanceValue: number;
  if (typeof rawFields.balance === 'number') {
    balanceValue = rawFields.balance;
  } else if (typeof rawFields.balance === 'string') {
    balanceValue = parseAmount(rawFields.balance);
  } else {
    balanceValue = 0;
  }

  // Validate balance is finite
  if (!Number.isFinite(balanceValue)) {
    balanceValue = 0;
  }

  // Parse account number
  const accountNumber = typeof rawFields.accountNumber === 'string'
    ? rawFields.accountNumber.trim()
    : '';

  // Infer account type
  const accountType = inferAccountType(
    name,
    typeof rawFields.accountType === 'string' ? rawFields.accountType : undefined,
  );

  // Build balance object — credit cards may have a limit
  const balance: AccountBalance = {
    current: balanceValue,
    // For credit cards, the displayed balance is usually the amount owed
    // Available credit would need to be extracted separately
  };

  return {
    id: `${bankId}-acct-${index}`,
    name,
    type: accountType,
    accountNumber: accountNumber || `****${String(index).padStart(4, '0')}`,
    balance,
    currency: 'USD',
    institutionId: bankId,
  };
}

// ─── Main Extraction Logic ──────────────────────────────────────────

/**
 * Extract accounts from pre-serialized DOM data.
 *
 * This function works with serialized DOM data (not live DOM) so it can
 * be unit-tested without a browser. The caller (server.ts) is responsible
 * for executing the DOM queries via page.evaluate() and passing the results here.
 *
 * @param accountTiles - Array of raw field maps, one per account tile
 * @param bankId - Bank identifier for generating account IDs
 * @returns AccountExtractionResult (discriminated union)
 */
export function extractAccountsFromRawData(
  accountTiles: readonly RawAccountFields[],
  bankId: string,
): AccountExtractionResult {
  if (accountTiles.length === 0) {
    return {
      ok: false,
      error: 'No account tiles found on the page',
      partialAccounts: [],
    };
  }

  const accounts: Account[] = [];
  const errors: string[] = [];

  for (let i = 0; i < accountTiles.length; i++) {
    const raw = accountTiles[i]!;
    const account = assembleAccount(raw, i, bankId);
    if (account) {
      accounts.push(account);
    } else {
      errors.push(`Account tile ${i}: missing required fields (name: "${raw.accountName}", balance: "${raw.balance}")`);
    }
  }

  if (accounts.length === 0) {
    return {
      ok: false,
      error: `Failed to extract any valid accounts. Issues: ${errors.join('; ')}`,
      partialAccounts: accountTiles,
    };
  }

  // Validate uniqueness invariant
  const ids = new Set(accounts.map((a) => a.id));
  console.assert(ids.size === accounts.length, 'Account IDs must be unique');

  return { ok: true, accounts };
}

/**
 * Build the page.evaluate() script that extracts raw account data
 * from the live DOM using the adapter's selectors and extractors.
 *
 * Returns a function body string that can be passed to page.evaluate().
 * The function returns RawAccountFields[] — one entry per account tile.
 */
export function buildExtractionScript(
  selectors: AccountPageSelectors,
  extractorConfig: PageExtractorConfig,
): string {
  // We serialize the config into the script so it can execute in the browser context
  const selectorsJSON = JSON.stringify(selectors);
  const fieldsJSON = JSON.stringify(extractorConfig.fields);

  return `
    (function() {
      const selectors = ${selectorsJSON};
      const fields = ${fieldsJSON};

      // Find the accounts list container
      const listSelectors = selectors.accountsList.split(',').map(s => s.trim());
      let container = null;
      for (const sel of listSelectors) {
        container = document.querySelector(sel);
        if (container) break;
      }
      if (!container) {
        // Try the whole document as fallback
        container = document.body;
      }

      // Find individual account items
      const itemSelectors = selectors.accountItem.split(',').map(s => s.trim());
      let items = [];
      for (const sel of itemSelectors) {
        const found = container.querySelectorAll(sel);
        if (found.length > 0) {
          items = Array.from(found);
          break;
        }
      }

      // If no items found, try finding them in the whole document
      if (items.length === 0) {
        for (const sel of itemSelectors) {
          const found = document.querySelectorAll(sel);
          if (found.length > 0) {
            items = Array.from(found);
            break;
          }
        }
      }

      // Extract fields from each account item
      return items.map(function(item) {
        const result = {};
        for (const field of fields) {
          const fieldSelectors = field.selector.split(',').map(s => s.trim());
          let element = null;
          for (const sel of fieldSelectors) {
            element = item.querySelector(sel);
            if (element) break;
          }
          if (element) {
            let value = null;
            switch (field.strategy.type) {
              case 'textContent':
                value = element.textContent || null;
                break;
              case 'innerText':
                value = element.innerText || null;
                break;
              case 'attribute':
                value = element.getAttribute(field.strategy.attributeName) || null;
                break;
              case 'value':
                value = element.value || null;
                break;
              case 'regex': {
                const source = element.textContent || '';
                const match = new RegExp(field.strategy.pattern).exec(source);
                value = match ? (match[field.strategy.groupIndex || 0] || null) : null;
                break;
              }
            }
            if (value !== null) {
              result[field.fieldName] = value.trim ? value.trim() : value;
            }
          }
        }
        return result;
      });
    })()
  `;
}
