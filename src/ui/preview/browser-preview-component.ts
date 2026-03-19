/**
 * BrowserPreview React Component Factory — Creates a React component
 * that renders the visual browser preview from BrowserPreviewController state.
 *
 * This bridges the headless BrowserPreviewController with React rendering.
 * The host app calls `createBrowserPreview(React)` with their React instance,
 * then renders the returned component with a controller prop.
 *
 * Unlike ConduitPreview (which shows simple status/progress), BrowserPreview
 * renders the full live browser preview with:
 * - Scaled thumbnail of the WebView (CSS transform)
 * - Expand/collapse toggle button
 * - Loading overlay
 * - Page transition opacity animations
 * - Position-specific CSS (bottom sheet, inline, modal)
 * - Sensitive field masking indicators
 *
 * Design: "Specify then implement"
 * - The component is a pure function of BrowserPreviewState
 * - All style computation is delegated to style-utilities.ts
 * - No direct DOM manipulation — React handles rendering
 *
 * Invariants:
 * 1. Component re-renders only when state changes (via controller events)
 * 2. Toggle button is disabled during transitions
 * 3. WebView scale is applied via CSS transform (no re-render of WebView content)
 * 4. Loading overlay is shown only when isLoading is true
 */

import type { BrowserPreviewState, BrowserPreviewConfig } from './types';
import { PreviewDisplayMode } from './types';
import {
  computeBrowserPreviewRenderInfo,
  type BrowserPreviewRenderInfo,
} from './browser-preview-controller';
import { computePreviewStyles, type PreviewStyles } from './style-utilities';

// ─── Component Props ──────────────────────────────────────────────────

/**
 * Props for the BrowserPreview component.
 *
 * The component requires the current state from BrowserPreviewController
 * and the config for style computation. Event handlers allow the host
 * app to respond to user interactions.
 */
export interface BrowserPreviewComponentProps {
  /** Current state from BrowserPreviewController */
  readonly state: BrowserPreviewState;
  /** Configuration (for transition duration, position) */
  readonly config: BrowserPreviewConfig;
  /** Called when the user taps the expand/collapse toggle */
  readonly onToggle?: () => void;
  /** Called when the user taps the preview container */
  readonly onPress?: () => void;
  /** Slot for the WebView element provided by the host app */
  readonly renderWebView?: (styles: {
    readonly transform: string;
    readonly transformOrigin: string;
    readonly width: string;
    readonly height: string;
  }) => unknown;
  /** Additional CSS class for the container */
  readonly className?: string;
  /** Test ID for the container */
  readonly testID?: string;
}

// ─── Render Info Computation ──────────────────────────────────────────

/**
 * Compute all rendering information and styles for the BrowserPreview.
 *
 * Pure function — extracts render decisions from state and config.
 * This is the main entry point for computing what to render.
 *
 * @param state - Current BrowserPreviewState
 * @param config - BrowserPreviewConfig
 * @returns Render info and computed styles
 */
export function computeBrowserPreviewComponentInfo(
  state: BrowserPreviewState,
  config: BrowserPreviewConfig,
): {
  readonly renderInfo: BrowserPreviewRenderInfo;
  readonly styles: PreviewStyles;
  readonly toggleLabel: string;
  readonly statusLabel: string;
} {
  const renderInfo = computeBrowserPreviewRenderInfo(state);
  const styles = computePreviewStyles(renderInfo, state.position, config.transitionDurationMs);

  const toggleLabel =
    state.displayMode === PreviewDisplayMode.Collapsed ? 'Expand preview' : 'Collapse preview';

  let statusLabel = '';
  if (state.isLoading) {
    statusLabel = 'Loading page...';
  } else if (state.currentUrl) {
    try {
      statusLabel = new URL(state.currentUrl).hostname;
    } catch {
      statusLabel = 'Browsing';
    }
  }

  return { renderInfo, styles, toggleLabel, statusLabel };
}

// ─── React Interface ──────────────────────────────────────────────────

/**
 * Minimal React interface for component creation.
 * Allows the factory to work without importing React directly.
 */
export interface ReactLikeForPreview {
  createElement(
    type: string | ((...args: unknown[]) => unknown),
    props: Record<string, unknown> | null,
    ...children: unknown[]
  ): unknown;
}

// ─── Component Factory ────────────────────────────────────────────────

/**
 * Create a BrowserPreview React component.
 *
 * Factory pattern avoids direct React dependency in the SDK.
 * The host app provides their React instance:
 *
 * ```ts
 * import React from 'react';
 * import { createBrowserPreview } from '@conduit/sdk';
 *
 * const BrowserPreview = createBrowserPreview(React);
 *
 * // In your component:
 * <BrowserPreview
 *   state={controller.state}
 *   config={controller.config}
 *   onToggle={() => controller.toggle()}
 *   renderWebView={(styles) => <WebView style={styles} />}
 * />
 * ```
 *
 * @param React - The host app's React instance
 * @returns A React component function
 */
export function createBrowserPreview(
  React: ReactLikeForPreview,
): (props: BrowserPreviewComponentProps) => unknown {
  return function BrowserPreview(props: BrowserPreviewComponentProps): unknown {
    const { state, config, onToggle, onPress, renderWebView, testID } = props;
    const { renderInfo, styles, toggleLabel, statusLabel } = computeBrowserPreviewComponentInfo(
      state,
      config,
    );

    const children: unknown[] = [];

    // WebView slot
    if (renderInfo.showWebView && renderWebView) {
      children.push(
        React.createElement(
          'div',
          {
            key: 'webview-container',
            style: {
              width: styles.container.width,
              height: styles.container.height,
              overflow: 'hidden',
            },
          },
          renderWebView(styles.webView),
        ),
      );
    }

    // Loading overlay
    if (renderInfo.showLoadingOverlay) {
      children.push(
        React.createElement('div', {
          key: 'loading-overlay',
          'aria-label': 'Loading',
          style: {
            position: 'absolute',
            top: '0',
            left: '0',
            right: '0',
            bottom: '0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'rgba(255, 255, 255, 0.6)',
          },
        }),
      );
    }

    // Status label
    if (statusLabel) {
      children.push(
        React.createElement(
          'div',
          {
            key: 'status',
            'aria-live': 'polite',
            style: {
              position: 'absolute',
              bottom: '8px',
              left: '8px',
              fontSize: '12px',
              color: '#666',
              backgroundColor: 'rgba(255, 255, 255, 0.8)',
              padding: '2px 6px',
              borderRadius: '4px',
            },
          },
          statusLabel,
        ),
      );
    }

    // Toggle button
    if (renderInfo.showToggleButton && onToggle) {
      children.push(
        React.createElement(
          'button',
          {
            key: 'toggle',
            'aria-label': toggleLabel,
            disabled: !renderInfo.isInteractive,
            onClick: onToggle,
            style: {
              position: 'absolute',
              top: '8px',
              right: '8px',
              padding: '4px 8px',
              borderRadius: '4px',
              border: '1px solid #ccc',
              backgroundColor: '#fff',
              cursor: renderInfo.isInteractive ? 'pointer' : 'default',
              opacity: renderInfo.isInteractive ? '1' : '0.5',
            },
          },
          state.displayMode === PreviewDisplayMode.Collapsed ? '⤢' : '⤡',
        ),
      );
    }

    // Sensitive field mask indicator
    if (state.sensitiveFieldMask?.maskedCount && state.sensitiveFieldMask.maskedCount > 0) {
      children.push(
        React.createElement(
          'div',
          {
            key: 'mask-indicator',
            'aria-label': `${state.sensitiveFieldMask.maskedCount} sensitive fields masked`,
            style: {
              position: 'absolute',
              top: '8px',
              left: '8px',
              fontSize: '10px',
              color: '#888',
              backgroundColor: 'rgba(255, 255, 255, 0.8)',
              padding: '2px 6px',
              borderRadius: '4px',
            },
          },
          `🔒 ${state.sensitiveFieldMask.maskedCount}`,
        ),
      );
    }

    // Container props
    const containerProps: Record<string, unknown> = {
      style: {
        ...styles.container,
        borderRadius: '12px',
        backgroundColor: '#f5f5f5',
      },
      'aria-label': renderInfo.accessibilityLabel,
      'data-testid': testID,
    };

    if (onPress) {
      containerProps['onClick'] = onPress;
      containerProps['role'] = 'button';
      containerProps['tabIndex'] = 0;
    }

    return React.createElement('div', containerProps, ...children);
  };
}
