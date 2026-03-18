/**
 * Tests for Browser Preview Controller (CDT-4)
 */

import {
  BrowserPreviewController,
  computeBrowserPreviewRenderInfo,
  type ScriptInjector,
} from '../../../src/ui/preview/browser-preview-controller';
import type {
  BrowserPreviewState,
  BrowserPreviewEvent,
  BrowserPreviewConfig,
} from '../../../src/ui/preview/types';
import {
  PreviewDisplayMode,
  PreviewPosition,
  TransitionPhase,
  TransitionType,
  DEFAULT_BROWSER_PREVIEW_CONFIG,
} from '../../../src/ui/preview/types';
import {
  NavigationPhase,
  type NavigationState,
} from '../../../src/types/navigation';

// ─── Mock Script Injector ────────────────────────────────────────────

function createMockScriptInjector(
  returnValue: unknown = JSON.stringify({
    maskedCount: 2,
    matchedSelectors: ['input[type="password"]'],
    success: true,
  }),
): ScriptInjector & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async injectJavaScript<T>(script: string) {
      calls.push(script);
      return { success: true, result: returnValue as T };
    },
  };
}

// ─── Construction Tests ──────────────────────────────────────────────

describe('BrowserPreviewController — construction', () => {
  it('creates with default config', () => {
    const controller = new BrowserPreviewController();
    expect(controller.state.displayMode).toBe(PreviewDisplayMode.Collapsed);
    expect(controller.state.visible).toBe(true);
    expect(controller.state.position).toBe(PreviewPosition.BottomSheet);
    expect(controller.state.currentUrl).toBeNull();
    expect(controller.state.isLoading).toBe(false);
    expect(controller.state.canExpand).toBe(true);
    expect(controller.state.canCollapse).toBe(false);
    expect(controller.isDisposed).toBe(false);
    controller.dispose();
  });

  it('creates with custom config', () => {
    const controller = new BrowserPreviewController({
      position: PreviewPosition.Modal,
      initialDisplayMode: PreviewDisplayMode.Expanded,
      visible: false,
    });
    expect(controller.state.displayMode).toBe(PreviewDisplayMode.Expanded);
    expect(controller.state.visible).toBe(false);
    expect(controller.state.position).toBe(PreviewPosition.Modal);
    expect(controller.state.canExpand).toBe(false);
    expect(controller.state.canCollapse).toBe(true);
    controller.dispose();
  });

  it('sets collapsed size when initially collapsed', () => {
    const controller = new BrowserPreviewController({
      initialDisplayMode: PreviewDisplayMode.Collapsed,
    });
    expect(controller.state.currentSize).toEqual(
      DEFAULT_BROWSER_PREVIEW_CONFIG.collapsedSize,
    );
    controller.dispose();
  });

  it('sets expanded size when initially expanded', () => {
    const controller = new BrowserPreviewController({
      initialDisplayMode: PreviewDisplayMode.Expanded,
    });
    expect(controller.state.currentSize).toEqual(
      DEFAULT_BROWSER_PREVIEW_CONFIG.expandedSize,
    );
    controller.dispose();
  });

  it('throws for invalid config', () => {
    expect(
      () =>
        new BrowserPreviewController({
          scaleFactor: 0,
        }),
    ).toThrow('Invalid BrowserPreviewConfig');
  });

  it('starts with idle navigation state', () => {
    const controller = new BrowserPreviewController();
    expect(controller.state.navigationState.phase).toBe(NavigationPhase.Idle);
    controller.dispose();
  });

  it('starts with idle transition state', () => {
    const controller = new BrowserPreviewController();
    expect(controller.state.transition.phase).toBe(TransitionPhase.Idle);
    controller.dispose();
  });

  it('starts with null sensitive field mask', () => {
    const controller = new BrowserPreviewController();
    expect(controller.state.sensitiveFieldMask).toBeNull();
    controller.dispose();
  });
});

// ─── Display Mode Toggle Tests ───────────────────────────────────────

describe('BrowserPreviewController — expand/collapse', () => {
  let controller: BrowserPreviewController;

  beforeEach(() => {
    controller = new BrowserPreviewController();
  });

  afterEach(() => {
    controller.dispose();
  });

  it('expands from collapsed', () => {
    controller.expand();
    expect(controller.state.displayMode).toBe(PreviewDisplayMode.Expanded);
    expect(controller.isExpanded).toBe(true);
    expect(controller.isCollapsed).toBe(false);
    expect(controller.state.canExpand).toBe(false);
    expect(controller.state.canCollapse).toBe(true);
  });

  it('collapses from expanded', () => {
    controller.expand();
    controller.collapse();
    expect(controller.state.displayMode).toBe(PreviewDisplayMode.Collapsed);
    expect(controller.isCollapsed).toBe(true);
    expect(controller.state.canExpand).toBe(true);
    expect(controller.state.canCollapse).toBe(false);
  });

  it('toggle toggles the state', () => {
    controller.toggle();
    expect(controller.isExpanded).toBe(true);
    controller.toggle();
    expect(controller.isCollapsed).toBe(true);
  });

  it('expand is no-op when already expanded', () => {
    controller.expand();
    const events: BrowserPreviewEvent[] = [];
    controller.on((e) => events.push(e));
    controller.expand(); // Should not emit
    // Only state_change events should fire, no toggle
    const toggleEvents = events.filter((e) => e.type === 'toggle');
    expect(toggleEvents).toHaveLength(0);
  });

  it('collapse is no-op when already collapsed', () => {
    const events: BrowserPreviewEvent[] = [];
    controller.on((e) => events.push(e));
    controller.collapse(); // Should not emit
    const toggleEvents = events.filter((e) => e.type === 'toggle');
    expect(toggleEvents).toHaveLength(0);
  });

  it('updates currentSize on expand', () => {
    controller.expand();
    expect(controller.state.currentSize).toEqual(
      DEFAULT_BROWSER_PREVIEW_CONFIG.expandedSize,
    );
  });

  it('updates currentSize on collapse', () => {
    controller.expand();
    controller.collapse();
    expect(controller.state.currentSize).toEqual(
      DEFAULT_BROWSER_PREVIEW_CONFIG.collapsedSize,
    );
  });

  it('emits toggle event on expand', () => {
    const events: BrowserPreviewEvent[] = [];
    controller.on((e) => events.push(e));
    controller.expand();
    const toggleEvent = events.find((e) => e.type === 'toggle');
    expect(toggleEvent).toBeDefined();
    if (toggleEvent && toggleEvent.type === 'toggle') {
      expect(toggleEvent.displayMode).toBe(PreviewDisplayMode.Expanded);
    }
  });

  it('emits toggle event on collapse', () => {
    controller.expand();
    const events: BrowserPreviewEvent[] = [];
    controller.on((e) => events.push(e));
    controller.collapse();
    const toggleEvent = events.find((e) => e.type === 'toggle');
    expect(toggleEvent).toBeDefined();
    if (toggleEvent && toggleEvent.type === 'toggle') {
      expect(toggleEvent.displayMode).toBe(PreviewDisplayMode.Collapsed);
    }
  });
});

// ─── Visibility Tests ────────────────────────────────────────────────

describe('BrowserPreviewController — visibility', () => {
  let controller: BrowserPreviewController;

  beforeEach(() => {
    controller = new BrowserPreviewController();
  });

  afterEach(() => {
    controller.dispose();
  });

  it('shows the preview', () => {
    controller.hide();
    controller.show();
    expect(controller.state.visible).toBe(true);
    expect(controller.isVisible).toBe(true);
  });

  it('hides the preview', () => {
    controller.hide();
    expect(controller.state.visible).toBe(false);
    expect(controller.isVisible).toBe(false);
  });

  it('show is no-op when already visible', () => {
    const events: BrowserPreviewEvent[] = [];
    controller.on((e) => events.push(e));
    controller.show();
    expect(events).toHaveLength(0);
  });

  it('hide is no-op when already hidden', () => {
    controller.hide();
    const events: BrowserPreviewEvent[] = [];
    controller.on((e) => events.push(e));
    controller.hide();
    expect(events).toHaveLength(0);
  });
});

// ─── Position Tests ──────────────────────────────────────────────────

describe('BrowserPreviewController — position', () => {
  let controller: BrowserPreviewController;

  beforeEach(() => {
    controller = new BrowserPreviewController();
  });

  afterEach(() => {
    controller.dispose();
  });

  it('changes position', () => {
    controller.setPosition(PreviewPosition.Modal);
    expect(controller.state.position).toBe(PreviewPosition.Modal);
  });

  it('is no-op for same position', () => {
    const events: BrowserPreviewEvent[] = [];
    controller.on((e) => events.push(e));
    controller.setPosition(PreviewPosition.BottomSheet);
    expect(events).toHaveLength(0);
  });
});

// ─── Navigation Handling Tests ───────────────────────────────────────

describe('BrowserPreviewController — navigation handling', () => {
  let controller: BrowserPreviewController;

  beforeEach(() => {
    controller = new BrowserPreviewController();
  });

  afterEach(() => {
    controller.dispose();
  });

  it('updates currentUrl on navigating state', () => {
    const navState: NavigationState = {
      phase: NavigationPhase.Navigating,
      url: 'https://bank.com/login',
      startedAt: Date.now(),
      redirectChain: [],
    };
    controller.handleNavigationStateChange(navState);
    expect(controller.currentUrl).toBe('https://bank.com/login');
  });

  it('sets isLoading to true on navigating', () => {
    const navState: NavigationState = {
      phase: NavigationPhase.Navigating,
      url: 'https://bank.com/login',
      startedAt: Date.now(),
      redirectChain: [],
    };
    controller.handleNavigationStateChange(navState);
    expect(controller.state.isLoading).toBe(true);
  });

  it('sets isLoading to false on loaded', () => {
    controller.handleNavigationStateChange({
      phase: NavigationPhase.Navigating,
      url: 'https://bank.com/login',
      startedAt: Date.now(),
      redirectChain: [],
    });
    controller.handleNavigationStateChange({
      phase: NavigationPhase.Loaded,
      url: 'https://bank.com/login',
      loadedAt: Date.now(),
      statusCode: 200,
      redirectChain: [],
    });
    expect(controller.state.isLoading).toBe(false);
  });

  it('updates navigationState', () => {
    const navState: NavigationState = {
      phase: NavigationPhase.Loaded,
      url: 'https://bank.com/login',
      loadedAt: Date.now(),
      statusCode: 200,
      redirectChain: [],
    };
    controller.handleNavigationStateChange(navState);
    expect(controller.state.navigationState).toEqual(navState);
  });

  it('emits navigation event on URL change', () => {
    const events: BrowserPreviewEvent[] = [];
    controller.on((e) => events.push(e));

    controller.handleNavigationStateChange({
      phase: NavigationPhase.Navigating,
      url: 'https://bank.com/login',
      startedAt: Date.now(),
      redirectChain: [],
    });

    const navEvent = events.find((e) => e.type === 'navigation');
    expect(navEvent).toBeDefined();
    if (navEvent && navEvent.type === 'navigation') {
      expect(navEvent.url).toBe('https://bank.com/login');
      expect(navEvent.previousUrl).toBeNull();
    }
  });

  it('starts transition on navigation to new URL', () => {
    controller.handleNavigationStateChange({
      phase: NavigationPhase.Navigating,
      url: 'https://bank.com/login',
      startedAt: Date.now(),
      redirectChain: [],
    });

    expect(controller.state.transition.phase).toBe(TransitionPhase.Transitioning);
  });

  it('completes transition on page loaded', () => {
    controller.handleNavigationStateChange({
      phase: NavigationPhase.Navigating,
      url: 'https://bank.com/login',
      startedAt: Date.now(),
      redirectChain: [],
    });
    controller.handleNavigationStateChange({
      phase: NavigationPhase.Loaded,
      url: 'https://bank.com/login',
      loadedAt: Date.now(),
      statusCode: 200,
      redirectChain: [],
    });

    expect(controller.state.transition.phase).toBe(TransitionPhase.Complete);
  });

  it('resets transition on navigation complete', () => {
    // Navigate
    controller.handleNavigationStateChange({
      phase: NavigationPhase.Navigating,
      url: 'https://bank.com/login',
      startedAt: Date.now(),
      redirectChain: [],
    });
    // Load
    controller.handleNavigationStateChange({
      phase: NavigationPhase.Loaded,
      url: 'https://bank.com/login',
      loadedAt: Date.now(),
      statusCode: 200,
      redirectChain: [],
    });
    // Complete
    controller.handleNavigationStateChange({
      phase: NavigationPhase.Complete,
      url: 'https://bank.com/login',
      completedAt: Date.now(),
      durationMs: 100,
    });

    expect(controller.state.transition.phase).toBe(TransitionPhase.Idle);
  });

  it('force-resets transition on error', () => {
    controller.handleNavigationStateChange({
      phase: NavigationPhase.Navigating,
      url: 'https://bank.com/login',
      startedAt: Date.now(),
      redirectChain: [],
    });
    controller.handleNavigationStateChange({
      phase: NavigationPhase.Error,
      error: { code: 'TIMEOUT', message: 'Timeout' },
      failedUrl: 'https://bank.com/login',
      failedAt: Date.now(),
      previousPhase: NavigationPhase.Navigating,
    });

    expect(controller.state.isLoading).toBe(false);
  });

  it('handles idle state', () => {
    controller.handleNavigationStateChange({
      phase: NavigationPhase.Idle,
    });
    expect(controller.state.isLoading).toBe(false);
  });

  it('handles extracting state', () => {
    controller.handleNavigationStateChange({
      phase: NavigationPhase.Navigating,
      url: 'https://bank.com/accounts',
      startedAt: Date.now(),
      redirectChain: [],
    });
    controller.handleNavigationStateChange({
      phase: NavigationPhase.Loaded,
      url: 'https://bank.com/accounts',
      loadedAt: Date.now(),
      statusCode: 200,
      redirectChain: [],
    });
    controller.handleNavigationStateChange({
      phase: NavigationPhase.Extracting,
      url: 'https://bank.com/accounts',
      loadedAt: Date.now(),
      extractionStartedAt: Date.now(),
    });
    expect(controller.state.isLoading).toBe(false);
    expect(controller.currentUrl).toBe('https://bank.com/accounts');
  });
});

// ─── Sensitive Field Masking Tests ───────────────────────────────────

describe('BrowserPreviewController — sensitive field masking', () => {
  let controller: BrowserPreviewController;

  beforeEach(() => {
    controller = new BrowserPreviewController();
  });

  afterEach(() => {
    controller.dispose();
  });

  it('applies masking via script injector', async () => {
    const injector = createMockScriptInjector();
    controller.setScriptInjector(injector);

    const result = await controller.applySensitiveFieldMasking();
    expect(result.success).toBe(true);
    expect(result.maskedCount).toBe(2);
    expect(injector.calls.length).toBe(1);
  });

  it('updates state with mask result', async () => {
    const injector = createMockScriptInjector();
    controller.setScriptInjector(injector);

    await controller.applySensitiveFieldMasking();
    expect(controller.state.sensitiveFieldMask).toBeDefined();
    expect(controller.state.sensitiveFieldMask!.maskedCount).toBe(2);
  });

  it('emits mask_applied event', async () => {
    const injector = createMockScriptInjector();
    controller.setScriptInjector(injector);

    const events: BrowserPreviewEvent[] = [];
    controller.on((e) => events.push(e));

    await controller.applySensitiveFieldMasking();

    const maskEvent = events.find((e) => e.type === 'mask_applied');
    expect(maskEvent).toBeDefined();
  });

  it('returns error when no injector available', async () => {
    const result = await controller.applySensitiveFieldMasking();
    expect(result.success).toBe(false);
    expect(result.error).toBe('No script injector available');
  });

  it('returns success when masking disabled', async () => {
    const controller2 = new BrowserPreviewController({
      sensitiveFieldConfig: {
        enabled: false,
        blurRadius: 8,
        rules: [],
      },
    });

    const result = await controller2.applySensitiveFieldMasking();
    expect(result.success).toBe(true);
    expect(result.maskedCount).toBe(0);
    controller2.dispose();
  });

  it('handles script injection failure', async () => {
    const injector: ScriptInjector = {
      async injectJavaScript() {
        throw new Error('Injection failed');
      },
    };
    controller.setScriptInjector(injector);

    const result = await controller.applySensitiveFieldMasking();
    expect(result.success).toBe(false);
    expect(result.error).toBe('Failed to execute masking script');
  });

  it('removes masking via unmasking script', async () => {
    const injector = createMockScriptInjector();
    controller.setScriptInjector(injector);

    await controller.applySensitiveFieldMasking();
    await controller.removeSensitiveFieldMasking();

    expect(controller.state.sensitiveFieldMask).toBeNull();
    expect(injector.calls.length).toBe(2);
  });

  it('masking is applied after page load', () => {
    const injector = createMockScriptInjector();
    controller.setScriptInjector(injector);

    controller.handleNavigationStateChange({
      phase: NavigationPhase.Navigating,
      url: 'https://bank.com/login',
      startedAt: Date.now(),
      redirectChain: [],
    });
    controller.handleNavigationStateChange({
      phase: NavigationPhase.Loaded,
      url: 'https://bank.com/login',
      loadedAt: Date.now(),
      statusCode: 200,
      redirectChain: [],
    });

    // Masking is async, so it's called but not yet resolved
    // Check that the injector was called
    expect(injector.calls.length).toBeGreaterThanOrEqual(1);
  });
});

// ─── Event System Tests ──────────────────────────────────────────────

describe('BrowserPreviewController — event system', () => {
  let controller: BrowserPreviewController;

  beforeEach(() => {
    controller = new BrowserPreviewController();
  });

  afterEach(() => {
    controller.dispose();
  });

  it('emits state_change events', () => {
    const events: BrowserPreviewEvent[] = [];
    controller.on((e) => events.push(e));
    controller.expand();
    const stateEvents = events.filter((e) => e.type === 'state_change');
    expect(stateEvents.length).toBeGreaterThan(0);
  });

  it('returns unsubscribe function', () => {
    const events: BrowserPreviewEvent[] = [];
    const unsub = controller.on((e) => events.push(e));
    controller.expand();
    const countBefore = events.length;
    unsub();
    controller.collapse();
    expect(events.length).toBe(countBefore);
  });

  it('does not break on listener errors', () => {
    controller.on(() => {
      throw new Error('Listener error');
    });
    expect(() => controller.expand()).not.toThrow();
  });
});

// ─── Dispose Tests ───────────────────────────────────────────────────

describe('BrowserPreviewController — dispose', () => {
  it('sets disposed flag', () => {
    const controller = new BrowserPreviewController();
    controller.dispose();
    expect(controller.isDisposed).toBe(true);
  });

  it('throws on operations after dispose', () => {
    const controller = new BrowserPreviewController();
    controller.dispose();
    expect(() => controller.expand()).toThrow('has been disposed');
    expect(() => controller.collapse()).toThrow('has been disposed');
    expect(() => controller.toggle()).toThrow('has been disposed');
    expect(() => controller.show()).toThrow('has been disposed');
    expect(() => controller.hide()).toThrow('has been disposed');
    expect(() => controller.setPosition(PreviewPosition.Modal)).toThrow('has been disposed');
  });
});

// ─── Render Info Tests ───────────────────────────────────────────────

describe('computeBrowserPreviewRenderInfo()', () => {
  const baseState: BrowserPreviewState = {
    displayMode: PreviewDisplayMode.Collapsed,
    visible: true,
    position: PreviewPosition.BottomSheet,
    currentSize: {
      width: { type: 'pixels', value: 300 },
      height: { type: 'pixels', value: 200 },
    },
    currentUrl: null,
    navigationState: { phase: NavigationPhase.Idle },
    transition: { phase: TransitionPhase.Idle },
    sensitiveFieldMask: null,
    isLoading: false,
    canExpand: true,
    canCollapse: false,
    scaleFactor: 1.0,
  };

  it('hides WebView when not visible', () => {
    const info = computeBrowserPreviewRenderInfo({
      ...baseState,
      visible: false,
    });
    expect(info.showWebView).toBe(false);
  });

  it('hides WebView when no URL', () => {
    const info = computeBrowserPreviewRenderInfo({
      ...baseState,
      currentUrl: null,
    });
    expect(info.showWebView).toBe(false);
  });

  it('shows WebView when visible with URL', () => {
    const info = computeBrowserPreviewRenderInfo({
      ...baseState,
      currentUrl: 'https://bank.com/login',
    });
    expect(info.showWebView).toBe(true);
  });

  it('shows loading overlay when loading', () => {
    const info = computeBrowserPreviewRenderInfo({
      ...baseState,
      isLoading: true,
    });
    expect(info.showLoadingOverlay).toBe(true);
  });

  it('hides loading overlay when not loading', () => {
    const info = computeBrowserPreviewRenderInfo(baseState);
    expect(info.showLoadingOverlay).toBe(false);
  });

  it('shows toggle button when visible', () => {
    const info = computeBrowserPreviewRenderInfo(baseState);
    expect(info.showToggleButton).toBe(true);
  });

  it('uses scale factor when collapsed', () => {
    const info = computeBrowserPreviewRenderInfo({
      ...baseState,
      scaleFactor: 0.5,
    });
    expect(info.webViewScale).toBe(0.5);
  });

  it('uses 1.0 scale when expanded', () => {
    const info = computeBrowserPreviewRenderInfo({
      ...baseState,
      displayMode: PreviewDisplayMode.Expanded,
      scaleFactor: 0.5,
    });
    expect(info.webViewScale).toBe(1.0);
  });

  it('formats pixel dimensions', () => {
    const info = computeBrowserPreviewRenderInfo(baseState);
    expect(info.containerWidth).toBe('300px');
    expect(info.containerHeight).toBe('200px');
  });

  it('formats percentage dimensions', () => {
    const info = computeBrowserPreviewRenderInfo({
      ...baseState,
      currentSize: {
        width: { type: 'percentage', value: 100 },
        height: { type: 'percentage', value: 80 },
      },
    });
    expect(info.containerWidth).toBe('100%');
    expect(info.containerHeight).toBe('80%');
  });

  it('computes opacity during fade transition', () => {
    const info = computeBrowserPreviewRenderInfo({
      ...baseState,
      transition: {
        phase: TransitionPhase.Transitioning,
        fromUrl: null,
        toUrl: 'https://bank.com/login',
        animationType: TransitionType.Fade,
        progress: 0.25,
        startedAt: Date.now(),
        durationMs: 300,
      },
    });
    // At progress 0.25: opacity = 1.0 - (0.25 * 2) = 0.5
    expect(info.opacity).toBeCloseTo(0.5, 1);
  });

  it('opacity at midpoint of fade is 0', () => {
    const info = computeBrowserPreviewRenderInfo({
      ...baseState,
      transition: {
        phase: TransitionPhase.Transitioning,
        fromUrl: null,
        toUrl: 'https://bank.com/login',
        animationType: TransitionType.Fade,
        progress: 0.5,
        startedAt: Date.now(),
        durationMs: 300,
      },
    });
    expect(info.opacity).toBeCloseTo(0, 1);
  });

  it('opacity at end of fade is 1', () => {
    const info = computeBrowserPreviewRenderInfo({
      ...baseState,
      transition: {
        phase: TransitionPhase.Transitioning,
        fromUrl: null,
        toUrl: 'https://bank.com/login',
        animationType: TransitionType.Fade,
        progress: 1.0,
        startedAt: Date.now(),
        durationMs: 300,
      },
    });
    expect(info.opacity).toBeCloseTo(1, 1);
  });

  it('is not interactive during transition', () => {
    const info = computeBrowserPreviewRenderInfo({
      ...baseState,
      transition: {
        phase: TransitionPhase.Transitioning,
        fromUrl: null,
        toUrl: 'https://bank.com/login',
        animationType: TransitionType.Fade,
        progress: 0.5,
        startedAt: Date.now(),
        durationMs: 300,
      },
    });
    expect(info.isInteractive).toBe(false);
  });

  it('is interactive when idle', () => {
    const info = computeBrowserPreviewRenderInfo(baseState);
    expect(info.isInteractive).toBe(true);
  });

  it('includes hostname in accessibility label', () => {
    const info = computeBrowserPreviewRenderInfo({
      ...baseState,
      currentUrl: 'https://secure.chase.com/login',
    });
    expect(info.accessibilityLabel).toContain('secure.chase.com');
  });

  it('includes loading in accessibility label', () => {
    const info = computeBrowserPreviewRenderInfo({
      ...baseState,
      isLoading: true,
    });
    expect(info.accessibilityLabel).toContain('loading');
  });

  it('includes display mode in accessibility label', () => {
    const info = computeBrowserPreviewRenderInfo(baseState);
    expect(info.accessibilityLabel).toContain('collapsed');
  });
});
