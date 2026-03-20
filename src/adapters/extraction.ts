/**
 * DOM Data Extraction Engine (CDT-14)
 *
 * Generic engine that extracts structured data from HTML DOM using
 * BankAdapterConfig extractor definitions (selectors, strategies, transforms).
 *
 * This module is decoupled from any specific browser driver — it operates
 * on a DomContext interface that abstracts DOM querying. Concrete
 * implementations can use Puppeteer, JSDOM, or real browser WebViews.
 *
 * Invariants:
 * - Required fields that are missing cause extraction to fail with ExtractionError
 * - Optional fields that are missing are omitted from the result (not set to null)
 * - Transform application never throws — invalid transforms return original value
 * - ExtractionStrategy is a discriminated union — all variants handled exhaustively
 */

import type {
  ExtractionStrategy,
  FieldExtractor,
  PageExtractorConfig,
} from './types';
import { applyTransform } from './transforms';

// ─── Error Types ──────────────────────────────────────────────────────

/**
 * Error codes for extraction failures.
 */
export const ExtractionErrorCode = {
  ReadyTimeout: 'READY_TIMEOUT',
  RequiredFieldMissing: 'REQUIRED_FIELD_MISSING',
  SelectorNotFound: 'SELECTOR_NOT_FOUND',
  StrategyFailed: 'STRATEGY_FAILED',
  InvalidConfig: 'INVALID_CONFIG',
} as const;

export type ExtractionErrorCodeName =
  (typeof ExtractionErrorCode)[keyof typeof ExtractionErrorCode];

/**
 * Structured extraction error with context about what failed.
 */
export class ExtractionError extends Error {
  constructor(
    public readonly code: ExtractionErrorCodeName,
    message: string,
    public readonly fieldName?: string,
    public readonly selector?: string,
  ) {
    super(message);
    this.name = 'ExtractionError';
  }
}

// ─── DOM Context Interface ──────────────────────────────────────────

/**
 * Minimal DOM context needed for extraction.
 * Abstracts DOM querying so extraction works with Puppeteer, JSDOM, etc.
 */
export interface DomContext {
  /**
   * Query all elements matching a CSS selector within a parent scope.
   * @returns Array of opaque element handles.
   */
  querySelectorAll(selector: string, parent?: unknown): Promise<unknown[]>;

  /**
   * Extract text content from an element.
   */
  getTextContent(element: unknown): Promise<string>;

  /**
   * Extract inner text from an element (rendered text only).
   */
  getInnerText(element: unknown): Promise<string>;

  /**
   * Get an attribute value from an element.
   */
  getAttribute(element: unknown, name: string): Promise<string | null>;

  /**
   * Get the value property of a form element.
   */
  getValue(element: unknown): Promise<string>;

  /**
   * Wait for an element matching the selector to appear.
   * @param timeoutMs - Maximum time to wait.
   * @throws if timeout is exceeded.
   */
  waitForSelector(selector: string, timeoutMs: number): Promise<void>;
}

// ─── Extraction Engine ──────────────────────────────────────────────

/**
 * Result of extracting a single row of data.
 * Keys are field names, values are the extracted (and transformed) strings.
 */
export type ExtractedRow = Record<string, string>;

/**
 * Extract a single field value from an element using the configured strategy.
 *
 * @throws ExtractionError if strategy fails on a required field.
 */
async function extractFieldValue(
  ctx: DomContext,
  element: unknown,
  field: FieldExtractor,
): Promise<string | undefined> {
  // Find the target element within the row
  const targets = await ctx.querySelectorAll(field.selector, element);
  if (targets.length === 0) {
    if (field.required) {
      throw new ExtractionError(
        ExtractionErrorCode.SelectorNotFound,
        `Required field "${field.fieldName}" not found with selector "${field.selector}"`,
        field.fieldName,
        field.selector,
      );
    }
    return undefined;
  }

  const target = targets[0]!;
  let rawValue: string;

  // Apply extraction strategy (exhaustive switch)
  switch (field.strategy.type) {
    case 'textContent':
      rawValue = await ctx.getTextContent(target);
      break;
    case 'innerText':
      rawValue = await ctx.getInnerText(target);
      break;
    case 'attribute': {
      const attrVal = await ctx.getAttribute(target, field.strategy.attributeName);
      if (attrVal === null) {
        if (field.required) {
          throw new ExtractionError(
            ExtractionErrorCode.StrategyFailed,
            `Attribute "${field.strategy.attributeName}" not found on element for field "${field.fieldName}"`,
            field.fieldName,
            field.selector,
          );
        }
        return undefined;
      }
      rawValue = attrVal;
      break;
    }
    case 'value':
      rawValue = await ctx.getValue(target);
      break;
    case 'regex': {
      const text = await ctx.getTextContent(target);
      const regex = new RegExp(field.strategy.pattern);
      const match = regex.exec(text);
      if (!match) {
        if (field.required) {
          throw new ExtractionError(
            ExtractionErrorCode.StrategyFailed,
            `Regex pattern "${field.strategy.pattern}" did not match text for field "${field.fieldName}"`,
            field.fieldName,
            field.selector,
          );
        }
        return undefined;
      }
      rawValue = match[field.strategy.groupIndex ?? 0] ?? '';
      break;
    }
    default: {
      const _exhaustive: never = field.strategy;
      rawValue = '';
    }
  }

  // Apply transform if configured
  if (field.transform) {
    rawValue = applyTransform(rawValue, field.transform);
  }

  return rawValue;
}

/**
 * Extract data from a list of row elements using field extractors.
 *
 * @param ctx - DOM context for querying
 * @param rows - Array of row elements to extract from
 * @param fields - Field extractors defining what to extract from each row
 * @returns Array of extracted row data (one per input row)
 *
 * @throws ExtractionError if a required field is missing in any row
 */
export async function extractRows(
  ctx: DomContext,
  rows: unknown[],
  fields: readonly FieldExtractor[],
): Promise<ExtractedRow[]> {
  const results: ExtractedRow[] = [];

  for (const row of rows) {
    const rowData: ExtractedRow = {};

    for (const field of fields) {
      const value = await extractFieldValue(ctx, row, field);
      if (value !== undefined) {
        rowData[field.fieldName] = value;
      }
    }

    // Only include rows that have at least one field extracted
    if (Object.keys(rowData).length > 0) {
      results.push(rowData);
    }
  }

  return results;
}

/**
 * Run a full page extraction using a PageExtractorConfig.
 *
 * 1. Wait for the readySelector to appear
 * 2. Find all row elements using the first field's parent container
 * 3. Extract fields from each row
 *
 * @param ctx - DOM context
 * @param config - Page extractor configuration
 * @param rowSelector - CSS selector for individual rows within the ready container
 * @returns Array of extracted row data
 */
export async function extractPage(
  ctx: DomContext,
  config: PageExtractorConfig,
  rowSelector: string,
): Promise<ExtractedRow[]> {
  // Wait for the page to be ready
  const timeout = config.readyTimeoutMs ?? 10000;
  try {
    await ctx.waitForSelector(config.readySelector, timeout);
  } catch {
    throw new ExtractionError(
      ExtractionErrorCode.ReadyTimeout,
      `Timed out waiting for ready selector "${config.readySelector}" after ${timeout}ms`,
    );
  }

  // Find all row elements
  const rows = await ctx.querySelectorAll(rowSelector);

  // Extract fields from each row
  return extractRows(ctx, rows, config.fields);
}
