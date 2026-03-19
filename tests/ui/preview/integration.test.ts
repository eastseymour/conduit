/**
 * Integration Tests for Visual Browser Preview (CDT-4)
 *
 * End-to-end tests verifying the complete preview flow:
 * 1. Controller creation → engine attachment → navigation
 * 2. State changes → render info computation → style computation
 * 3. Expand/collapse → dimension changes → scale updates
 * 4. Navigation → transition animation → sensitive field masking
 * 5. Position changes → style updates
 *
 * These tests validate that all CDT-4 components work together correctly.
 */

import {
  BrowserPreviewController,
  type ScriptInjector,
} from '../../../src/ui/preview/browser-preview-controller';
import { computeBrowserPreviewRenderInfo } from '../../../src/ui/preview/browser-preview-controller';
import {
  computePreviewStyles,
  computeWebViewScaleStyle,
} from '../../../src/ui/preview/style-utilities';
import { computeBrowserPreviewComponentInfo } from '../../../src/ui/preview/browser-preview-component';
import {
  PreviewPosition,
  TransitionPhase,
  TransitionType,
  DEFAULT_BROWSER_PREVIEW_CONFIG,
} from '../../../src/ui/preview/types';
import { NavigationPhase } from '../../../src/types/navigation';
import type { NavigationState } from '../../../src/types/navigation';
import type { BrowserPreviewEvent } from '../../../src/ui/preview/types';

// ─── Mock Script Injector ─────────────────────────────────────────────

function createMockInjector(): ScriptInjector & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async injectJavaScript<T>(script: string) {
      calls.push(script);
      return {
        success: true,
        result: JSON.stringify({
          maskedCount: 2,
          matchedSelectors: ['input[type="password"]', 'input[name*="ssn"]'],
          success: true,
        }) as T,
      };
    },
  };
}

// ─── Full Navigation Flow Integration ─────────────────────────────────

describe('Integration: Full navigation flow', () => {
  it('handles complete navigation lifecycle with rendering', async () => {
    // 1. Create controller with thumbnail scaling
    const controller = new BrowserPreviewController({
      scaleFactor: 0.5,
      transitionType: TransitionType.Fade,
      transitionDurationMs: 300,
    });

    const injector = createMockInjector();
    controller.setScriptInjector(injector);

    // 2. Verify initial state renders correctly
    const initialRenderInfo = computeBrowserPreviewRenderInfo(controller.state);
    expect(initialRenderInfo.showWebView).toBe(false); // No URL yet
    expect(initialRenderInfo.webViewScale).toBe(0.5); // Collapsed with 0.5 scale
    expect(initialRenderInfo.containerWidth).toBe('300px');
    expect(initialRenderInfo.containerHeight).toBe('200px');

    // 3. Verify initial scaling styles
    const initialScaleStyle = computeWebViewScaleStyle(
      initialRenderInfo.webViewScale,
      initialRenderInfo.containerWidth,
      initialRenderInfo.containerHeight,
    );
    expect(initialScaleStyle.transform).toBe('scale(0.5)');
    expect(initialScaleStyle.width).toBe('600px'); // 300 / 0.5
    expect(initialScaleStyle.height).toBe('400px'); // 200 / 0.5

    // 4. Simulate navigation start
    const navigatingState: NavigationState = {
      phase: NavigationPhase.Navigating,
      url: 'https://bank.example.com/login',
      startedAt: Date.now(),
      redirectChain: [],
    };
    controller.handleNavigationStateChange(navigatingState);

    // 5. Verify loading state and transition started
    expect(controller.state.isLoading).toBe(true);
    expect(controller.state.currentUrl).toBe('https://bank.example.com/login');
    expect(controller.state.transition.phase).toBe(TransitionPhase.Transitioning);

    const loadingRenderInfo = computeBrowserPreviewRenderInfo(controller.state);
    expect(loadingRenderInfo.showWebView).toBe(true);
    expect(loadingRenderInfo.showLoadingOverlay).toBe(true);

    // 6. Simulate page loaded
    const loadedState: NavigationState = {
      phase: NavigationPhase.Loaded,
      url: 'https://bank.example.com/login',
      loadedAt: Date.now(),
      statusCode: 200,
      redirectChain: [],
    };
    controller.handleNavigationStateChange(loadedState);

    // 7. Verify transition completed and masking triggered
    expect(controller.state.isLoading).toBe(false);
    expect(controller.state.transition.phase).toBe(TransitionPhase.Complete);

    // Wait for async masking to complete
    await new Promise((resolve) => setTimeout(resolve, 10));

    // 8. Verify masking was applied
    expect(injector.calls.length).toBeGreaterThan(0);
    expect(controller.state.sensitiveFieldMask).not.toBeNull();
    expect(controller.state.sensitiveFieldMask?.maskedCount).toBe(2);

    // 9. Verify render info reflects all state
    const finalRenderInfo = computeBrowserPreviewRenderInfo(controller.state);
    expect(finalRenderInfo.showWebView).toBe(true);
    expect(finalRenderInfo.showLoadingOverlay).toBe(false);
    expect(finalRenderInfo.accessibilityLabel).toContain('bank.example.com');

    // 10. Compute full styles for rendering
    const styles = computePreviewStyles(
      finalRenderInfo,
      controller.state.position,
      DEFAULT_BROWSER_PREVIEW_CONFIG.transitionDurationMs,
    );
    expect(styles.container.position).toBe('fixed'); // BottomSheet
    expect(styles.container.bottom).toBe('0');
    expect(styles.webView.transform).toBe('scale(0.5)');

    controller.dispose();
  });
});

// ─── Expand/Collapse with Style Updates ───────────────────────────────

describe('Integration: Expand/collapse with styles', () => {
  it('updates dimensions and scale on toggle', () => {
    const controller = new BrowserPreviewController({
      scaleFactor: 0.5,
    });

    // Initial: collapsed at 300x200 with 0.5 scale
    let renderInfo = computeBrowserPreviewRenderInfo(controller.state);
    let styles = computePreviewStyles(renderInfo, controller.state.position);

    expect(styles.container.width).toBe('300px');
    expect(styles.container.height).toBe('200px');
    expect(styles.webView.transform).toBe('scale(0.5)');

    // Expand: full size at 100% with 1.0 scale
    controller.expand();
    renderInfo = computeBrowserPreviewRenderInfo(controller.state);
    styles = computePreviewStyles(renderInfo, controller.state.position);

    expect(styles.container.width).toBe('100%');
    expect(styles.container.height).toBe('100%');
    expect(styles.webView.transform).toBe('none'); // 1.0 scale

    // Collapse back: 300x200 with 0.5 scale
    controller.collapse();
    renderInfo = computeBrowserPreviewRenderInfo(controller.state);
    styles = computePreviewStyles(renderInfo, controller.state.position);

    expect(styles.container.width).toBe('300px');
    expect(styles.container.height).toBe('200px');
    expect(styles.webView.transform).toBe('scale(0.5)');

    controller.dispose();
  });
});

// ─── Position Changes with Style Updates ──────────────────────────────

describe('Integration: Position changes with styles', () => {
  it('updates position CSS when position changes', () => {
    const controller = new BrowserPreviewController();

    // Initial: bottom sheet
    let renderInfo = computeBrowserPreviewRenderInfo(controller.state);
    let styles = computePreviewStyles(renderInfo, controller.state.position);
    expect(styles.container.position).toBe('fixed');
    expect(styles.container.bottom).toBe('0');
    expect(styles.container.zIndex).toBe(1000);

    // Change to inline
    controller.setPosition(PreviewPosition.Inline);
    renderInfo = computeBrowserPreviewRenderInfo(controller.state);
    styles = computePreviewStyles(renderInfo, controller.state.position);
    expect(styles.container.position).toBe('relative');
    expect(styles.container.zIndex).toBe(1);
    expect(styles.container.bottom).toBeUndefined();

    // Change to modal
    controller.setPosition(PreviewPosition.Modal);
    renderInfo = computeBrowserPreviewRenderInfo(controller.state);
    styles = computePreviewStyles(renderInfo, controller.state.position);
    expect(styles.container.position).toBe('fixed');
    expect(styles.container.top).toBe('0');
    expect(styles.container.zIndex).toBe(9999);

    controller.dispose();
  });
});

// ─── Page Transition Animation with Opacity ───────────────────────────

describe('Integration: Transition animations with opacity', () => {
  it('computes opacity during fade transition', () => {
    const controller = new BrowserPreviewController({
      transitionType: TransitionType.Fade,
      transitionDurationMs: 1000,
    });

    // Start navigation → triggers transition
    controller.handleNavigationStateChange({
      phase: NavigationPhase.Navigating,
      url: 'https://example.com/page1',
      startedAt: Date.now(),
      redirectChain: [],
    });

    // Manually set transition progress to 0.25
    controller.setTransitionProgress(0.25);

    let renderInfo = computeBrowserPreviewRenderInfo(controller.state);
    let styles = computePreviewStyles(renderInfo, controller.state.position);

    // At progress 0.25, opacity = 1.0 - 0.25 * 2 = 0.5
    expect(renderInfo.opacity).toBe(0.5);
    expect(styles.container.opacity).toBe('0.50');

    // At progress 0.5 (midpoint), opacity should be 0
    controller.setTransitionProgress(0.5);
    renderInfo = computeBrowserPreviewRenderInfo(controller.state);
    expect(renderInfo.opacity).toBe(0);

    // At progress 0.75, opacity = (0.75 - 0.5) * 2 = 0.5
    controller.setTransitionProgress(0.75);
    renderInfo = computeBrowserPreviewRenderInfo(controller.state);
    expect(renderInfo.opacity).toBe(0.5);

    controller.dispose();
  });

  it('maintains full opacity with no-animation transitions', () => {
    const controller = new BrowserPreviewController({
      transitionType: TransitionType.None,
      transitionDurationMs: 0,
    });

    controller.handleNavigationStateChange({
      phase: NavigationPhase.Navigating,
      url: 'https://example.com',
      startedAt: Date.now(),
      redirectChain: [],
    });

    // With TransitionType.None and 0 duration, transition completes instantly
    const renderInfo = computeBrowserPreviewRenderInfo(controller.state);
    expect(renderInfo.opacity).toBe(1.0);

    controller.dispose();
  });
});

// ─── Component Info Integration ───────────────────────────────────────

describe('Integration: computeBrowserPreviewComponentInfo', () => {
  it('produces complete rendering data for host app', async () => {
    const controller = new BrowserPreviewController({
      scaleFactor: 0.5,
      position: PreviewPosition.BottomSheet,
    });
    const injector = createMockInjector();
    controller.setScriptInjector(injector);

    // Navigate to a page
    controller.handleNavigationStateChange({
      phase: NavigationPhase.Navigating,
      url: 'https://bank.example.com/accounts',
      startedAt: Date.now(),
      redirectChain: [],
    });
    controller.handleNavigationStateChange({
      phase: NavigationPhase.Loaded,
      url: 'https://bank.example.com/accounts',
      loadedAt: Date.now(),
      statusCode: 200,
      redirectChain: [],
    });

    await new Promise((resolve) => setTimeout(resolve, 10));

    // Get component info
    const info = computeBrowserPreviewComponentInfo(controller.state, controller.config);

    // Render info
    expect(info.renderInfo.showWebView).toBe(true);
    expect(info.renderInfo.showLoadingOverlay).toBe(false);
    expect(info.renderInfo.webViewScale).toBe(0.5);

    // Styles
    expect(info.styles.container.position).toBe('fixed');
    expect(info.styles.webView.transform).toBe('scale(0.5)');

    // Labels
    expect(info.toggleLabel).toBe('Expand preview');
    expect(info.statusLabel).toBe('bank.example.com');

    controller.dispose();
  });
});

// ─── Event-Driven State Updates ───────────────────────────────────────

describe('Integration: Event-driven rendering updates', () => {
  it('emits state changes that produce valid render info', () => {
    const controller = new BrowserPreviewController();
    const renderInfos: ReturnType<typeof computeBrowserPreviewRenderInfo>[] = [];

    // Subscribe and compute render info on each state change
    controller.on((event: BrowserPreviewEvent) => {
      if (event.type === 'state_change') {
        renderInfos.push(computeBrowserPreviewRenderInfo(event.state));
      }
    });

    // Navigate
    controller.handleNavigationStateChange({
      phase: NavigationPhase.Navigating,
      url: 'https://example.com',
      startedAt: Date.now(),
      redirectChain: [],
    });

    // Toggle
    controller.expand();

    // Change position
    controller.setPosition(PreviewPosition.Modal);

    // All render infos should be valid
    expect(renderInfos.length).toBeGreaterThan(0);
    for (const info of renderInfos) {
      expect(typeof info.showWebView).toBe('boolean');
      expect(typeof info.webViewScale).toBe('number');
      expect(typeof info.containerWidth).toBe('string');
      expect(typeof info.containerHeight).toBe('string');
      expect(typeof info.opacity).toBe('number');
      expect(info.opacity).toBeGreaterThanOrEqual(0);
      expect(info.opacity).toBeLessThanOrEqual(1);
    }

    controller.dispose();
  });
});

// ─── Multi-Page Navigation ────────────────────────────────────────────

describe('Integration: Multi-page navigation', () => {
  it('handles sequential page navigations correctly', async () => {
    const controller = new BrowserPreviewController({
      transitionType: TransitionType.Fade,
      scaleFactor: 0.5,
    });
    const injector = createMockInjector();
    controller.setScriptInjector(injector);

    const urls = [
      'https://bank.example.com/login',
      'https://bank.example.com/mfa',
      'https://bank.example.com/accounts',
    ];

    for (const url of urls) {
      // Navigate
      controller.handleNavigationStateChange({
        phase: NavigationPhase.Navigating,
        url,
        startedAt: Date.now(),
        redirectChain: [],
      });

      expect(controller.state.isLoading).toBe(true);
      expect(controller.state.currentUrl).toBe(url);

      // Load
      controller.handleNavigationStateChange({
        phase: NavigationPhase.Loaded,
        url,
        loadedAt: Date.now(),
        statusCode: 200,
        redirectChain: [],
      });

      expect(controller.state.isLoading).toBe(false);

      // Complete
      controller.handleNavigationStateChange({
        phase: NavigationPhase.Complete,
        url,
        completedAt: Date.now(),
        durationMs: 100,
      });

      // Reset to idle for next navigation
      controller.handleNavigationStateChange({
        phase: NavigationPhase.Idle,
      });
    }

    await new Promise((resolve) => setTimeout(resolve, 10));

    // Final state should reflect last URL
    expect(controller.state.currentUrl).toBe('https://bank.example.com/accounts');
    expect(controller.state.isLoading).toBe(false);

    // Masking should have been applied for each loaded page
    expect(injector.calls.length).toBe(3);

    // Render info should be valid
    const renderInfo = computeBrowserPreviewRenderInfo(controller.state);
    expect(renderInfo.showWebView).toBe(true);
    expect(renderInfo.accessibilityLabel).toContain('bank.example.com');

    controller.dispose();
  });
});
