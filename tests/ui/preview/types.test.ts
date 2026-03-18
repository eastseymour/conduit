/**
 * Tests for Visual Browser Preview types (CDT-4)
 */

import {
  PreviewPosition,
  PreviewDisplayMode,
  TransitionType,
  TransitionPhase,
  pixels,
  percentage,
  createPreviewSize,
  resolveDimension,
  isValidTransitionPhaseChange,
  assertValidTransitionPhaseChange,
  validateBrowserPreviewConfig,
  assertValidBrowserPreviewConfig,
  DEFAULT_BROWSER_PREVIEW_CONFIG,
  DEFAULT_SENSITIVE_FIELD_RULES,
  type BrowserPreviewConfig,
  type PreviewDimension,
} from '../../../src/ui/preview/types';

// ─── Const Enum Tests ────────────────────────────────────────────────

describe('PreviewPosition', () => {
  it('has expected values', () => {
    expect(PreviewPosition.BottomSheet).toBe('bottom_sheet');
    expect(PreviewPosition.Inline).toBe('inline');
    expect(PreviewPosition.Modal).toBe('modal');
  });

  it('is exhaustive (3 positions)', () => {
    const values = Object.values(PreviewPosition);
    expect(values).toHaveLength(3);
  });
});

describe('PreviewDisplayMode', () => {
  it('has expected values', () => {
    expect(PreviewDisplayMode.Collapsed).toBe('collapsed');
    expect(PreviewDisplayMode.Expanded).toBe('expanded');
  });

  it('is exhaustive (2 modes)', () => {
    const values = Object.values(PreviewDisplayMode);
    expect(values).toHaveLength(2);
  });
});

describe('TransitionType', () => {
  it('has expected values', () => {
    expect(TransitionType.Fade).toBe('fade');
    expect(TransitionType.SlideLeft).toBe('slide_left');
    expect(TransitionType.None).toBe('none');
  });

  it('is exhaustive (3 types)', () => {
    const values = Object.values(TransitionType);
    expect(values).toHaveLength(3);
  });
});

describe('TransitionPhase', () => {
  it('has expected values', () => {
    expect(TransitionPhase.Idle).toBe('idle');
    expect(TransitionPhase.Transitioning).toBe('transitioning');
    expect(TransitionPhase.Complete).toBe('complete');
  });
});

// ─── Dimension Factory Tests ─────────────────────────────────────────

describe('pixels()', () => {
  it('creates a pixel dimension', () => {
    const dim = pixels(300);
    expect(dim).toEqual({ type: 'pixels', value: 300 });
  });

  it('accepts fractional values', () => {
    const dim = pixels(150.5);
    expect(dim.type).toBe('pixels');
    expect(dim.value).toBe(150.5);
  });

  it('throws for zero value', () => {
    expect(() => pixels(0)).toThrow('Pixel dimension must be positive');
  });

  it('throws for negative value', () => {
    expect(() => pixels(-100)).toThrow('Pixel dimension must be positive');
  });
});

describe('percentage()', () => {
  it('creates a percentage dimension', () => {
    const dim = percentage(100);
    expect(dim).toEqual({ type: 'percentage', value: 100 });
  });

  it('accepts fractional percentages', () => {
    const dim = percentage(50.5);
    expect(dim.type).toBe('percentage');
    expect(dim.value).toBe(50.5);
  });

  it('throws for zero value', () => {
    expect(() => percentage(0)).toThrow('Percentage must be in (0, 100]');
  });

  it('throws for value > 100', () => {
    expect(() => percentage(101)).toThrow('Percentage must be in (0, 100]');
  });

  it('throws for negative value', () => {
    expect(() => percentage(-50)).toThrow('Percentage must be in (0, 100]');
  });
});

describe('createPreviewSize()', () => {
  it('creates a size from two dimensions', () => {
    const w = pixels(300);
    const h = pixels(200);
    const size = createPreviewSize(w, h);
    expect(size.width).toEqual(w);
    expect(size.height).toEqual(h);
  });

  it('works with mixed dimension types', () => {
    const size = createPreviewSize(percentage(80), pixels(200));
    expect(size.width.type).toBe('percentage');
    expect(size.height.type).toBe('pixels');
  });
});

describe('resolveDimension()', () => {
  it('resolves pixel dimensions directly', () => {
    expect(resolveDimension(pixels(300), 1000)).toBe(300);
  });

  it('resolves percentage dimensions relative to parent', () => {
    expect(resolveDimension(percentage(50), 1000)).toBe(500);
  });

  it('rounds percentage results', () => {
    expect(resolveDimension(percentage(33), 100)).toBe(33);
    expect(resolveDimension(percentage(33), 1000)).toBe(330);
  });

  it('handles 100% of parent', () => {
    expect(resolveDimension(percentage(100), 800)).toBe(800);
  });
});

// ─── Transition Phase Validation ─────────────────────────────────────

describe('isValidTransitionPhaseChange()', () => {
  it('allows idle → transitioning', () => {
    expect(isValidTransitionPhaseChange('idle', 'transitioning')).toBe(true);
  });

  it('allows transitioning → complete', () => {
    expect(isValidTransitionPhaseChange('transitioning', 'complete')).toBe(true);
  });

  it('allows complete → idle', () => {
    expect(isValidTransitionPhaseChange('complete', 'idle')).toBe(true);
  });

  it('rejects idle → complete', () => {
    expect(isValidTransitionPhaseChange('idle', 'complete')).toBe(false);
  });

  it('rejects idle → idle', () => {
    expect(isValidTransitionPhaseChange('idle', 'idle')).toBe(false);
  });

  it('rejects complete → transitioning', () => {
    expect(isValidTransitionPhaseChange('complete', 'transitioning')).toBe(false);
  });

  it('rejects transitioning → idle', () => {
    expect(isValidTransitionPhaseChange('transitioning', 'idle')).toBe(false);
  });
});

describe('assertValidTransitionPhaseChange()', () => {
  it('does not throw for valid transitions', () => {
    expect(() =>
      assertValidTransitionPhaseChange('idle', 'transitioning'),
    ).not.toThrow();
  });

  it('throws for invalid transitions', () => {
    expect(() =>
      assertValidTransitionPhaseChange('idle', 'complete'),
    ).toThrow('Invalid transition phase change: idle → complete');
  });
});

// ─── Configuration Validation ────────────────────────────────────────

describe('validateBrowserPreviewConfig()', () => {
  it('validates default config as valid', () => {
    const result = validateBrowserPreviewConfig(DEFAULT_BROWSER_PREVIEW_CONFIG);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects negative collapsed width', () => {
    const config: BrowserPreviewConfig = {
      ...DEFAULT_BROWSER_PREVIEW_CONFIG,
      collapsedSize: {
        width: { type: 'pixels', value: -1 },
        height: { type: 'pixels', value: 200 },
      },
    };
    const result = validateBrowserPreviewConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('collapsedSize.width must be positive');
  });

  it('rejects negative collapsed height', () => {
    const config: BrowserPreviewConfig = {
      ...DEFAULT_BROWSER_PREVIEW_CONFIG,
      collapsedSize: {
        width: { type: 'pixels', value: 300 },
        height: { type: 'pixels', value: 0 },
      },
    };
    const result = validateBrowserPreviewConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('collapsedSize.height must be positive');
  });

  it('rejects negative transition duration', () => {
    const config: BrowserPreviewConfig = {
      ...DEFAULT_BROWSER_PREVIEW_CONFIG,
      transitionDurationMs: -100,
    };
    const result = validateBrowserPreviewConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('transitionDurationMs must be non-negative');
  });

  it('rejects scale factor > 1', () => {
    const config: BrowserPreviewConfig = {
      ...DEFAULT_BROWSER_PREVIEW_CONFIG,
      scaleFactor: 1.5,
    };
    const result = validateBrowserPreviewConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('scaleFactor must be in (0.0, 1.0]');
  });

  it('rejects scale factor = 0', () => {
    const config: BrowserPreviewConfig = {
      ...DEFAULT_BROWSER_PREVIEW_CONFIG,
      scaleFactor: 0,
    };
    const result = validateBrowserPreviewConfig(config);
    expect(result.valid).toBe(false);
  });

  it('rejects empty rules when masking enabled', () => {
    const config: BrowserPreviewConfig = {
      ...DEFAULT_BROWSER_PREVIEW_CONFIG,
      sensitiveFieldConfig: {
        enabled: true,
        blurRadius: 8,
        rules: [],
      },
    };
    const result = validateBrowserPreviewConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      'sensitiveFieldConfig.rules must contain at least one rule when enabled',
    );
  });

  it('accepts empty rules when masking disabled', () => {
    const config: BrowserPreviewConfig = {
      ...DEFAULT_BROWSER_PREVIEW_CONFIG,
      sensitiveFieldConfig: {
        enabled: false,
        blurRadius: 8,
        rules: [],
      },
    };
    const result = validateBrowserPreviewConfig(config);
    expect(result.valid).toBe(true);
  });

  it('rejects negative blur radius', () => {
    const config: BrowserPreviewConfig = {
      ...DEFAULT_BROWSER_PREVIEW_CONFIG,
      sensitiveFieldConfig: {
        ...DEFAULT_BROWSER_PREVIEW_CONFIG.sensitiveFieldConfig,
        blurRadius: -1,
      },
    };
    const result = validateBrowserPreviewConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      'sensitiveFieldConfig.blurRadius must be non-negative',
    );
  });

  it('rejects rules with empty selectors', () => {
    const config: BrowserPreviewConfig = {
      ...DEFAULT_BROWSER_PREVIEW_CONFIG,
      sensitiveFieldConfig: {
        enabled: true,
        blurRadius: 8,
        rules: [{ selector: '', label: 'Test', enabled: true }],
      },
    };
    const result = validateBrowserPreviewConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      'sensitiveFieldConfig.rules[0].selector must be non-empty',
    );
  });

  it('rejects rules with empty labels', () => {
    const config: BrowserPreviewConfig = {
      ...DEFAULT_BROWSER_PREVIEW_CONFIG,
      sensitiveFieldConfig: {
        enabled: true,
        blurRadius: 8,
        rules: [{ selector: 'input[type="password"]', label: '', enabled: true }],
      },
    };
    const result = validateBrowserPreviewConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      'sensitiveFieldConfig.rules[0].label must be non-empty',
    );
  });
});

describe('assertValidBrowserPreviewConfig()', () => {
  it('does not throw for valid config', () => {
    expect(() =>
      assertValidBrowserPreviewConfig(DEFAULT_BROWSER_PREVIEW_CONFIG),
    ).not.toThrow();
  });

  it('throws for invalid config', () => {
    const config: BrowserPreviewConfig = {
      ...DEFAULT_BROWSER_PREVIEW_CONFIG,
      scaleFactor: 0,
    };
    expect(() => assertValidBrowserPreviewConfig(config)).toThrow(
      'Invalid BrowserPreviewConfig',
    );
  });
});

// ─── Default Config Tests ────────────────────────────────────────────

describe('DEFAULT_BROWSER_PREVIEW_CONFIG', () => {
  it('has 300x200 collapsed size', () => {
    expect(DEFAULT_BROWSER_PREVIEW_CONFIG.collapsedSize).toEqual({
      width: { type: 'pixels', value: 300 },
      height: { type: 'pixels', value: 200 },
    });
  });

  it('has 100%x100% expanded size', () => {
    expect(DEFAULT_BROWSER_PREVIEW_CONFIG.expandedSize).toEqual({
      width: { type: 'percentage', value: 100 },
      height: { type: 'percentage', value: 100 },
    });
  });

  it('defaults to bottom_sheet position', () => {
    expect(DEFAULT_BROWSER_PREVIEW_CONFIG.position).toBe('bottom_sheet');
  });

  it('defaults to collapsed display mode', () => {
    expect(DEFAULT_BROWSER_PREVIEW_CONFIG.initialDisplayMode).toBe('collapsed');
  });

  it('defaults to fade transition', () => {
    expect(DEFAULT_BROWSER_PREVIEW_CONFIG.transitionType).toBe('fade');
  });

  it('defaults to 300ms transition duration', () => {
    expect(DEFAULT_BROWSER_PREVIEW_CONFIG.transitionDurationMs).toBe(300);
  });

  it('defaults to 1.0 scale factor', () => {
    expect(DEFAULT_BROWSER_PREVIEW_CONFIG.scaleFactor).toBe(1.0);
  });

  it('has sensitive field masking enabled by default', () => {
    expect(DEFAULT_BROWSER_PREVIEW_CONFIG.sensitiveFieldConfig.enabled).toBe(true);
  });

  it('defaults to 8px blur radius', () => {
    expect(DEFAULT_BROWSER_PREVIEW_CONFIG.sensitiveFieldConfig.blurRadius).toBe(8);
  });
});

describe('DEFAULT_SENSITIVE_FIELD_RULES', () => {
  it('includes password fields', () => {
    const passwordRule = DEFAULT_SENSITIVE_FIELD_RULES.find(
      (r) => r.selector === 'input[type="password"]',
    );
    expect(passwordRule).toBeDefined();
    expect(passwordRule!.enabled).toBe(true);
  });

  it('includes hidden fields', () => {
    const hiddenRule = DEFAULT_SENSITIVE_FIELD_RULES.find(
      (r) => r.selector === 'input[type="hidden"]',
    );
    expect(hiddenRule).toBeDefined();
  });

  it('includes credit card number fields', () => {
    const ccRule = DEFAULT_SENSITIVE_FIELD_RULES.find(
      (r) => r.selector === 'input[autocomplete="cc-number"]',
    );
    expect(ccRule).toBeDefined();
  });

  it('has at least 5 rules', () => {
    expect(DEFAULT_SENSITIVE_FIELD_RULES.length).toBeGreaterThanOrEqual(5);
  });

  it('all rules are enabled by default', () => {
    for (const rule of DEFAULT_SENSITIVE_FIELD_RULES) {
      expect(rule.enabled).toBe(true);
    }
  });

  it('all rules have non-empty selectors', () => {
    for (const rule of DEFAULT_SENSITIVE_FIELD_RULES) {
      expect(rule.selector.length).toBeGreaterThan(0);
    }
  });

  it('all rules have non-empty labels', () => {
    for (const rule of DEFAULT_SENSITIVE_FIELD_RULES) {
      expect(rule.label.length).toBeGreaterThan(0);
    }
  });
});
