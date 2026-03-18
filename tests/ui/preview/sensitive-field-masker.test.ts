/**
 * Tests for Sensitive Field Masker (CDT-4)
 */

import {
  generateMaskingScript,
  generateUnmaskingScript,
  parseMaskingResult,
  MASK_CLASS,
  PROCESSED_ATTR,
} from '../../../src/ui/preview/sensitive-field-masker';
import type { SensitiveFieldConfig } from '../../../src/ui/preview/types';
import { DEFAULT_SENSITIVE_FIELD_RULES } from '../../../src/ui/preview/types';

// ─── Script Generation Tests ─────────────────────────────────────────

describe('generateMaskingScript()', () => {
  const defaultConfig: SensitiveFieldConfig = {
    enabled: true,
    blurRadius: 8,
    rules: DEFAULT_SENSITIVE_FIELD_RULES,
  };

  it('returns an IIFE string', () => {
    const script = generateMaskingScript(defaultConfig);
    expect(script).toMatch(/^\(function\(\)/);
    expect(script).toMatch(/\)\(\)$/);
  });

  it('includes blur radius from config', () => {
    const script = generateMaskingScript(defaultConfig);
    expect(script).toContain('var BLUR_RADIUS = 8');
  });

  it('includes selectors from enabled rules', () => {
    const script = generateMaskingScript(defaultConfig);
    // JSON.stringify escapes inner quotes, so check for the escaped form
    expect(script).toContain('input[type=\\"password\\"]');
  });

  it('excludes disabled rules', () => {
    const config: SensitiveFieldConfig = {
      enabled: true,
      blurRadius: 8,
      rules: [
        { selector: 'input[type="password"]', label: 'Passwords', enabled: true },
        { selector: 'input[type="hidden"]', label: 'Hidden', enabled: false },
      ],
    };
    const script = generateMaskingScript(config);
    expect(script).toContain('input[type=\\"password\\"]');
    expect(script).not.toContain('input[type=\\"hidden\\"]');
  });

  it('returns no-op script when masking is disabled', () => {
    const config: SensitiveFieldConfig = {
      enabled: false,
      blurRadius: 8,
      rules: DEFAULT_SENSITIVE_FIELD_RULES,
    };
    const script = generateMaskingScript(config);
    expect(script).toContain('"maskedCount":0');
    expect(script).toContain('"success":true');
  });

  it('returns no-op script when no enabled rules', () => {
    const config: SensitiveFieldConfig = {
      enabled: true,
      blurRadius: 8,
      rules: [
        { selector: 'input[type="password"]', label: 'Passwords', enabled: false },
      ],
    };
    const script = generateMaskingScript(config);
    expect(script).toContain('"maskedCount":0');
    expect(script).toContain('"success":true');
  });

  it('uses the MASK_CLASS constant', () => {
    const script = generateMaskingScript(defaultConfig);
    expect(script).toContain(MASK_CLASS);
  });

  it('uses the PROCESSED_ATTR constant', () => {
    const script = generateMaskingScript(defaultConfig);
    expect(script).toContain(PROCESSED_ATTR);
  });

  it('creates style element with blur filter', () => {
    const script = generateMaskingScript(defaultConfig);
    expect(script).toContain('filter: blur(');
    expect(script).toContain('-webkit-filter: blur(');
    expect(script).toContain('pointer-events: none');
  });

  it('makes style creation idempotent via ID check', () => {
    const script = generateMaskingScript(defaultConfig);
    expect(script).toContain('__conduit_mask_style__');
    expect(script).toContain('getElementById');
  });

  it('handles custom blur radius', () => {
    const config: SensitiveFieldConfig = {
      enabled: true,
      blurRadius: 16,
      rules: [
        { selector: 'input[type="password"]', label: 'Passwords', enabled: true },
      ],
    };
    const script = generateMaskingScript(config);
    expect(script).toContain('var BLUR_RADIUS = 16');
  });

  it('clamps negative blur radius to 0', () => {
    const config: SensitiveFieldConfig = {
      enabled: true,
      blurRadius: -5,
      rules: [
        { selector: 'input[type="password"]', label: 'Passwords', enabled: true },
      ],
    };
    const script = generateMaskingScript(config);
    expect(script).toContain('var BLUR_RADIUS = 0');
  });

  it('skips rules with empty selectors', () => {
    const config: SensitiveFieldConfig = {
      enabled: true,
      blurRadius: 8,
      rules: [
        { selector: '', label: 'Empty', enabled: true },
        { selector: '   ', label: 'Whitespace', enabled: true },
        { selector: 'input[type="password"]', label: 'Passwords', enabled: true },
      ],
    };
    const script = generateMaskingScript(config);
    // Only the password selector should be included (escaped)
    expect(script).toContain('input[type=\\"password\\"]');
    // Verify the SELECTORS array only has one entry
    expect(script).toContain('var SELECTORS = ["input[type=\\"password\\"]"]');
  });

  it('wraps in try-catch for error handling', () => {
    const script = generateMaskingScript(defaultConfig);
    expect(script).toContain('try {');
    expect(script).toContain('catch (e)');
    expect(script).toContain('success: false');
  });
});

describe('generateUnmaskingScript()', () => {
  it('returns an IIFE string', () => {
    const script = generateUnmaskingScript();
    expect(script).toMatch(/^\(function\(\)/);
    expect(script).toMatch(/\)\(\)$/);
  });

  it('removes MASK_CLASS from elements', () => {
    const script = generateUnmaskingScript();
    expect(script).toContain('classList.remove');
    expect(script).toContain(MASK_CLASS);
  });

  it('removes PROCESSED_ATTR from elements', () => {
    const script = generateUnmaskingScript();
    expect(script).toContain('removeAttribute');
    expect(script).toContain(PROCESSED_ATTR);
  });

  it('removes the style element', () => {
    const script = generateUnmaskingScript();
    expect(script).toContain('__conduit_mask_style__');
    expect(script).toContain('.remove()');
  });

  it('returns result with unmaskedCount', () => {
    const script = generateUnmaskingScript();
    expect(script).toContain('unmaskedCount');
    expect(script).toContain('success');
  });

  it('wraps in try-catch', () => {
    const script = generateUnmaskingScript();
    expect(script).toContain('try {');
    expect(script).toContain('catch (e)');
  });
});

// ─── Result Parsing Tests ────────────────────────────────────────────

describe('parseMaskingResult()', () => {
  it('parses a valid JSON string result', () => {
    const raw = JSON.stringify({
      maskedCount: 3,
      matchedSelectors: ['input[type="password"]', 'input[name*="ssn"]'],
      success: true,
    });
    const result = parseMaskingResult(raw);
    expect(result.maskedCount).toBe(3);
    expect(result.matchedSelectors).toEqual([
      'input[type="password"]',
      'input[name*="ssn"]',
    ]);
    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('parses a valid object result', () => {
    const raw = {
      maskedCount: 1,
      matchedSelectors: ['input[type="hidden"]'],
      success: true,
    };
    const result = parseMaskingResult(raw);
    expect(result.maskedCount).toBe(1);
    expect(result.success).toBe(true);
  });

  it('handles null result', () => {
    const result = parseMaskingResult(null);
    expect(result.maskedCount).toBe(0);
    expect(result.success).toBe(false);
    expect(result.error).toBe('No result from masking script');
  });

  it('handles undefined result', () => {
    const result = parseMaskingResult(undefined);
    expect(result.maskedCount).toBe(0);
    expect(result.success).toBe(false);
  });

  it('handles error result', () => {
    const raw = JSON.stringify({
      maskedCount: 0,
      matchedSelectors: [],
      success: false,
      error: 'Something went wrong',
    });
    const result = parseMaskingResult(raw);
    expect(result.success).toBe(false);
    expect(result.error).toBe('Something went wrong');
  });

  it('handles malformed JSON string', () => {
    const result = parseMaskingResult('not valid json');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Failed to parse masking result');
  });

  it('handles missing fields gracefully', () => {
    const raw = JSON.stringify({ success: true });
    const result = parseMaskingResult(raw);
    expect(result.maskedCount).toBe(0);
    expect(result.matchedSelectors).toEqual([]);
    expect(result.success).toBe(true);
  });

  it('handles non-array matchedSelectors', () => {
    const raw = JSON.stringify({
      maskedCount: 1,
      matchedSelectors: 'not an array',
      success: true,
    });
    const result = parseMaskingResult(raw);
    expect(result.matchedSelectors).toEqual([]);
  });

  it('handles non-number maskedCount', () => {
    const raw = JSON.stringify({
      maskedCount: 'not a number',
      matchedSelectors: [],
      success: true,
    });
    const result = parseMaskingResult(raw);
    expect(result.maskedCount).toBe(0);
  });
});

// ─── Constants Tests ─────────────────────────────────────────────────

describe('MASK_CLASS', () => {
  it('is a non-empty string', () => {
    expect(MASK_CLASS).toBeTruthy();
    expect(typeof MASK_CLASS).toBe('string');
  });

  it('has a unique prefix to avoid CSS collisions', () => {
    expect(MASK_CLASS).toContain('__conduit');
  });
});

describe('PROCESSED_ATTR', () => {
  it('is a valid data attribute', () => {
    expect(PROCESSED_ATTR).toMatch(/^data-/);
  });
});
