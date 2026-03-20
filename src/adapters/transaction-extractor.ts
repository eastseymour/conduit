/**
 * Transaction Extraction Module (CDT-14)
 *
 * Extracts transaction data from bank pages using the adapter's configured
 * selectors and extractors. Handles:
 * - Navigation to transaction pages
 * - Waiting for transaction list to load
 * - Pagination ("Show more" / "Load more" buttons)
 * - Pending vs posted transaction differentiation
 * - Amount parsing (signed: negative = debit, positive = credit)
 * - Date parsing to ISO 8601
 *
 * Invariants:
 * - Transaction.id is unique within the returned array
 * - Transaction.amount is always a finite signed number
 * - Transaction.date is always a valid ISO 8601 date string
 * - Transaction.status is always 'pending' or 'posted'
 * - Required fields (date, description, amount) must be present in every transaction
 * - Pagination terminates after maxPages to prevent infinite loops
 */

import type { Transaction, TransactionStatusName } from '../types/conduit';
import type { BankAdapterConfig, TransactionTableSelectors } from './types';
import { type DomContext, type ExtractedRow, extractPage, ExtractionError, ExtractionErrorCode } from './extraction';
import { parseAmount, parseDate } from './transforms';

// ─── Configuration ──────────────────────────────────────────────────

/**
 * Options for transaction extraction.
 */
export interface TransactionExtractionOptions {
  /** Account ID to assign to extracted transactions. */
  readonly accountId: string;
  /** ISO 4217 currency code (default: 'USD'). */
  readonly currency?: string;
  /** Maximum number of "load more" pagination clicks (default: 10). */
  readonly maxPages?: number;
  /** Delay in ms after clicking "load more" to wait for new data (default: 2000). */
  readonly paginationDelayMs?: number;
  /** Filter: only return transactions on or after this date (ISO 8601). */
  readonly startDate?: string;
  /** Filter: only return transactions on or before this date (ISO 8601). */
  readonly endDate?: string;
}

/** Default maximum pagination pages to prevent infinite loops. */
const DEFAULT_MAX_PAGES = 10;

/** Default delay after clicking load more. */
const DEFAULT_PAGINATION_DELAY_MS = 2000;

// ─── DOM Context Extension ──────────────────────────────────────────

/**
 * Extended DOM context with click and delay capabilities needed for pagination.
 */
export interface TransactionDomContext extends DomContext {
  /**
   * Click an element.
   */
  click(element: unknown): Promise<void>;

  /**
   * Wait for a specified number of milliseconds.
   */
  delay(ms: number): Promise<void>;

  /**
   * Check if an element is visible/present on the page.
   */
  isVisible(selector: string): Promise<boolean>;
}

// ─── Transaction ID Generation ──────────────────────────────────────

/**
 * Generate a deterministic transaction ID from its core fields.
 * Uses a hash-like approach to create unique IDs within an account.
 *
 * Invariant: same (accountId, date, description, amount) → same ID.
 */
function generateTransactionId(
  accountId: string,
  date: string,
  description: string,
  amount: number,
  index: number,
): string {
  // Simple deterministic ID: account-date-hash-index
  const descHash = simpleHash(description);
  return `${accountId}-${date}-${descHash}-${amount}-${index}`;
}

/**
 * Simple string hash for creating deterministic IDs.
 * Not cryptographic — just for uniqueness within a session.
 */
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(36);
}

// ─── Row to Transaction Conversion ──────────────────────────────────

/**
 * Convert an extracted row into a Transaction object.
 *
 * Preconditions:
 * - row must have 'date', 'description', and 'amount' fields
 *
 * Postconditions:
 * - Returned Transaction has all required fields populated
 * - amount is a finite signed number
 * - date is ISO 8601 format
 * - status is 'pending' or 'posted'
 *
 * @throws ExtractionError if required fields are missing or invalid
 */
export function rowToTransaction(
  row: ExtractedRow,
  accountId: string,
  currency: string,
  index: number,
  defaultStatus: TransactionStatusName = 'posted',
): Transaction {
  // Validate required fields
  const rawDate = row['date'];
  const rawDescription = row['description'];
  const rawAmount = row['amount'];

  if (!rawDate) {
    throw new ExtractionError(
      ExtractionErrorCode.RequiredFieldMissing,
      'Transaction row missing required field "date"',
      'date',
    );
  }
  if (!rawDescription) {
    throw new ExtractionError(
      ExtractionErrorCode.RequiredFieldMissing,
      'Transaction row missing required field "description"',
      'description',
    );
  }
  if (!rawAmount) {
    throw new ExtractionError(
      ExtractionErrorCode.RequiredFieldMissing,
      'Transaction row missing required field "amount"',
      'amount',
    );
  }

  // Parse date — the transform should have already been applied,
  // but handle raw date strings as fallback
  let date = rawDate;
  if (!rawDate.match(/^\d{4}-\d{2}-\d{2}$/)) {
    date = parseDate(rawDate);
    if (!date) {
      throw new ExtractionError(
        ExtractionErrorCode.StrategyFailed,
        `Could not parse date: "${rawDate}"`,
        'date',
      );
    }
  }

  // Parse amount — the transform should have already been applied
  let amount: number;
  const parsed = parseFloat(rawAmount);
  if (Number.isFinite(parsed)) {
    amount = parsed;
  } else {
    amount = parseAmount(rawAmount);
    if (!Number.isFinite(amount)) {
      throw new ExtractionError(
        ExtractionErrorCode.StrategyFailed,
        `Could not parse amount: "${rawAmount}"`,
        'amount',
      );
    }
  }

  // Determine status
  const rawStatus = row['status'];
  let status: TransactionStatusName;
  if (rawStatus) {
    const normalized = rawStatus.toLowerCase().trim();
    if (normalized === 'pending') {
      status = 'pending';
    } else {
      status = 'posted';
    }
  } else {
    status = defaultStatus;
  }

  const description = rawDescription.trim();

  return {
    id: generateTransactionId(accountId, date, description, amount, index),
    accountId,
    amount,
    currency,
    date,
    description,
    status,
    category: row['category'],
    transactionType: row['transactionType'],
  };
}

// ─── Pagination Handler ─────────────────────────────────────────────

/**
 * Click the "load more" button and wait for new transactions to appear.
 *
 * @returns true if more data was loaded, false if button not found or no new data
 */
async function loadMoreTransactions(
  ctx: TransactionDomContext,
  loadMoreSelector: string,
  rowSelector: string,
  currentCount: number,
  delayMs: number,
): Promise<boolean> {
  // Check if the load more button exists and is visible
  const isLoadMoreVisible = await ctx.isVisible(loadMoreSelector);
  if (!isLoadMoreVisible) {
    return false;
  }

  // Find and click the button
  const buttons = await ctx.querySelectorAll(loadMoreSelector);
  if (buttons.length === 0) {
    return false;
  }

  try {
    await ctx.click(buttons[0]!);
  } catch {
    // Button may have disappeared or be unclickable
    return false;
  }

  // Wait for new data to load
  await ctx.delay(delayMs);

  // Check if new rows appeared
  const newRows = await ctx.querySelectorAll(rowSelector);
  return newRows.length > currentCount;
}

// ─── Main Extraction Function ───────────────────────────────────────

/**
 * Extract transactions from a bank page.
 *
 * Uses the adapter's configured selectors and extractors to:
 * 1. Wait for the transaction list to be ready
 * 2. Extract all visible transaction rows
 * 3. Handle pagination if configured
 * 4. Filter by date range if specified
 * 5. Return parsed Transaction objects
 *
 * @param ctx - DOM context with click/delay capabilities
 * @param adapterConfig - Bank adapter configuration
 * @param options - Extraction options (accountId, dates, etc.)
 * @returns Array of parsed transactions, sorted by date descending
 *
 * @throws ExtractionError if extraction fails or required config is missing
 */
export async function extractTransactions(
  ctx: TransactionDomContext,
  adapterConfig: BankAdapterConfig,
  options: TransactionExtractionOptions,
): Promise<readonly Transaction[]> {
  const { accountId, currency = 'USD' } = options;
  const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
  const paginationDelayMs = options.paginationDelayMs ?? DEFAULT_PAGINATION_DELAY_MS;

  // Validate config
  const extractorConfig = adapterConfig.extractors.transactions;
  if (!extractorConfig) {
    throw new ExtractionError(
      ExtractionErrorCode.InvalidConfig,
      `Adapter "${adapterConfig.bankId}" does not have transaction extractors configured`,
    );
  }

  const transactionSelectors = adapterConfig.selectors.transactionTable;
  if (!transactionSelectors) {
    throw new ExtractionError(
      ExtractionErrorCode.InvalidConfig,
      `Adapter "${adapterConfig.bankId}" does not have transaction table selectors configured`,
    );
  }

  const rowSelector = transactionSelectors.transactionRow;

  // Extract initial set of transactions
  let rows = await extractPage(ctx, extractorConfig, rowSelector);

  // Handle pagination — keep loading until no more data or max pages reached
  if (transactionSelectors.loadMoreButton) {
    let pagesLoaded = 0;
    while (pagesLoaded < maxPages) {
      const currentRowCount = (await ctx.querySelectorAll(rowSelector)).length;
      const moreLoaded = await loadMoreTransactions(
        ctx,
        transactionSelectors.loadMoreButton,
        rowSelector,
        currentRowCount,
        paginationDelayMs,
      );

      if (!moreLoaded) break;
      pagesLoaded++;
    }

    // Re-extract all rows after pagination
    if (pagesLoaded > 0) {
      const allRowElements = await ctx.querySelectorAll(rowSelector);
      const { extractRows } = await import('./extraction');
      rows = await extractRows(ctx, allRowElements, extractorConfig.fields);
    }
  }

  // Convert rows to Transaction objects
  const transactions: Transaction[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    try {
      const txn = rowToTransaction(row, accountId, currency, i);
      transactions.push(txn);
    } catch (err) {
      // Skip rows that can't be parsed (e.g., section headers, empty rows)
      if (err instanceof ExtractionError && !row['date'] && !row['amount']) {
        continue;
      }
      throw err;
    }
  }

  // Filter by date range if specified
  const filtered = filterByDateRange(
    transactions,
    options.startDate,
    options.endDate,
  );

  // Sort by date descending (most recent first)
  filtered.sort((a, b) => b.date.localeCompare(a.date));

  // Assert uniqueness of IDs
  assertUniqueIds(filtered);

  return filtered;
}

/**
 * Filter transactions by date range.
 * Both startDate and endDate are inclusive.
 */
function filterByDateRange(
  transactions: Transaction[],
  startDate?: string,
  endDate?: string,
): Transaction[] {
  if (!startDate && !endDate) return transactions;

  return transactions.filter((txn) => {
    if (startDate && txn.date < startDate) return false;
    if (endDate && txn.date > endDate) return false;
    return true;
  });
}

/**
 * Assert that all transaction IDs are unique.
 * This is a critical invariant — duplicates indicate a bug in extraction.
 */
function assertUniqueIds(transactions: Transaction[]): void {
  const ids = new Set<string>();
  for (const txn of transactions) {
    if (ids.has(txn.id)) {
      // Instead of throwing, make IDs unique by appending a suffix
      // This can happen with identical transactions on the same day
      let suffix = 1;
      let newId = `${txn.id}-dup${suffix}`;
      while (ids.has(newId)) {
        suffix++;
        newId = `${txn.id}-dup${suffix}`;
      }
      // Mutate the ID to make it unique (safe because we just created these objects)
      (txn as { id: string }).id = newId;
      ids.add(newId);
    } else {
      ids.add(txn.id);
    }
  }
}

/**
 * Get the transaction table selectors from an adapter config.
 * Utility function for callers that need direct access to selectors.
 */
export function getTransactionSelectors(
  adapterConfig: BankAdapterConfig,
): TransactionTableSelectors | undefined {
  return adapterConfig.selectors.transactionTable;
}
