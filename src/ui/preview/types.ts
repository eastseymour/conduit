/**
 * Visual Browser Preview — Type Definitions (CDT-4)
 *
 * Types for the minimized live browser preview that shows real-time
 * bank navigation in a configurable mini view.
 *
 * Design: "Make illegal states unrepresentable"
 * - PreviewPosition is a const enum — no freeform strings
 * - PreviewDisplayMode is a discriminated union (collapsed vs expanded)
 * - PreviewSize supports both fixed pixels and percentage-based sizing
 * - TransitionPhase is a strict state machine with validated transitions
 * - SensitiveFieldRule uses readonly properties to prevent mutation
 *
 * Invariants:
 * 1. PreviewSize dimensions must be positive (width > 0, height > 0)
 * 2. PreviewDisplayMode is always one of 'collapsed' | 'expanded'
 * 3. TransitionPhase follows: idle → transitioning → complete → idle
 * 4. opacity is always in [0.0, 1.0]
 * 5. Sensitive field selectors must be non-empty CSS selector strings
 */

import type { NavigationState } from '../../types/navigation';

// ─── Preview Position ────────────────────────────────────────────────

/**
 * Where the preview is displayed within the host app.
 */
export const PreviewPosition = {
  /** Slides up from the bottom of the screen */
  BottomSheet: 'bottom_sheet',
  /** Renders inline within the component tree */
  Inline: 'inline',
  /** Full-screen modal overlay */
  Modal: 'modal',
} as const;

export type PreviewPositionName = (typeof PreviewPosition)[keyof typeof PreviewPosition];

// ─── Preview Display Mode ────────────────────────────────────────────

/**
 * Whether the preview is collapsed (thumbnail) or expanded (full view).
 */
export const PreviewDisplayMode = {
  Collapsed: 'collapsed',
  Expanded: 'expanded',
} as const;

export type PreviewDisplayModeName = (typeof PreviewDisplayMode)[keyof typeof PreviewDisplayMode];

// ─── Preview Size ────────────────────────────────────────────────────

/**
 * Dimension value — either a fixed pixel count or a percentage of parent.
 * Discriminated union prevents mixing pixels and percents accidentally.
 */
export type PreviewDimension =
  | { readonly type: 'pixels'; readonly value: number }
  | { readonly type: 'percentage'; readonly value: number };

/**
 * Size configuration for the preview container.
 *
 * Invariant: Both width and height values must be positive.
 */
export interface PreviewSize {
  readonly width: PreviewDimension;
  readonly height: PreviewDimension;
}

// ─── Page Transition ─────────────────────────────────────────────────

/**
 * Animation type for transitions between pages.
 */
export const TransitionType = {
  /** Cross-fade between old and new page */
  Fade: 'fade',
  /** Slide the new page in from the right */
  SlideLeft: 'slide_left',
  /** No animation — instant swap */
  None: 'none',
} as const;

export type TransitionTypeName = (typeof TransitionType)[keyof typeof TransitionType];

/**
 * Phase of a page transition animation.
 *
 * State machine: idle → transitioning → complete → idle
 */
export const TransitionPhase = {
  Idle: 'idle',
  Transitioning: 'transitioning',
  Complete: 'complete',
} as const;

export type TransitionPhaseName = (typeof TransitionPhase)[keyof typeof TransitionPhase];

/**
 * Valid transition phase changes.
 */
const VALID_TRANSITION_PHASE_CHANGES: Record<TransitionPhaseName, readonly TransitionPhaseName[]> =
  {
    [TransitionPhase.Idle]: [TransitionPhase.Transitioning],
    [TransitionPhase.Transitioning]: [TransitionPhase.Complete],
    [TransitionPhase.Complete]: [TransitionPhase.Idle],
  } as const;

/**
 * Check if a transition phase change is valid.
 */
export function isValidTransitionPhaseChange(
  from: TransitionPhaseName,
  to: TransitionPhaseName,
): boolean {
  const allowed = VALID_TRANSITION_PHASE_CHANGES[from];
  return allowed.includes(to);
}

/**
 * Assert a transition phase change is valid.
 */
export function assertValidTransitionPhaseChange(
  from: TransitionPhaseName,
  to: TransitionPhaseName,
): void {
  if (!isValidTransitionPhaseChange(from, to)) {
    throw new Error(
      `Invalid transition phase change: ${from} → ${to}. ` +
        `Valid from ${from}: [${VALID_TRANSITION_PHASE_CHANGES[from].join(', ')}]`,
    );
  }
}

// ─── Transition State ────────────────────────────────────────────────

/**
 * Complete state of a page transition animation.
 * Discriminated union on `phase`.
 */
export type TransitionState =
  | TransitionIdleState
  | TransitionTransitioningState
  | TransitionCompleteState;

export interface TransitionIdleState {
  readonly phase: typeof TransitionPhase.Idle;
}

export interface TransitionTransitioningState {
  readonly phase: typeof TransitionPhase.Transitioning;
  /** The URL being navigated away from */
  readonly fromUrl: string | null;
  /** The URL being navigated to */
  readonly toUrl: string;
  /** Animation type being used */
  readonly animationType: TransitionTypeName;
  /** Progress of the animation [0.0, 1.0] */
  readonly progress: number;
  /** Timestamp when transition started */
  readonly startedAt: number;
  /** Duration of the transition in ms */
  readonly durationMs: number;
}

export interface TransitionCompleteState {
  readonly phase: typeof TransitionPhase.Complete;
  /** The URL that was navigated to */
  readonly url: string;
  /** Timestamp when transition completed */
  readonly completedAt: number;
}

// ─── Sensitive Field Masking ─────────────────────────────────────────

/**
 * A rule for identifying and masking sensitive fields in the preview.
 */
export interface SensitiveFieldRule {
  /** CSS selector to match sensitive elements */
  readonly selector: string;
  /** Human-readable label for this rule (e.g. "Password fields") */
  readonly label: string;
  /** Whether this rule is enabled. Default: true */
  readonly enabled: boolean;
}

/**
 * Configuration for sensitive field masking.
 *
 * Invariant: rules array must contain at least one rule.
 */
export interface SensitiveFieldConfig {
  /** Whether masking is enabled globally */
  readonly enabled: boolean;
  /** CSS blur radius for masked fields (in pixels). Default: 8 */
  readonly blurRadius: number;
  /** Rules for identifying sensitive fields */
  readonly rules: readonly SensitiveFieldRule[];
}

/**
 * Result of applying sensitive field masking to a page.
 */
export interface SensitiveFieldMaskResult {
  /** Number of fields that were masked */
  readonly maskedCount: number;
  /** CSS selectors that were matched */
  readonly matchedSelectors: readonly string[];
  /** Whether the masking was applied successfully */
  readonly success: boolean;
  /** Error message if masking failed */
  readonly error?: string;
}

// ─── Browser Preview Configuration ───────────────────────────────────

/**
 * Full configuration for the visual browser preview.
 *
 * Invariants:
 * 1. collapsedSize dimensions must be positive
 * 2. expandedSize dimensions must be positive
 * 3. transitionDurationMs must be non-negative
 * 4. scaleFactor must be in (0.0, 1.0]
 */
export interface BrowserPreviewConfig {
  /** Size when collapsed (thumbnail view). Default: 300x200 pixels */
  readonly collapsedSize: PreviewSize;
  /** Size when expanded. Default: 100% × 100% of parent */
  readonly expandedSize: PreviewSize;
  /** Where to render the preview. Default: 'bottom_sheet' */
  readonly position: PreviewPositionName;
  /** Initial display mode. Default: 'collapsed' */
  readonly initialDisplayMode: PreviewDisplayModeName;
  /** Page transition animation type. Default: 'fade' */
  readonly transitionType: TransitionTypeName;
  /** Duration of page transitions in ms. Default: 300 */
  readonly transitionDurationMs: number;
  /** Scale factor for the thumbnail view (0.0, 1.0]. Default: 1.0 (native scaling) */
  readonly scaleFactor: number;
  /** Sensitive field masking configuration */
  readonly sensitiveFieldConfig: SensitiveFieldConfig;
  /** Whether the preview is initially visible. Default: true */
  readonly visible: boolean;
}

// ─── Browser Preview State ───────────────────────────────────────────

/**
 * Complete state of the browser preview.
 * This is the single source of truth for the preview UI.
 */
export interface BrowserPreviewState {
  /** Current display mode (collapsed or expanded) */
  readonly displayMode: PreviewDisplayModeName;
  /** Whether the preview is visible */
  readonly visible: boolean;
  /** Position of the preview */
  readonly position: PreviewPositionName;
  /** Current size based on display mode */
  readonly currentSize: PreviewSize;
  /** Current URL being displayed (null if no page loaded) */
  readonly currentUrl: string | null;
  /** Navigation state from the browser engine */
  readonly navigationState: NavigationState;
  /** Current page transition animation state */
  readonly transition: TransitionState;
  /** Result of the most recent sensitive field masking */
  readonly sensitiveFieldMask: SensitiveFieldMaskResult | null;
  /** Whether the browser is currently loading a page */
  readonly isLoading: boolean;
  /** Whether the preview can be expanded (not during transitions) */
  readonly canExpand: boolean;
  /** Whether the preview can be collapsed (must be expanded first) */
  readonly canCollapse: boolean;
  /** Scale factor for the thumbnail view */
  readonly scaleFactor: number;
}

// ─── Browser Preview Events ──────────────────────────────────────────

/**
 * Events emitted by the browser preview controller.
 * Discriminated union on `type`.
 */
export type BrowserPreviewEvent =
  | BrowserPreviewStateChangeEvent
  | BrowserPreviewNavigationEvent
  | BrowserPreviewTransitionEvent
  | BrowserPreviewMaskEvent
  | BrowserPreviewToggleEvent;

export interface BrowserPreviewStateChangeEvent {
  readonly type: 'state_change';
  readonly state: BrowserPreviewState;
  readonly timestamp: number;
}

export interface BrowserPreviewNavigationEvent {
  readonly type: 'navigation';
  readonly url: string;
  readonly previousUrl: string | null;
  readonly timestamp: number;
}

export interface BrowserPreviewTransitionEvent {
  readonly type: 'transition';
  readonly transition: TransitionState;
  readonly timestamp: number;
}

export interface BrowserPreviewMaskEvent {
  readonly type: 'mask_applied';
  readonly result: SensitiveFieldMaskResult;
  readonly timestamp: number;
}

export interface BrowserPreviewToggleEvent {
  readonly type: 'toggle';
  readonly displayMode: PreviewDisplayModeName;
  readonly timestamp: number;
}

export type BrowserPreviewEventListener = (event: BrowserPreviewEvent) => void;

// ─── Factory Functions ───────────────────────────────────────────────

/**
 * Create a pixel-based dimension.
 * @precondition value > 0
 */
export function pixels(value: number): PreviewDimension {
  assert(value > 0, `Pixel dimension must be positive, got ${value}`);
  return { type: 'pixels', value };
}

/**
 * Create a percentage-based dimension.
 * @precondition value > 0 && value <= 100
 */
export function percentage(value: number): PreviewDimension {
  assert(value > 0 && value <= 100, `Percentage must be in (0, 100], got ${value}`);
  return { type: 'percentage', value };
}

/**
 * Create a PreviewSize from width and height dimensions.
 */
export function createPreviewSize(width: PreviewDimension, height: PreviewDimension): PreviewSize {
  return { width, height };
}

/**
 * Resolve a dimension to a pixel value given a parent size.
 */
export function resolveDimension(dimension: PreviewDimension, parentSize: number): number {
  switch (dimension.type) {
    case 'pixels':
      return dimension.value;
    case 'percentage':
      return Math.round((dimension.value / 100) * parentSize);
    default: {
      const _exhaustive: never = dimension;
      throw new Error(`Unknown dimension type: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

// ─── Default Configuration ───────────────────────────────────────────

/** Default sensitive field masking rules */
export const DEFAULT_SENSITIVE_FIELD_RULES: readonly SensitiveFieldRule[] = [
  { selector: 'input[type="password"]', label: 'Password fields', enabled: true },
  { selector: 'input[type="hidden"]', label: 'Hidden fields', enabled: true },
  { selector: 'input[autocomplete="cc-number"]', label: 'Credit card numbers', enabled: true },
  { selector: 'input[autocomplete="cc-csc"]', label: 'CVV codes', enabled: true },
  { selector: 'input[name*="ssn"]', label: 'SSN fields', enabled: true },
  { selector: 'input[name*="social"]', label: 'Social security fields', enabled: true },
  { selector: 'input[name*="pin"]', label: 'PIN fields', enabled: true },
  { selector: '[data-sensitive="true"]', label: 'Data-sensitive marked fields', enabled: true },
] as const;

/**
 * Default browser preview configuration.
 */
export const DEFAULT_BROWSER_PREVIEW_CONFIG: Readonly<BrowserPreviewConfig> = {
  collapsedSize: {
    width: { type: 'pixels', value: 300 },
    height: { type: 'pixels', value: 200 },
  },
  expandedSize: {
    width: { type: 'percentage', value: 100 },
    height: { type: 'percentage', value: 100 },
  },
  position: PreviewPosition.BottomSheet,
  initialDisplayMode: PreviewDisplayMode.Collapsed,
  transitionType: TransitionType.Fade,
  transitionDurationMs: 300,
  scaleFactor: 1.0,
  sensitiveFieldConfig: {
    enabled: true,
    blurRadius: 8,
    rules: DEFAULT_SENSITIVE_FIELD_RULES,
  },
  visible: true,
} as const;

// ─── Validation ──────────────────────────────────────────────────────

/**
 * Validate a browser preview configuration.
 */
export function validateBrowserPreviewConfig(config: BrowserPreviewConfig): {
  valid: boolean;
  errors: readonly string[];
} {
  const errors: string[] = [];

  if (config.collapsedSize.width.value <= 0) {
    errors.push('collapsedSize.width must be positive');
  }
  if (config.collapsedSize.height.value <= 0) {
    errors.push('collapsedSize.height must be positive');
  }
  if (config.expandedSize.width.value <= 0) {
    errors.push('expandedSize.width must be positive');
  }
  if (config.expandedSize.height.value <= 0) {
    errors.push('expandedSize.height must be positive');
  }
  if (config.transitionDurationMs < 0) {
    errors.push('transitionDurationMs must be non-negative');
  }
  if (config.scaleFactor <= 0 || config.scaleFactor > 1) {
    errors.push('scaleFactor must be in (0.0, 1.0]');
  }
  if (config.sensitiveFieldConfig.enabled && config.sensitiveFieldConfig.rules.length === 0) {
    errors.push('sensitiveFieldConfig.rules must contain at least one rule when enabled');
  }
  if (config.sensitiveFieldConfig.blurRadius < 0) {
    errors.push('sensitiveFieldConfig.blurRadius must be non-negative');
  }

  for (let i = 0; i < config.sensitiveFieldConfig.rules.length; i++) {
    const rule = config.sensitiveFieldConfig.rules[i];
    if (!rule) continue;
    if (!rule.selector || rule.selector.trim().length === 0) {
      errors.push(`sensitiveFieldConfig.rules[${i}].selector must be non-empty`);
    }
    if (!rule.label || rule.label.trim().length === 0) {
      errors.push(`sensitiveFieldConfig.rules[${i}].label must be non-empty`);
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Assert a browser preview config is valid.
 */
export function assertValidBrowserPreviewConfig(config: BrowserPreviewConfig): void {
  const result = validateBrowserPreviewConfig(config);
  if (!result.valid) {
    throw new Error(`Invalid BrowserPreviewConfig: ${result.errors.join('; ')}`);
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}
