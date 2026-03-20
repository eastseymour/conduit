/**
 * Tests for the transaction extraction module (CDT-14).
 * Tests the full transaction extraction pipeline including:
 * - Row to Transaction conversion
 * - Pagination handling
 * - Date range filtering
 * - Pending vs posted transaction handling
 * - Integration with Chase adapter configuration
 */

import {
  extractTransactions,
  rowToTransaction,
  getTransactionSelectors,
  type TransactionDomContext,
} from '../../src/adapters/transaction-extractor';
import type { ExtractedRow } from '../../src/adapters/extraction';
import { ExtractionError, ExtractionErrorCode } from '../../src/adapters/extraction';
import { chaseAdapter } from '../../src/adapters/banks/chase';
import type { BankAdapterConfig } from '../../src/adapters/types';

// ─── Mock TransactionDomContext ─────────────────────────────────────

interface MockElement {
  textContent: string;
  innerText: string;
  value: string;
  attributes: Record<string, string>;
  children: Record<string, MockElement[]>;
}

function mockElement(opts: {
  textContent?: string;
  innerText?: string;
  value?: string;
  attributes?: Record<string, string>;
  children?: Record<string, MockElement[]>;
}): MockElement {
  return {
    textContent: opts.textContent ?? '',
    innerText: opts.innerText ?? opts.textContent ?? '',
    value: opts.value ?? '',
    attributes: opts.attributes ?? {},
    children: opts.children ?? {},
  };
}

/**
 * Create a transaction row matching Chase adapter's selectors.
 */
function createChaseTransactionRow(
  date: string,
  description: string,
  amount: string,
  status?: string,
): MockElement {
  const children: Record<string, MockElement[]> = {
    '.transaction-date, .trans-date': [mockElement({ textContent: date })],
    '.transaction-description, .trans-desc': [mockElement({ textContent: description })],
    '.transaction-amount, .trans-amount': [mockElement({ textContent: amount })],
  };
  if (status) {
    children['.transaction-status, .pending-label'] = [mockElement({ textContent: status })];
  }
  return mockElement({ children });
}

function createMockTransactionContext(options: {
  transactionRows?: MockElement[];
  loadMoreVisible?: boolean;
  loadMoreClicksNewRows?: number;
  waitForSelectorShouldThrow?: boolean;
}): TransactionDomContext {
  const rows = options.transactionRows ?? [];
  let currentRows = [...rows];
  let loadMoreClicks = 0;
  const maxNewClicks = options.loadMoreClicksNewRows ?? 0;

  return {
    querySelectorAll: jest.fn(async (selector: string, parent?: unknown): Promise<unknown[]> => {
      if (parent) {
        const parentEl = parent as MockElement;
        return parentEl.children[selector] ?? [];
      }
      // Transaction rows
      if (selector.includes('transaction-row') || selector.includes('transaction-row')) {
        return currentRows;
      }
      // Load more button
      if (selector.includes('show-more') || selector.includes('load-more')) {
        if (options.loadMoreVisible && loadMoreClicks < maxNewClicks) {
          return [mockElement({ textContent: 'Show More' })];
        }
        return [];
      }
      // Ready selector (transaction list)
      if (selector.includes('transaction-list')) {
        return [mockElement({ textContent: 'list' })];
      }
      return [];
    }),
    getTextContent: jest.fn(async (el: unknown) => (el as MockElement).textContent),
    getInnerText: jest.fn(async (el: unknown) => (el as MockElement).innerText),
    getAttribute: jest.fn(async (el: unknown, name: string) => {
      const elem = el as MockElement;
      return elem.attributes[name] ?? null;
    }),
    getValue: jest.fn(async (el: unknown) => (el as MockElement).value),
    waitForSelector: jest.fn(async (_selector: string, _timeoutMs: number) => {
      if (options.waitForSelectorShouldThrow) {
        throw new Error('Timeout');
      }
    }),
    click: jest.fn(async () => {
      loadMoreClicks++;
      // Simulate loading more rows
      if (loadMoreClicks <= maxNewClicks) {
        currentRows = [
          ...currentRows,
          createChaseTransactionRow('01/20/2024', 'Extra Item', '$10.00'),
        ];
      }
    }),
    delay: jest.fn(async () => {}),
    isVisible: jest.fn(async (selector: string) => {
      if (selector.includes('show-more') || selector.includes('load-more')) {
        return !!options.loadMoreVisible && loadMoreClicks < maxNewClicks;
      }
      return false;
    }),
  };
}

// ─── rowToTransaction Tests ─────────────────────────────────────────

describe('rowToTransaction', () => {
  it('converts a complete row to a Transaction', () => {
    const row: ExtractedRow = {
      date: '2024-01-15',
      description: 'AMAZON MARKETPLACE',
      amount: '-42.50',
      status: 'posted',
    };

    const txn = rowToTransaction(row, 'acc-001', 'USD', 0);

    expect(txn.accountId).toBe('acc-001');
    expect(txn.amount).toBe(-42.5);
    expect(txn.currency).toBe('USD');
    expect(txn.date).toBe('2024-01-15');
    expect(txn.description).toBe('AMAZON MARKETPLACE');
    expect(txn.status).toBe('posted');
    expect(txn.id).toBeDefined();
    expect(txn.id.length).toBeGreaterThan(0);
  });

  it('defaults to posted status when not specified', () => {
    const row: ExtractedRow = {
      date: '2024-01-15',
      description: 'Test',
      amount: '100',
    };

    const txn = rowToTransaction(row, 'acc-001', 'USD', 0);
    expect(txn.status).toBe('posted');
  });

  it('detects pending status from row data', () => {
    const row: ExtractedRow = {
      date: '2024-01-15',
      description: 'Test',
      amount: '100',
      status: 'pending',
    };

    const txn = rowToTransaction(row, 'acc-001', 'USD', 0);
    expect(txn.status).toBe('pending');
  });

  it('normalizes status to lowercase', () => {
    const row: ExtractedRow = {
      date: '2024-01-15',
      description: 'Test',
      amount: '100',
      status: 'PENDING',
    };

    const txn = rowToTransaction(row, 'acc-001', 'USD', 0);
    expect(txn.status).toBe('pending');
  });

  it('treats any non-pending status as posted', () => {
    const row: ExtractedRow = {
      date: '2024-01-15',
      description: 'Test',
      amount: '100',
      status: 'completed',
    };

    const txn = rowToTransaction(row, 'acc-001', 'USD', 0);
    expect(txn.status).toBe('posted');
  });

  it('parses non-ISO date strings', () => {
    const row: ExtractedRow = {
      date: '01/15/2024',
      description: 'Test',
      amount: '100',
    };

    const txn = rowToTransaction(row, 'acc-001', 'USD', 0);
    expect(txn.date).toBe('2024-01-15');
  });

  it('parses currency-formatted amounts', () => {
    const row: ExtractedRow = {
      date: '2024-01-15',
      description: 'Test',
      amount: '$1,234.56',
    };

    const txn = rowToTransaction(row, 'acc-001', 'USD', 0);
    expect(txn.amount).toBe(1234.56);
  });

  it('handles negative amounts', () => {
    const row: ExtractedRow = {
      date: '2024-01-15',
      description: 'Test',
      amount: '-42.50',
    };

    const txn = rowToTransaction(row, 'acc-001', 'USD', 0);
    expect(txn.amount).toBe(-42.5);
  });

  it('includes optional fields when present', () => {
    const row: ExtractedRow = {
      date: '2024-01-15',
      description: 'Test',
      amount: '100',
      category: 'Shopping',
      transactionType: 'POS',
    };

    const txn = rowToTransaction(row, 'acc-001', 'USD', 0);
    expect(txn.category).toBe('Shopping');
    expect(txn.transactionType).toBe('POS');
  });

  it('generates unique IDs for different transactions', () => {
    const row1: ExtractedRow = {
      date: '2024-01-15',
      description: 'Amazon',
      amount: '-42.50',
    };
    const row2: ExtractedRow = {
      date: '2024-01-15',
      description: 'Starbucks',
      amount: '-5.75',
    };

    const txn1 = rowToTransaction(row1, 'acc-001', 'USD', 0);
    const txn2 = rowToTransaction(row2, 'acc-001', 'USD', 1);

    expect(txn1.id).not.toBe(txn2.id);
  });

  it('generates different IDs for same transaction at different indices', () => {
    const row: ExtractedRow = {
      date: '2024-01-15',
      description: 'Same',
      amount: '100',
    };

    const txn1 = rowToTransaction(row, 'acc-001', 'USD', 0);
    const txn2 = rowToTransaction(row, 'acc-001', 'USD', 1);

    expect(txn1.id).not.toBe(txn2.id);
  });

  describe('error cases', () => {
    it('throws for missing date', () => {
      const row: ExtractedRow = {
        description: 'Test',
        amount: '100',
      };

      expect(() => rowToTransaction(row, 'acc-001', 'USD', 0)).toThrow(
        /missing required field "date"/,
      );
    });

    it('throws for missing description', () => {
      const row: ExtractedRow = {
        date: '2024-01-15',
        amount: '100',
      };

      expect(() => rowToTransaction(row, 'acc-001', 'USD', 0)).toThrow(
        /missing required field "description"/,
      );
    });

    it('throws for missing amount', () => {
      const row: ExtractedRow = {
        date: '2024-01-15',
        description: 'Test',
      };

      expect(() => rowToTransaction(row, 'acc-001', 'USD', 0)).toThrow(
        /missing required field "amount"/,
      );
    });

    it('throws for unparseable date', () => {
      const row: ExtractedRow = {
        date: 'not-a-date',
        description: 'Test',
        amount: '100',
      };

      expect(() => rowToTransaction(row, 'acc-001', 'USD', 0)).toThrow(
        /Could not parse date/,
      );
    });

    it('throws for unparseable amount', () => {
      const row: ExtractedRow = {
        date: '2024-01-15',
        description: 'Test',
        amount: 'not-a-number',
      };

      expect(() => rowToTransaction(row, 'acc-001', 'USD', 0)).toThrow(
        /Could not parse amount/,
      );
    });
  });
});

// ─── extractTransactions Tests ──────────────────────────────────────

describe('extractTransactions', () => {
  it('extracts transactions from Chase adapter config', async () => {
    const rows = [
      createChaseTransactionRow('01/15/2024', 'AMAZON MARKETPLACE', '-$42.50', 'posted'),
      createChaseTransactionRow('01/14/2024', 'STARBUCKS #12345', '-$5.75', 'posted'),
      createChaseTransactionRow('01/13/2024', 'PAYROLL DEPOSIT', '$2,500.00', 'posted'),
    ];

    const ctx = createMockTransactionContext({ transactionRows: rows });
    const result = await extractTransactions(ctx, chaseAdapter, {
      accountId: 'acc-001',
      currency: 'USD',
    });

    expect(result).toHaveLength(3);
    // Should be sorted by date descending
    expect(result[0]!.date).toBe('2024-01-15');
    expect(result[1]!.date).toBe('2024-01-14');
    expect(result[2]!.date).toBe('2024-01-13');
  });

  it('correctly parses amounts with signs', async () => {
    const rows = [
      createChaseTransactionRow('01/15/2024', 'Debit', '-$42.50'),
      createChaseTransactionRow('01/14/2024', 'Credit', '$100.00'),
    ];

    const ctx = createMockTransactionContext({ transactionRows: rows });
    const result = await extractTransactions(ctx, chaseAdapter, {
      accountId: 'acc-001',
    });

    expect(result[0]!.amount).toBe(-42.5);
    expect(result[1]!.amount).toBe(100);
  });

  it('handles pending transactions', async () => {
    const rows = [
      createChaseTransactionRow('01/15/2024', 'Pending Purchase', '-$20.00', 'Pending'),
      createChaseTransactionRow('01/14/2024', 'Posted Purchase', '-$30.00', 'Posted'),
    ];

    const ctx = createMockTransactionContext({ transactionRows: rows });
    const result = await extractTransactions(ctx, chaseAdapter, {
      accountId: 'acc-001',
    });

    expect(result[0]!.status).toBe('pending');
    expect(result[1]!.status).toBe('posted');
  });

  it('filters by date range', async () => {
    const rows = [
      createChaseTransactionRow('01/20/2024', 'Recent', '-$10.00'),
      createChaseTransactionRow('01/15/2024', 'In Range', '-$20.00'),
      createChaseTransactionRow('01/10/2024', 'Old', '-$30.00'),
      createChaseTransactionRow('01/05/2024', 'Very Old', '-$40.00'),
    ];

    const ctx = createMockTransactionContext({ transactionRows: rows });
    const result = await extractTransactions(ctx, chaseAdapter, {
      accountId: 'acc-001',
      startDate: '2024-01-10',
      endDate: '2024-01-15',
    });

    expect(result).toHaveLength(2);
    expect(result[0]!.description).toBe('In Range');
    expect(result[1]!.description).toBe('Old');
  });

  it('returns all transactions when no date range specified', async () => {
    const rows = [
      createChaseTransactionRow('01/20/2024', 'A', '-$10.00'),
      createChaseTransactionRow('01/15/2024', 'B', '-$20.00'),
    ];

    const ctx = createMockTransactionContext({ transactionRows: rows });
    const result = await extractTransactions(ctx, chaseAdapter, {
      accountId: 'acc-001',
    });

    expect(result).toHaveLength(2);
  });

  it('defaults currency to USD', async () => {
    const rows = [
      createChaseTransactionRow('01/15/2024', 'Test', '-$10.00'),
    ];

    const ctx = createMockTransactionContext({ transactionRows: rows });
    const result = await extractTransactions(ctx, chaseAdapter, {
      accountId: 'acc-001',
    });

    expect(result[0]!.currency).toBe('USD');
  });

  it('assigns accountId to all transactions', async () => {
    const rows = [
      createChaseTransactionRow('01/15/2024', 'A', '-$10.00'),
      createChaseTransactionRow('01/14/2024', 'B', '-$20.00'),
    ];

    const ctx = createMockTransactionContext({ transactionRows: rows });
    const result = await extractTransactions(ctx, chaseAdapter, {
      accountId: 'my-checking',
    });

    for (const txn of result) {
      expect(txn.accountId).toBe('my-checking');
    }
  });

  it('ensures all transaction IDs are unique', async () => {
    const rows = [
      createChaseTransactionRow('01/15/2024', 'Same Store', '-$10.00'),
      createChaseTransactionRow('01/15/2024', 'Same Store', '-$10.00'),
    ];

    const ctx = createMockTransactionContext({ transactionRows: rows });
    const result = await extractTransactions(ctx, chaseAdapter, {
      accountId: 'acc-001',
    });

    const ids = result.map((t) => t.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it('throws for adapter without transaction extractors', async () => {
    const noTxnAdapter: BankAdapterConfig = {
      ...chaseAdapter,
      extractors: { accounts: chaseAdapter.extractors.accounts },
    };

    const ctx = createMockTransactionContext({});
    await expect(
      extractTransactions(ctx, noTxnAdapter, { accountId: 'acc-001' }),
    ).rejects.toThrow(/does not have transaction extractors/);
  });

  it('throws for adapter without transaction table selectors', async () => {
    const noSelectorsAdapter: BankAdapterConfig = {
      ...chaseAdapter,
      selectors: {
        ...chaseAdapter.selectors,
        transactionTable: undefined,
      },
    };

    const ctx = createMockTransactionContext({});
    await expect(
      extractTransactions(ctx, noSelectorsAdapter, { accountId: 'acc-001' }),
    ).rejects.toThrow(/does not have transaction table selectors/);
  });

  it('throws when page times out waiting for transaction list', async () => {
    const ctx = createMockTransactionContext({
      transactionRows: [],
      waitForSelectorShouldThrow: true,
    });

    await expect(
      extractTransactions(ctx, chaseAdapter, { accountId: 'acc-001' }),
    ).rejects.toThrow(ExtractionError);
  });

  it('returns empty array when no transactions found', async () => {
    const ctx = createMockTransactionContext({ transactionRows: [] });
    const result = await extractTransactions(ctx, chaseAdapter, {
      accountId: 'acc-001',
    });

    expect(result).toHaveLength(0);
  });
});

// ─── getTransactionSelectors Tests ──────────────────────────────────

describe('getTransactionSelectors', () => {
  it('returns transaction table selectors for Chase', () => {
    const selectors = getTransactionSelectors(chaseAdapter);
    expect(selectors).toBeDefined();
    expect(selectors!.transactionsList).toBeDefined();
    expect(selectors!.transactionRow).toBeDefined();
    expect(selectors!.transactionDate).toBeDefined();
    expect(selectors!.transactionDescription).toBeDefined();
    expect(selectors!.transactionAmount).toBeDefined();
  });

  it('returns undefined for adapter without transaction selectors', () => {
    const adapter: BankAdapterConfig = {
      ...chaseAdapter,
      selectors: {
        ...chaseAdapter.selectors,
        transactionTable: undefined,
      },
    };

    expect(getTransactionSelectors(adapter)).toBeUndefined();
  });
});

// ─── Integration: Chase Adapter Transaction Config ──────────────────

describe('Chase adapter transaction configuration', () => {
  it('has all required transaction extractor fields', () => {
    const txnExtractor = chaseAdapter.extractors.transactions;
    expect(txnExtractor).toBeDefined();

    const fieldNames = txnExtractor!.fields.map((f) => f.fieldName);
    expect(fieldNames).toContain('date');
    expect(fieldNames).toContain('description');
    expect(fieldNames).toContain('amount');
  });

  it('has date field with parseDate transform', () => {
    const dateField = chaseAdapter.extractors.transactions!.fields.find(
      (f) => f.fieldName === 'date',
    );
    expect(dateField).toBeDefined();
    expect(dateField!.transform).toBe('parseDate');
    expect(dateField!.required).toBe(true);
  });

  it('has amount field with parseAmount transform', () => {
    const amountField = chaseAdapter.extractors.transactions!.fields.find(
      (f) => f.fieldName === 'amount',
    );
    expect(amountField).toBeDefined();
    expect(amountField!.transform).toBe('parseAmount');
    expect(amountField!.required).toBe(true);
  });

  it('has description field with trim transform', () => {
    const descField = chaseAdapter.extractors.transactions!.fields.find(
      (f) => f.fieldName === 'description',
    );
    expect(descField).toBeDefined();
    expect(descField!.transform).toBe('trim');
    expect(descField!.required).toBe(true);
  });

  it('has status field as optional', () => {
    const statusField = chaseAdapter.extractors.transactions!.fields.find(
      (f) => f.fieldName === 'status',
    );
    expect(statusField).toBeDefined();
    expect(statusField!.required).toBe(false);
  });

  it('has load more button selector', () => {
    const selectors = chaseAdapter.selectors.transactionTable;
    expect(selectors).toBeDefined();
    expect(selectors!.loadMoreButton).toBeDefined();
    expect(selectors!.loadMoreButton!.length).toBeGreaterThan(0);
  });

  it('has date range filter selector', () => {
    const selectors = chaseAdapter.selectors.transactionTable;
    expect(selectors!.dateRangeFilter).toBeDefined();
  });
});
