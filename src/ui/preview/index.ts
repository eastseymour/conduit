/**
 * Visual Browser Preview module — public API.
 *
 * Provides the live minimized browser preview with:
 * - Configurable container sizes (pixel or percentage-based)
 * - Expand/collapse toggle
 * - Page transition animations
 * - Sensitive field masking (password inputs, etc.)
 * - Configurable position (bottom sheet, inline, modal)
 */

// Types
export type {
  PreviewPositionName,
  PreviewDisplayModeName,
  PreviewDimension,
  PreviewSize,
  TransitionTypeName,
  TransitionPhaseName,
  TransitionState,
  TransitionIdleState,
  TransitionTransitioningState,
  TransitionCompleteState,
  SensitiveFieldRule,
  SensitiveFieldConfig,
  SensitiveFieldMaskResult,
  BrowserPreviewConfig,
  BrowserPreviewState,
  BrowserPreviewEvent,
  BrowserPreviewStateChangeEvent,
  BrowserPreviewNavigationEvent,
  BrowserPreviewTransitionEvent,
  BrowserPreviewMaskEvent,
  BrowserPreviewToggleEvent,
  BrowserPreviewEventListener,
} from './types';

// Const enums
export {
  PreviewPosition,
  PreviewDisplayMode,
  TransitionType,
  TransitionPhase,
  DEFAULT_SENSITIVE_FIELD_RULES,
  DEFAULT_BROWSER_PREVIEW_CONFIG,
  pixels,
  percentage,
  createPreviewSize,
  resolveDimension,
  isValidTransitionPhaseChange,
  assertValidTransitionPhaseChange,
  validateBrowserPreviewConfig,
  assertValidBrowserPreviewConfig,
} from './types';

// Transition state machine
export {
  TransitionStateMachine,
  createTransitionIdleState,
  createTransitionTransitioningState,
  createTransitionCompleteState,
  type TransitionStateListener,
} from './transition-state-machine';

// Sensitive field masking
export {
  generateMaskingScript,
  generateUnmaskingScript,
  parseMaskingResult,
  MASK_CLASS,
  PROCESSED_ATTR,
} from './sensitive-field-masker';

// Controller
export {
  BrowserPreviewController,
  computeBrowserPreviewRenderInfo,
  type BrowserPreviewRenderInfo,
  type ScriptInjector,
} from './browser-preview-controller';
