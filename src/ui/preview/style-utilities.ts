/**
 * Style Utilities — CSS style computation for the visual browser preview.
 *
 * Provides pure functions that compute CSS styles for the host app's
 * rendering layer. These utilities bridge the headless controller's
 * state with the actual visual presentation.
 *
 * Design: "Specify then implement"
 * - Each function takes immutable inputs and returns plain CSS objects
 * - No React/RN dependency — works with any rendering framework
 * - Position styles map to standard CSS positioning patterns
 * - Scaling styles use CSS transforms for smooth thumbnail rendering
 *
 * Invariants:
 * 1. All returned style objects have readonly string/number values
 * 2. scaleFactor is always in (0.0, 1.0] — enforced by config validation
 * 3. Position styles are mutually exclusive — only one position type applies
 * 4. Dimension strings are always valid CSS values (e.g. "300px", "100%")
 */

import type { PreviewPositionName, PreviewDisplayModeName, PreviewSize } from './types';
import { PreviewPosition, PreviewDisplayMode } from './types';
import type { BrowserPreviewRenderInfo } from './browser-preview-controller';

// ─── Container Style ──────────────────────────────────────────────────

/**
 * CSS properties for the preview container.
 * All values are valid CSS strings.
 */
export interface PreviewContainerStyle {
  readonly width: string;
  readonly height: string;
  readonly overflow: 'hidden';
  readonly position: 'fixed' | 'relative' | 'absolute';
  readonly opacity: string;
  readonly transition: string;
  readonly pointerEvents: 'auto' | 'none';
  readonly zIndex: number;
  // Position-specific properties
  readonly bottom?: string;
  readonly left?: string;
  readonly right?: string;
  readonly top?: string;
}

/**
 * CSS properties for the WebView scaling transform.
 * Applied to the WebView element inside the container.
 */
export interface WebViewScaleStyle {
  readonly transform: string;
  readonly transformOrigin: string;
  readonly width: string;
  readonly height: string;
}

/**
 * Complete style output for the preview component.
 */
export interface PreviewStyles {
  readonly container: PreviewContainerStyle;
  readonly webView: WebViewScaleStyle;
}

// ─── Position Styles ──────────────────────────────────────────────────

/**
 * Position-specific CSS defaults.
 * Maps each PreviewPosition to its standard CSS layout.
 */
const POSITION_STYLES: Record<PreviewPositionName, Partial<PreviewContainerStyle>> = {
  [PreviewPosition.BottomSheet]: {
    position: 'fixed',
    bottom: '0',
    left: '0',
    right: '0',
    zIndex: 1000,
  },
  [PreviewPosition.Inline]: {
    position: 'relative',
    zIndex: 1,
  },
  [PreviewPosition.Modal]: {
    position: 'fixed',
    top: '0',
    left: '0',
    right: '0',
    bottom: '0',
    zIndex: 9999,
  },
} as const;

// ─── Scaling Computation ──────────────────────────────────────────────

/**
 * Compute the CSS transform styles for WebView scaling.
 *
 * When the preview is collapsed (thumbnail mode), the WebView is rendered
 * at its original size but scaled down using CSS `transform: scale()`.
 * This provides a smooth, high-quality thumbnail without re-rendering.
 *
 * The WebView is positioned at top-left via `transformOrigin: 'top left'`,
 * and its logical width/height are expanded by 1/scaleFactor so that
 * after scaling, it fills the container exactly.
 *
 * @precondition scaleFactor is in (0.0, 1.0]
 * @postcondition returned transform produces a correctly-sized thumbnail
 *
 * @param scaleFactor - The scale factor from BrowserPreviewRenderInfo (0.0, 1.0]
 * @param containerWidth - The resolved container width (e.g. "300px", "100%")
 * @param containerHeight - The resolved container height (e.g. "200px", "100%")
 * @returns CSS styles to apply to the WebView element
 */
export function computeWebViewScaleStyle(
  scaleFactor: number,
  containerWidth: string,
  containerHeight: string,
): WebViewScaleStyle {
  assert(
    scaleFactor > 0 && scaleFactor <= 1.0,
    `scaleFactor must be in (0.0, 1.0], got ${scaleFactor}`,
  );

  if (scaleFactor === 1.0) {
    return {
      transform: 'none',
      transformOrigin: 'top left',
      width: containerWidth,
      height: containerHeight,
    };
  }

  // Scale the WebView down and compensate by enlarging its logical size
  const inverseScale = 1 / scaleFactor;
  return {
    transform: `scale(${scaleFactor})`,
    transformOrigin: 'top left',
    width: scaleCSSDimension(containerWidth, inverseScale),
    height: scaleCSSDimension(containerHeight, inverseScale),
  };
}

/**
 * Scale a CSS dimension string by a factor.
 *
 * Handles both pixel and percentage values:
 * - "300px" scaled by 2 → "600px"
 * - "100%" stays "100%" (percentages can't be arbitrarily scaled in CSS)
 *
 * @param dimension - A CSS dimension string (e.g. "300px", "50%")
 * @param factor - Scale factor to apply
 * @returns The scaled CSS dimension string
 */
export function scaleCSSDimension(dimension: string, factor: number): string {
  if (dimension.endsWith('%')) {
    // Percentages are relative to parent — scaling them doesn't make sense
    // for CSS transform-based scaling. Return as-is.
    return dimension;
  }

  const match = dimension.match(/^(\d+(?:\.\d+)?)px$/);
  if (match && match[1]) {
    const px = parseFloat(match[1]);
    return `${Math.round(px * factor)}px`;
  }

  // Unknown format — return as-is
  return dimension;
}

// ─── Container Style Computation ──────────────────────────────────────

/**
 * Compute the full container CSS styles from render info and position.
 *
 * Combines the computed dimensions, opacity, position layout, and
 * interactivity state into a single style object that the host app
 * can apply directly to the container element.
 *
 * @param renderInfo - Computed render info from `computeBrowserPreviewRenderInfo()`
 * @param position - The current preview position
 * @param transitionDurationMs - Duration for CSS transitions (default: 300ms)
 * @returns CSS styles for the container element
 */
export function computeContainerStyle(
  renderInfo: BrowserPreviewRenderInfo,
  position: PreviewPositionName,
  transitionDurationMs: number = 300,
): PreviewContainerStyle {
  const positionDefaults = POSITION_STYLES[position];
  const durationSec = (transitionDurationMs / 1000).toFixed(2);

  return {
    width: renderInfo.containerWidth,
    height: renderInfo.containerHeight,
    overflow: 'hidden',
    position: positionDefaults.position ?? 'relative',
    opacity: renderInfo.opacity.toFixed(2),
    transition: `opacity ${durationSec}s ease, width 0.2s ease, height 0.2s ease`,
    pointerEvents: renderInfo.isInteractive ? 'auto' : 'none',
    zIndex: positionDefaults.zIndex ?? 1,
    ...(positionDefaults.bottom !== undefined && { bottom: positionDefaults.bottom }),
    ...(positionDefaults.left !== undefined && { left: positionDefaults.left }),
    ...(positionDefaults.right !== undefined && { right: positionDefaults.right }),
    ...(positionDefaults.top !== undefined && { top: positionDefaults.top }),
  };
}

// ─── Combined Style Computation ───────────────────────────────────────

/**
 * Compute all styles needed to render the browser preview.
 *
 * This is the primary entry point for host apps. Takes the render info
 * from `computeBrowserPreviewRenderInfo()` and produces complete CSS
 * styles for both the container and the WebView.
 *
 * @param renderInfo - Computed render info from `computeBrowserPreviewRenderInfo()`
 * @param position - The current preview position
 * @param transitionDurationMs - Duration for CSS transitions (default: 300ms)
 * @returns Container and WebView styles
 */
export function computePreviewStyles(
  renderInfo: BrowserPreviewRenderInfo,
  position: PreviewPositionName,
  transitionDurationMs: number = 300,
): PreviewStyles {
  return {
    container: computeContainerStyle(renderInfo, position, transitionDurationMs),
    webView: computeWebViewScaleStyle(
      renderInfo.webViewScale,
      renderInfo.containerWidth,
      renderInfo.containerHeight,
    ),
  };
}

// ─── Display Mode Style Helpers ───────────────────────────────────────

/**
 * Compute the appropriate container size for a display mode.
 *
 * @param displayMode - Current display mode
 * @param collapsedSize - Size when collapsed
 * @param expandedSize - Size when expanded
 * @returns The CSS width and height strings
 */
export function computeDisplayModeSize(
  displayMode: PreviewDisplayModeName,
  collapsedSize: PreviewSize,
  expandedSize: PreviewSize,
): { width: string; height: string } {
  const size = displayMode === PreviewDisplayMode.Collapsed ? collapsedSize : expandedSize;

  return {
    width: formatDimension(size.width),
    height: formatDimension(size.height),
  };
}

/**
 * Format a PreviewDimension as a CSS string.
 */
function formatDimension(dim: { type: string; value: number }): string {
  if (dim.type === 'percentage') {
    return `${dim.value}%`;
  }
  return `${dim.value}px`;
}

// ─── Assertions ───────────────────────────────────────────────────────

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}
