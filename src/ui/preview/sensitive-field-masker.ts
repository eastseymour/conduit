/**
 * Sensitive Field Masker — Detects and blurs sensitive fields in the preview.
 *
 * Generates JavaScript injection scripts to detect password inputs,
 * credit card fields, SSN inputs, and other sensitive data in the
 * WebView, then applies CSS blur filters to mask them in the preview.
 *
 * Design: "Specify then implement"
 * - Configuration is validated before use
 * - Injection script is deterministic (same config → same script)
 * - Results are structured and typed
 *
 * Invariants:
 * 1. Only enabled rules are included in the injection script
 * 2. Blur radius is always non-negative
 * 3. Injection script is self-contained — no external dependencies
 * 4. Script is idempotent — running it multiple times is safe
 * 5. Script does not modify DOM structure, only applies CSS filters
 */

import type {
  SensitiveFieldConfig,
  SensitiveFieldRule,
  SensitiveFieldMaskResult,
} from './types';

// ─── Script Generation ───────────────────────────────────────────────

/**
 * CSS class applied to masked elements.
 * Uses a unique prefix to avoid collisions with bank page styles.
 */
const MASK_CLASS = '__conduit_sensitive_masked__';

/**
 * Data attribute to mark elements that have been processed.
 * Prevents re-processing on subsequent calls (idempotency).
 */
const PROCESSED_ATTR = 'data-conduit-masked';

/**
 * Generate the JavaScript injection script for sensitive field masking.
 *
 * The generated script:
 * 1. Creates a <style> element with blur CSS (idempotent via ID check)
 * 2. Queries all elements matching enabled rules' selectors
 * 3. Applies the mask class to matched elements
 * 4. Returns a result object with maskedCount and matchedSelectors
 *
 * @precondition config.blurRadius >= 0
 * @postcondition returned script is a self-contained IIFE that returns JSON
 */
export function generateMaskingScript(config: SensitiveFieldConfig): string {
  if (!config.enabled) {
    return `(function() { return ${JSON.stringify({
      maskedCount: 0,
      matchedSelectors: [],
      success: true,
    })}; })()`;
  }

  const enabledRules = config.rules.filter(
    (rule: SensitiveFieldRule) => rule.enabled && rule.selector.trim().length > 0,
  );

  if (enabledRules.length === 0) {
    return `(function() { return ${JSON.stringify({
      maskedCount: 0,
      matchedSelectors: [],
      success: true,
    })}; })()`;
  }

  const blurRadius = Math.max(0, config.blurRadius);
  const selectorsJson = JSON.stringify(
    enabledRules.map((r: SensitiveFieldRule) => r.selector),
  );

  // The script is an IIFE that returns a JSON result object.
  // It is designed to be injected via WebView.injectJavaScript().
  return `(function() {
  try {
    var MASK_CLASS = ${JSON.stringify(MASK_CLASS)};
    var PROCESSED_ATTR = ${JSON.stringify(PROCESSED_ATTR)};
    var BLUR_RADIUS = ${blurRadius};
    var SELECTORS = ${selectorsJson};

    // Create or update style element (idempotent)
    var styleId = '__conduit_mask_style__';
    var existingStyle = document.getElementById(styleId);
    if (!existingStyle) {
      var style = document.createElement('style');
      style.id = styleId;
      style.textContent = '.' + MASK_CLASS + ' { filter: blur(' + BLUR_RADIUS + 'px) !important; -webkit-filter: blur(' + BLUR_RADIUS + 'px) !important; pointer-events: none !important; user-select: none !important; -webkit-user-select: none !important; }';
      document.head.appendChild(style);
    }

    var maskedCount = 0;
    var matchedSelectors = [];

    for (var i = 0; i < SELECTORS.length; i++) {
      var selector = SELECTORS[i];
      try {
        var elements = document.querySelectorAll(selector);
        if (elements.length > 0) {
          matchedSelectors.push(selector);
          for (var j = 0; j < elements.length; j++) {
            var el = elements[j];
            if (!el.getAttribute(PROCESSED_ATTR)) {
              el.classList.add(MASK_CLASS);
              el.setAttribute(PROCESSED_ATTR, 'true');
              maskedCount++;
            }
          }
        }
      } catch (selectorError) {
        // Skip invalid selectors silently
      }
    }

    return JSON.stringify({
      maskedCount: maskedCount,
      matchedSelectors: matchedSelectors,
      success: true
    });
  } catch (e) {
    return JSON.stringify({
      maskedCount: 0,
      matchedSelectors: [],
      success: false,
      error: e.message || String(e)
    });
  }
})()`;
}

/**
 * Generate a script that removes all sensitive field masks.
 * Used when the user expands the preview (if policy allows)
 * or when navigating away from a page.
 */
export function generateUnmaskingScript(): string {
  return `(function() {
  try {
    var MASK_CLASS = ${JSON.stringify(MASK_CLASS)};
    var PROCESSED_ATTR = ${JSON.stringify(PROCESSED_ATTR)};

    var elements = document.querySelectorAll('.' + MASK_CLASS);
    var count = 0;
    for (var i = 0; i < elements.length; i++) {
      elements[i].classList.remove(MASK_CLASS);
      elements[i].removeAttribute(PROCESSED_ATTR);
      count++;
    }

    var style = document.getElementById('__conduit_mask_style__');
    if (style) {
      style.remove();
    }

    return JSON.stringify({ unmaskedCount: count, success: true });
  } catch (e) {
    return JSON.stringify({ unmaskedCount: 0, success: false, error: e.message || String(e) });
  }
})()`;
}

// ─── Result Parsing ──────────────────────────────────────────────────

/**
 * Parse the raw result from the masking script injection.
 *
 * @precondition rawResult is a JSON string or null/undefined
 * @postcondition returns a well-formed SensitiveFieldMaskResult
 */
export function parseMaskingResult(
  rawResult: unknown,
): SensitiveFieldMaskResult {
  if (rawResult === null || rawResult === undefined) {
    return {
      maskedCount: 0,
      matchedSelectors: [],
      success: false,
      error: 'No result from masking script',
    };
  }

  try {
    const parsed =
      typeof rawResult === 'string'
        ? (JSON.parse(rawResult) as Record<string, unknown>)
        : (rawResult as Record<string, unknown>);

    return {
      maskedCount: typeof parsed['maskedCount'] === 'number' ? parsed['maskedCount'] : 0,
      matchedSelectors: Array.isArray(parsed['matchedSelectors'])
        ? (parsed['matchedSelectors'] as string[])
        : [],
      success: parsed['success'] === true,
      error: typeof parsed['error'] === 'string' ? parsed['error'] : undefined,
    };
  } catch {
    return {
      maskedCount: 0,
      matchedSelectors: [],
      success: false,
      error: `Failed to parse masking result: ${String(rawResult)}`,
    };
  }
}

// ─── Exported Constants ──────────────────────────────────────────────

export { MASK_CLASS, PROCESSED_ATTR };
