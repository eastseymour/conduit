/**
 * Extraction Transform Functions (CDT-14)
 *
 * Pure functions that transform raw extracted strings into structured values.
 * Each transform corresponds to a named ExtractorTransform type.
 *
 * Invariants:
 * - All transforms accept string input and return string output
 * - Transforms never throw — invalid input returns empty string or original
 * - parseAmount always returns a numeric string (no currency symbols)
 * - parseDate always returns ISO 8601 format (YYYY-MM-DD) or empty string
 */

import type { ExtractorTransform } from './types';

/**
 * Parse a currency string into a signed numeric value.
 *
 * Handles:
 * - Currency symbols: $, €, £, ¥
 * - Thousands separators: commas
 * - Negative indicators: leading minus, parentheses, trailing CR/DR
 * - Whitespace and non-breaking spaces
 *
 * Postcondition: returns a finite number, or NaN if unparseable.
 *
 * @example
 *   parseAmount('$1,234.56')    // 1234.56
 *   parseAmount('-$42.00')      // -42
 *   parseAmount('($100.00)')    // -100
 *   parseAmount('$50.00 CR')    // 50
 *   parseAmount('$50.00 DR')    // -50 (only if not already negative)
 */
export function parseAmount(raw: string): number {
  if (!raw || raw.trim().length === 0) return NaN;

  let text = raw.trim();

  // Detect negative indicators before stripping
  const isParenthesized = text.startsWith('(') && text.endsWith(')');
  const hasLeadingMinus = text.startsWith('-') || text.startsWith('−'); // regular minus or unicode minus
  const hasDR = /\bDR\b/i.test(text);
  const hasCR = /\bCR\b/i.test(text);

  // Strip currency symbols, spaces, and non-numeric chars (keep digits, dots, commas, minus)
  text = text.replace(/[()]/g, '');
  text = text.replace(/[$€£¥]/g, '');
  text = text.replace(/\bCR\b|\bDR\b/gi, '');
  text = text.replace(/[−–—]/g, '-'); // normalize unicode dashes to ASCII minus
  text = text.replace(/\s+/g, '');
  text = text.replace(/,/g, ''); // remove thousands separators

  // Extract the numeric value
  const match = text.match(/^-?\d+\.?\d*$/);
  if (!match) return NaN;

  let value = parseFloat(text);
  if (!Number.isFinite(value)) return NaN;

  // Apply sign based on detected indicators
  // Priority: parentheses > leading minus > DR/CR
  if (isParenthesized && value > 0) {
    value = -value;
  } else if (hasLeadingMinus && value > 0) {
    value = -value;
  } else if (hasDR && value > 0) {
    value = -value;
  }
  // CR is positive (credit) — no change needed since value is already positive

  return value;
}

/**
 * Parse a date string into ISO 8601 format (YYYY-MM-DD).
 *
 * Handles common US bank date formats:
 * - MM/DD/YYYY, MM-DD-YYYY
 * - Mon DD, YYYY (e.g., "Jan 15, 2024")
 * - YYYY-MM-DD (already ISO)
 * - MM/DD/YY (2-digit year, assumes 2000s)
 *
 * Postcondition: returns ISO date string or empty string if unparseable.
 */
export function parseDate(raw: string): string {
  if (!raw || raw.trim().length === 0) return '';

  const text = raw.trim();

  // Already ISO format: YYYY-MM-DD
  const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    return text;
  }

  // MM/DD/YYYY or MM-DD-YYYY
  const usFullMatch = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (usFullMatch) {
    const [, month, day, year] = usFullMatch;
    return `${year}-${pad2(month!)}-${pad2(day!)}`;
  }

  // MM/DD/YY (2-digit year)
  const usShortMatch = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2})$/);
  if (usShortMatch) {
    const [, month, day, yearShort] = usShortMatch;
    const year = parseInt(yearShort!, 10) >= 70 ? `19${yearShort}` : `20${pad2(yearShort!)}`;
    return `${year}-${pad2(month!)}-${pad2(day!)}`;
  }

  // "Mon DD, YYYY" or "Month DD, YYYY"
  const monthNames: Record<string, string> = {
    jan: '01', feb: '02', mar: '03', apr: '04',
    may: '05', jun: '06', jul: '07', aug: '08',
    sep: '09', oct: '10', nov: '11', dec: '12',
  };

  const namedMonthMatch = text.match(
    /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s+(\d{1,2}),?\s+(\d{4})$/i,
  );
  if (namedMonthMatch) {
    const monthAbbr = namedMonthMatch[1]!.toLowerCase().slice(0, 3);
    const month = monthNames[monthAbbr];
    if (month) {
      return `${namedMonthMatch[3]}-${month}-${pad2(namedMonthMatch[2]!)}`;
    }
  }

  return '';
}

/** Pad a numeric string to 2 digits with leading zero. */
function pad2(s: string): string {
  return s.length === 1 ? `0${s}` : s;
}

/**
 * Apply a named transform to a raw string value.
 *
 * @returns The transformed string, or the original if transform is unrecognized.
 */
export function applyTransform(value: string, transform: ExtractorTransform): string {
  switch (transform) {
    case 'trim':
      return value.trim();
    case 'parseAmount':
      // Return the numeric string representation
      return String(parseAmount(value));
    case 'parseDate':
      return parseDate(value);
    case 'stripWhitespace':
      return value.replace(/\s+/g, '');
    case 'maskAccountNumber': {
      const stripped = value.replace(/\s+/g, '');
      if (stripped.length <= 4) return stripped;
      return '****' + stripped.slice(-4);
    }
    case 'uppercase':
      return value.toUpperCase();
    case 'lowercase':
      return value.toLowerCase();
    default: {
      // Exhaustive check — if we reach here, a new transform was added but not handled
      const _exhaustive: never = transform;
      return value;
    }
  }
}
