/**
 * Tests for extraction transform functions.
 * Covers parseAmount, parseDate, and applyTransform with
 * edge cases and real-world bank data formats.
 */

import { parseAmount, parseDate, applyTransform } from '../../src/adapters/transforms';

// ─── parseAmount Tests ──────────────────────────────────────────────

describe('parseAmount', () => {
  describe('basic formats', () => {
    it('parses simple dollar amounts', () => {
      expect(parseAmount('$100.00')).toBe(100);
      expect(parseAmount('$0.99')).toBe(0.99);
      expect(parseAmount('$1234.56')).toBe(1234.56);
    });

    it('parses amounts without dollar sign', () => {
      expect(parseAmount('100.00')).toBe(100);
      expect(parseAmount('42.50')).toBe(42.5);
    });

    it('parses integer amounts', () => {
      expect(parseAmount('$100')).toBe(100);
      expect(parseAmount('42')).toBe(42);
    });
  });

  describe('negative amounts (debits)', () => {
    it('parses leading minus sign', () => {
      expect(parseAmount('-$42.00')).toBe(-42);
      expect(parseAmount('-100.50')).toBe(-100.5);
    });

    it('parses parenthesized amounts as negative', () => {
      expect(parseAmount('($100.00)')).toBe(-100);
      expect(parseAmount('($42.50)')).toBe(-42.5);
    });

    it('parses DR suffix as negative', () => {
      expect(parseAmount('$50.00 DR')).toBe(-50);
      expect(parseAmount('$100.00 dr')).toBe(-100);
    });

    it('parses unicode minus sign', () => {
      expect(parseAmount('−$42.00')).toBe(-42);
    });
  });

  describe('positive amounts (credits)', () => {
    it('parses CR suffix as positive', () => {
      expect(parseAmount('$50.00 CR')).toBe(50);
      expect(parseAmount('$100.00 cr')).toBe(100);
    });
  });

  describe('thousands separators', () => {
    it('handles comma-separated thousands', () => {
      expect(parseAmount('$1,234.56')).toBe(1234.56);
      expect(parseAmount('$1,000,000.00')).toBe(1000000);
      expect(parseAmount('-$10,500.25')).toBe(-10500.25);
    });
  });

  describe('currency symbols', () => {
    it('handles various currency symbols', () => {
      expect(parseAmount('€100.00')).toBe(100);
      expect(parseAmount('£50.00')).toBe(50);
      expect(parseAmount('¥1000')).toBe(1000);
    });
  });

  describe('whitespace handling', () => {
    it('trims leading/trailing whitespace', () => {
      expect(parseAmount('  $42.00  ')).toBe(42);
      expect(parseAmount('\t$100.00\n')).toBe(100);
    });

    it('handles spaces around dollar sign', () => {
      expect(parseAmount('$ 42.00')).toBe(42);
    });
  });

  describe('edge cases', () => {
    it('returns NaN for empty string', () => {
      expect(parseAmount('')).toBeNaN();
    });

    it('returns NaN for whitespace only', () => {
      expect(parseAmount('   ')).toBeNaN();
    });

    it('returns NaN for non-numeric input', () => {
      expect(parseAmount('abc')).toBeNaN();
    });

    it('returns NaN for null-like input', () => {
      // @ts-expect-error — testing runtime safety
      expect(parseAmount(null)).toBeNaN();
      // @ts-expect-error — testing runtime safety
      expect(parseAmount(undefined)).toBeNaN();
    });

    it('handles zero correctly', () => {
      expect(parseAmount('$0.00')).toBe(0);
      expect(parseAmount('0')).toBe(0);
    });
  });
});

// ─── parseDate Tests ────────────────────────────────────────────────

describe('parseDate', () => {
  describe('ISO 8601 format', () => {
    it('passes through already-ISO dates', () => {
      expect(parseDate('2024-01-15')).toBe('2024-01-15');
      expect(parseDate('2024-12-31')).toBe('2024-12-31');
    });
  });

  describe('US date formats', () => {
    it('parses MM/DD/YYYY', () => {
      expect(parseDate('01/15/2024')).toBe('2024-01-15');
      expect(parseDate('12/31/2024')).toBe('2024-12-31');
    });

    it('parses M/D/YYYY (no leading zeros)', () => {
      expect(parseDate('1/5/2024')).toBe('2024-01-05');
      expect(parseDate('3/15/2024')).toBe('2024-03-15');
    });

    it('parses MM-DD-YYYY', () => {
      expect(parseDate('01-15-2024')).toBe('2024-01-15');
    });

    it('parses MM/DD/YY (2-digit year)', () => {
      expect(parseDate('01/15/24')).toBe('2024-01-15');
      expect(parseDate('06/30/25')).toBe('2025-06-30');
    });

    it('handles 2-digit years in the 1900s', () => {
      expect(parseDate('01/01/99')).toBe('1999-01-01');
      expect(parseDate('12/31/70')).toBe('1970-12-31');
    });
  });

  describe('named month formats', () => {
    it('parses "Mon DD, YYYY"', () => {
      expect(parseDate('Jan 15, 2024')).toBe('2024-01-15');
      expect(parseDate('Dec 31, 2024')).toBe('2024-12-31');
    });

    it('parses full month names', () => {
      expect(parseDate('January 15, 2024')).toBe('2024-01-15');
      expect(parseDate('December 1, 2024')).toBe('2024-12-01');
    });

    it('parses without comma', () => {
      expect(parseDate('Jan 15 2024')).toBe('2024-01-15');
    });

    it('is case insensitive', () => {
      expect(parseDate('JAN 15, 2024')).toBe('2024-01-15');
      expect(parseDate('jan 15, 2024')).toBe('2024-01-15');
    });
  });

  describe('edge cases', () => {
    it('returns empty string for empty input', () => {
      expect(parseDate('')).toBe('');
    });

    it('returns empty string for whitespace only', () => {
      expect(parseDate('   ')).toBe('');
    });

    it('returns empty string for unrecognized formats', () => {
      expect(parseDate('not a date')).toBe('');
      expect(parseDate('2024')).toBe('');
    });

    it('trims whitespace', () => {
      expect(parseDate('  01/15/2024  ')).toBe('2024-01-15');
    });

    it('returns empty string for null-like input', () => {
      // @ts-expect-error — testing runtime safety
      expect(parseDate(null)).toBe('');
      // @ts-expect-error — testing runtime safety
      expect(parseDate(undefined)).toBe('');
    });
  });
});

// ─── applyTransform Tests ───────────────────────────────────────────

describe('applyTransform', () => {
  it('applies trim transform', () => {
    expect(applyTransform('  hello  ', 'trim')).toBe('hello');
  });

  it('applies parseAmount transform (returns string)', () => {
    expect(applyTransform('$1,234.56', 'parseAmount')).toBe('1234.56');
    expect(applyTransform('-$42.00', 'parseAmount')).toBe('-42');
  });

  it('applies parseDate transform', () => {
    expect(applyTransform('01/15/2024', 'parseDate')).toBe('2024-01-15');
    expect(applyTransform('Jan 15, 2024', 'parseDate')).toBe('2024-01-15');
  });

  it('applies stripWhitespace transform', () => {
    expect(applyTransform('hello world', 'stripWhitespace')).toBe('helloworld');
    expect(applyTransform('  a  b  c  ', 'stripWhitespace')).toBe('abc');
  });

  it('applies maskAccountNumber transform', () => {
    expect(applyTransform('1234567890', 'maskAccountNumber')).toBe('****7890');
    expect(applyTransform('1234', 'maskAccountNumber')).toBe('1234');
    expect(applyTransform('123', 'maskAccountNumber')).toBe('123');
  });

  it('applies uppercase transform', () => {
    expect(applyTransform('hello', 'uppercase')).toBe('HELLO');
  });

  it('applies lowercase transform', () => {
    expect(applyTransform('HELLO', 'lowercase')).toBe('hello');
  });
});
