/**
 * Tests for the DOM data extraction engine.
 * Uses a mock DomContext to test extraction logic without a real browser.
 */

import {
  type DomContext,
  type ExtractedRow,
  extractRows,
  extractPage,
  ExtractionError,
  ExtractionErrorCode,
} from '../../src/adapters/extraction';
import type { FieldExtractor, PageExtractorConfig } from '../../src/adapters/types';

// ─── Mock DomContext ────────────────────────────────────────────────

/**
 * Simple mock element with text content and attributes.
 */
interface MockElement {
  textContent: string;
  innerText: string;
  value: string;
  attributes: Record<string, string>;
  children: Record<string, MockElement[]>;
}

/**
 * Create a mock element with specified properties.
 */
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
 * Create a mock DomContext for testing.
 */
function createMockContext(options?: {
  waitForSelectorShouldThrow?: boolean;
  rootElements?: Record<string, MockElement[]>;
}): DomContext {
  const rootElements = options?.rootElements ?? {};

  return {
    querySelectorAll: jest.fn(
      async (selector: string, parent?: unknown): Promise<unknown[]> => {
        if (parent) {
          const parentEl = parent as MockElement;
          return parentEl.children[selector] ?? [];
        }
        return rootElements[selector] ?? [];
      },
    ),
    getTextContent: jest.fn(async (el: unknown) => (el as MockElement).textContent),
    getInnerText: jest.fn(async (el: unknown) => (el as MockElement).innerText),
    getAttribute: jest.fn(async (el: unknown, name: string) => {
      const elem = el as MockElement;
      return elem.attributes[name] ?? null;
    }),
    getValue: jest.fn(async (el: unknown) => (el as MockElement).value),
    waitForSelector: jest.fn(async (_selector: string, _timeoutMs: number) => {
      if (options?.waitForSelectorShouldThrow) {
        throw new Error('Timeout waiting for selector');
      }
    }),
  };
}

// ─── extractRows Tests ──────────────────────────────────────────────

describe('extractRows', () => {
  it('extracts text content from row elements', async () => {
    const row = mockElement({
      children: {
        '.date': [mockElement({ textContent: '01/15/2024' })],
        '.desc': [mockElement({ textContent: 'Amazon Purchase' })],
        '.amount': [mockElement({ textContent: '$42.50' })],
      },
    });

    const fields: FieldExtractor[] = [
      { fieldName: 'date', selector: '.date', strategy: { type: 'textContent' }, required: true },
      { fieldName: 'description', selector: '.desc', strategy: { type: 'textContent' }, required: true },
      { fieldName: 'amount', selector: '.amount', strategy: { type: 'textContent' }, required: true },
    ];

    const ctx = createMockContext();
    const result = await extractRows(ctx, [row], fields);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      date: '01/15/2024',
      description: 'Amazon Purchase',
      amount: '$42.50',
    });
  });

  it('handles multiple rows', async () => {
    const row1 = mockElement({
      children: {
        '.name': [mockElement({ textContent: 'Alice' })],
      },
    });
    const row2 = mockElement({
      children: {
        '.name': [mockElement({ textContent: 'Bob' })],
      },
    });

    const fields: FieldExtractor[] = [
      { fieldName: 'name', selector: '.name', strategy: { type: 'textContent' }, required: true },
    ];

    const ctx = createMockContext();
    const result = await extractRows(ctx, [row1, row2], fields);

    expect(result).toHaveLength(2);
    expect(result[0]!['name']).toBe('Alice');
    expect(result[1]!['name']).toBe('Bob');
  });

  it('applies transforms to extracted values', async () => {
    const row = mockElement({
      children: {
        '.amount': [mockElement({ textContent: '$1,234.56' })],
        '.date': [mockElement({ textContent: '01/15/2024' })],
      },
    });

    const fields: FieldExtractor[] = [
      {
        fieldName: 'amount',
        selector: '.amount',
        strategy: { type: 'textContent' },
        transform: 'parseAmount',
        required: true,
      },
      {
        fieldName: 'date',
        selector: '.date',
        strategy: { type: 'textContent' },
        transform: 'parseDate',
        required: true,
      },
    ];

    const ctx = createMockContext();
    const result = await extractRows(ctx, [row], fields);

    expect(result[0]!['amount']).toBe('1234.56');
    expect(result[0]!['date']).toBe('2024-01-15');
  });

  it('omits optional fields that are missing', async () => {
    const row = mockElement({
      children: {
        '.name': [mockElement({ textContent: 'Test' })],
        // No .status child
      },
    });

    const fields: FieldExtractor[] = [
      { fieldName: 'name', selector: '.name', strategy: { type: 'textContent' }, required: true },
      { fieldName: 'status', selector: '.status', strategy: { type: 'textContent' }, required: false },
    ];

    const ctx = createMockContext();
    const result = await extractRows(ctx, [row], fields);

    expect(result[0]).toEqual({ name: 'Test' });
    expect(result[0]!['status']).toBeUndefined();
  });

  it('throws ExtractionError for missing required fields', async () => {
    const row = mockElement({
      children: {
        // No .name child
      },
    });

    const fields: FieldExtractor[] = [
      { fieldName: 'name', selector: '.name', strategy: { type: 'textContent' }, required: true },
    ];

    const ctx = createMockContext();
    await expect(extractRows(ctx, [row], fields)).rejects.toThrow(ExtractionError);
    await expect(extractRows(ctx, [row], fields)).rejects.toThrow(
      /Required field "name" not found/,
    );
  });

  it('skips empty rows (no fields extracted)', async () => {
    const emptyRow = mockElement({ children: {} });

    const fields: FieldExtractor[] = [
      { fieldName: 'name', selector: '.name', strategy: { type: 'textContent' }, required: false },
    ];

    const ctx = createMockContext();
    const result = await extractRows(ctx, [emptyRow], fields);

    expect(result).toHaveLength(0);
  });

  describe('extraction strategies', () => {
    it('extracts using innerText strategy', async () => {
      const row = mockElement({
        children: {
          '.desc': [mockElement({ textContent: 'raw text', innerText: 'rendered text' })],
        },
      });

      const fields: FieldExtractor[] = [
        { fieldName: 'desc', selector: '.desc', strategy: { type: 'innerText' }, required: true },
      ];

      const ctx = createMockContext();
      const result = await extractRows(ctx, [row], fields);

      expect(result[0]!['desc']).toBe('rendered text');
    });

    it('extracts using attribute strategy', async () => {
      const row = mockElement({
        children: {
          '.link': [mockElement({ attributes: { 'data-id': 'txn-123' } })],
        },
      });

      const fields: FieldExtractor[] = [
        {
          fieldName: 'id',
          selector: '.link',
          strategy: { type: 'attribute', attributeName: 'data-id' },
          required: true,
        },
      ];

      const ctx = createMockContext();
      const result = await extractRows(ctx, [row], fields);

      expect(result[0]!['id']).toBe('txn-123');
    });

    it('throws for missing required attribute', async () => {
      const row = mockElement({
        children: {
          '.link': [mockElement({ attributes: {} })],
        },
      });

      const fields: FieldExtractor[] = [
        {
          fieldName: 'id',
          selector: '.link',
          strategy: { type: 'attribute', attributeName: 'data-id' },
          required: true,
        },
      ];

      const ctx = createMockContext();
      await expect(extractRows(ctx, [row], fields)).rejects.toThrow(
        /Attribute "data-id" not found/,
      );
    });

    it('extracts using value strategy', async () => {
      const row = mockElement({
        children: {
          'input.amount': [mockElement({ value: '42.50' })],
        },
      });

      const fields: FieldExtractor[] = [
        { fieldName: 'amount', selector: 'input.amount', strategy: { type: 'value' }, required: true },
      ];

      const ctx = createMockContext();
      const result = await extractRows(ctx, [row], fields);

      expect(result[0]!['amount']).toBe('42.50');
    });

    it('extracts using regex strategy', async () => {
      const row = mockElement({
        children: {
          '.info': [mockElement({ textContent: 'Account: 1234567890' })],
        },
      });

      const fields: FieldExtractor[] = [
        {
          fieldName: 'accountNum',
          selector: '.info',
          strategy: { type: 'regex', pattern: 'Account:\\s*(\\d+)', groupIndex: 1 },
          required: true,
        },
      ];

      const ctx = createMockContext();
      const result = await extractRows(ctx, [row], fields);

      expect(result[0]!['accountNum']).toBe('1234567890');
    });

    it('throws for non-matching regex on required field', async () => {
      const row = mockElement({
        children: {
          '.info': [mockElement({ textContent: 'No match here' })],
        },
      });

      const fields: FieldExtractor[] = [
        {
          fieldName: 'accountNum',
          selector: '.info',
          strategy: { type: 'regex', pattern: 'Account:\\s*(\\d+)', groupIndex: 1 },
          required: true,
        },
      ];

      const ctx = createMockContext();
      await expect(extractRows(ctx, [row], fields)).rejects.toThrow(
        /Regex pattern.*did not match/,
      );
    });

    it('returns undefined for non-matching regex on optional field', async () => {
      const row = mockElement({
        children: {
          '.name': [mockElement({ textContent: 'Test' })],
          '.info': [mockElement({ textContent: 'No match here' })],
        },
      });

      const fields: FieldExtractor[] = [
        { fieldName: 'name', selector: '.name', strategy: { type: 'textContent' }, required: true },
        {
          fieldName: 'accountNum',
          selector: '.info',
          strategy: { type: 'regex', pattern: 'Account:\\s*(\\d+)', groupIndex: 1 },
          required: false,
        },
      ];

      const ctx = createMockContext();
      const result = await extractRows(ctx, [row], fields);

      expect(result[0]!['accountNum']).toBeUndefined();
    });
  });
});

// ─── extractPage Tests ──────────────────────────────────────────────

describe('extractPage', () => {
  it('waits for ready selector then extracts rows', async () => {
    const row = mockElement({
      children: {
        '.name': [mockElement({ textContent: 'Test' })],
      },
    });

    const config: PageExtractorConfig = {
      readySelector: '.container',
      readyTimeoutMs: 5000,
      fields: [
        { fieldName: 'name', selector: '.name', strategy: { type: 'textContent' }, required: true },
      ],
    };

    const ctx = createMockContext({ rootElements: { '.row': [row] } });
    const result = await extractPage(ctx, config, '.row');

    expect(ctx.waitForSelector).toHaveBeenCalledWith('.container', 5000);
    expect(result).toHaveLength(1);
    expect(result[0]!['name']).toBe('Test');
  });

  it('uses default timeout when not specified', async () => {
    const config: PageExtractorConfig = {
      readySelector: '.container',
      // No readyTimeoutMs — default 10000
      fields: [],
    };

    const ctx = createMockContext({ rootElements: {} });
    await extractPage(ctx, config, '.row');

    expect(ctx.waitForSelector).toHaveBeenCalledWith('.container', 10000);
  });

  it('throws ExtractionError on ready timeout', async () => {
    const config: PageExtractorConfig = {
      readySelector: '.container',
      readyTimeoutMs: 1000,
      fields: [],
    };

    const ctx = createMockContext({ waitForSelectorShouldThrow: true });

    await expect(extractPage(ctx, config, '.row')).rejects.toThrow(ExtractionError);
    await expect(extractPage(ctx, config, '.row')).rejects.toThrow(
      /Timed out waiting for ready selector/,
    );
  });

  it('returns empty array when no rows found', async () => {
    const config: PageExtractorConfig = {
      readySelector: '.container',
      fields: [
        { fieldName: 'name', selector: '.name', strategy: { type: 'textContent' }, required: true },
      ],
    };

    const ctx = createMockContext({ rootElements: {} });
    const result = await extractPage(ctx, config, '.row');

    expect(result).toHaveLength(0);
  });
});

// ─── ExtractionError Tests ──────────────────────────────────────────

describe('ExtractionError', () => {
  it('has correct error code and message', () => {
    const err = new ExtractionError(
      ExtractionErrorCode.RequiredFieldMissing,
      'Field "date" is required',
      'date',
      '.transaction-date',
    );

    expect(err.code).toBe('REQUIRED_FIELD_MISSING');
    expect(err.message).toBe('Field "date" is required');
    expect(err.fieldName).toBe('date');
    expect(err.selector).toBe('.transaction-date');
    expect(err.name).toBe('ExtractionError');
  });

  it('is an instance of Error', () => {
    const err = new ExtractionError(
      ExtractionErrorCode.ReadyTimeout,
      'Timeout',
    );
    expect(err).toBeInstanceOf(Error);
  });
});

describe('ExtractionErrorCode', () => {
  it('has all expected codes', () => {
    expect(ExtractionErrorCode.ReadyTimeout).toBe('READY_TIMEOUT');
    expect(ExtractionErrorCode.RequiredFieldMissing).toBe('REQUIRED_FIELD_MISSING');
    expect(ExtractionErrorCode.SelectorNotFound).toBe('SELECTOR_NOT_FOUND');
    expect(ExtractionErrorCode.StrategyFailed).toBe('STRATEGY_FAILED');
    expect(ExtractionErrorCode.InvalidConfig).toBe('INVALID_CONFIG');
  });
});
