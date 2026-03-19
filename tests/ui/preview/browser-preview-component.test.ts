/**
 * Tests for BrowserPreview Component Factory (CDT-4)
 *
 * Verifies the React component factory that bridges
 * BrowserPreviewController state with rendering.
 */

import {
  createBrowserPreview,
  computeBrowserPreviewComponentInfo,
  type ReactLikeForPreview,
} from '../../../src/ui/preview/browser-preview-component';
import type { BrowserPreviewState, BrowserPreviewConfig } from '../../../src/ui/preview/types';
import {
  PreviewDisplayMode,
  PreviewPosition,
  TransitionPhase,
  TransitionType,
  DEFAULT_BROWSER_PREVIEW_CONFIG,
} from '../../../src/ui/preview/types';
import { NavigationPhase } from '../../../src/types/navigation';
import { createTransitionIdleState } from '../../../src/ui/preview/transition-state-machine';

// ─── Mock React ───────────────────────────────────────────────────────

interface MockElement {
  type: string | ((...args: unknown[]) => unknown);
  props: Record<string, unknown> | null;
  children: unknown[];
}

function createMockReact(): ReactLikeForPreview & { lastElement: MockElement | null } {
  const react: ReactLikeForPreview & { lastElement: MockElement | null } = {
    lastElement: null,
    createElement(
      type: string | ((...args: unknown[]) => unknown),
      props: Record<string, unknown> | null,
      ...children: unknown[]
    ): MockElement {
      const element: MockElement = { type, props, children };
      react.lastElement = element;
      return element;
    },
  };
  return react;
}

// ─── State Factory ────────────────────────────────────────────────────

function createTestState(overrides?: Partial<BrowserPreviewState>): BrowserPreviewState {
  return {
    displayMode: PreviewDisplayMode.Collapsed,
    visible: true,
    position: PreviewPosition.BottomSheet,
    currentSize: {
      width: { type: 'pixels', value: 300 },
      height: { type: 'pixels', value: 200 },
    },
    currentUrl: null,
    navigationState: { phase: NavigationPhase.Idle },
    transition: createTransitionIdleState(),
    sensitiveFieldMask: null,
    isLoading: false,
    canExpand: true,
    canCollapse: false,
    scaleFactor: 1.0,
    ...overrides,
  };
}

function createTestConfig(overrides?: Partial<BrowserPreviewConfig>): BrowserPreviewConfig {
  return {
    ...DEFAULT_BROWSER_PREVIEW_CONFIG,
    ...overrides,
  };
}

// ─── computeBrowserPreviewComponentInfo Tests ─────────────────────────

describe('computeBrowserPreviewComponentInfo', () => {
  it('computes render info and styles for collapsed state', () => {
    const state = createTestState({ currentUrl: 'https://bank.example.com/login' });
    const config = createTestConfig();
    const info = computeBrowserPreviewComponentInfo(state, config);

    expect(info.renderInfo.showWebView).toBe(true);
    expect(info.renderInfo.containerWidth).toBe('300px');
    expect(info.renderInfo.containerHeight).toBe('200px');
    expect(info.styles.container).toBeDefined();
    expect(info.styles.webView).toBeDefined();
  });

  it('provides expand toggle label when collapsed', () => {
    const state = createTestState();
    const config = createTestConfig();
    const info = computeBrowserPreviewComponentInfo(state, config);
    expect(info.toggleLabel).toBe('Expand preview');
  });

  it('provides collapse toggle label when expanded', () => {
    const state = createTestState({ displayMode: PreviewDisplayMode.Expanded });
    const config = createTestConfig();
    const info = computeBrowserPreviewComponentInfo(state, config);
    expect(info.toggleLabel).toBe('Collapse preview');
  });

  it('shows loading status when loading', () => {
    const state = createTestState({ isLoading: true });
    const config = createTestConfig();
    const info = computeBrowserPreviewComponentInfo(state, config);
    expect(info.statusLabel).toBe('Loading page...');
  });

  it('shows hostname as status when navigated', () => {
    const state = createTestState({ currentUrl: 'https://bank.example.com/login' });
    const config = createTestConfig();
    const info = computeBrowserPreviewComponentInfo(state, config);
    expect(info.statusLabel).toBe('bank.example.com');
  });

  it('shows empty status when no URL', () => {
    const state = createTestState({ currentUrl: null });
    const config = createTestConfig();
    const info = computeBrowserPreviewComponentInfo(state, config);
    expect(info.statusLabel).toBe('');
  });

  it('handles invalid URL gracefully', () => {
    const state = createTestState({ currentUrl: 'not-a-url' });
    const config = createTestConfig();
    const info = computeBrowserPreviewComponentInfo(state, config);
    expect(info.statusLabel).toBe('Browsing');
  });

  it('computes WebView scale styles based on scaleFactor', () => {
    const state = createTestState({ scaleFactor: 0.5 });
    const config = createTestConfig();
    const info = computeBrowserPreviewComponentInfo(state, config);
    expect(info.styles.webView.transform).toBe('scale(0.5)');
  });

  it('uses transition duration from config', () => {
    const state = createTestState();
    const config = createTestConfig({ transitionDurationMs: 500 });
    const info = computeBrowserPreviewComponentInfo(state, config);
    expect(info.styles.container.transition).toContain('0.50s');
  });
});

// ─── createBrowserPreview Tests ───────────────────────────────────────

describe('createBrowserPreview', () => {
  it('returns a function component', () => {
    const React = createMockReact();
    const BrowserPreview = createBrowserPreview(React);
    expect(typeof BrowserPreview).toBe('function');
    expect(BrowserPreview.name).toBe('BrowserPreview');
  });

  it('renders a container div with accessibility label', () => {
    const React = createMockReact();
    const BrowserPreview = createBrowserPreview(React);
    const state = createTestState({ currentUrl: 'https://bank.example.com' });
    const config = createTestConfig();

    const result = BrowserPreview({ state, config }) as MockElement;

    expect(result.type).toBe('div');
    expect(result.props?.['aria-label']).toContain('Browser preview');
  });

  it('applies testID to container', () => {
    const React = createMockReact();
    const BrowserPreview = createBrowserPreview(React);
    const state = createTestState();
    const config = createTestConfig();

    const result = BrowserPreview({ state, config, testID: 'my-preview' }) as MockElement;
    expect(result.props?.['data-testid']).toBe('my-preview');
  });

  it('renders toggle button when onToggle is provided', () => {
    const React = createMockReact();
    const BrowserPreview = createBrowserPreview(React);
    const onToggle = jest.fn();
    const state = createTestState();
    const config = createTestConfig();

    const result = BrowserPreview({ state, config, onToggle }) as MockElement;

    // Find toggle button in children
    const toggleChild = result.children.find(
      (c): c is MockElement =>
        typeof c === 'object' && c !== null && (c as MockElement).type === 'button',
    );
    expect(toggleChild).toBeDefined();
    expect(toggleChild?.props?.['aria-label']).toBe('Expand preview');
  });

  it('does not render toggle button without onToggle', () => {
    const React = createMockReact();
    const BrowserPreview = createBrowserPreview(React);
    const state = createTestState();
    const config = createTestConfig();

    const result = BrowserPreview({ state, config }) as MockElement;

    const toggleChild = result.children.find(
      (c): c is MockElement =>
        typeof c === 'object' && c !== null && (c as MockElement).type === 'button',
    );
    expect(toggleChild).toBeUndefined();
  });

  it('renders loading overlay when loading', () => {
    const React = createMockReact();
    const BrowserPreview = createBrowserPreview(React);
    const state = createTestState({ isLoading: true, currentUrl: 'https://example.com' });
    const config = createTestConfig();

    const result = BrowserPreview({ state, config }) as MockElement;

    const loadingChild = result.children.find(
      (c): c is MockElement =>
        typeof c === 'object' &&
        c !== null &&
        (c as MockElement).props?.['aria-label'] === 'Loading',
    );
    expect(loadingChild).toBeDefined();
  });

  it('does not render loading overlay when not loading', () => {
    const React = createMockReact();
    const BrowserPreview = createBrowserPreview(React);
    const state = createTestState({ isLoading: false });
    const config = createTestConfig();

    const result = BrowserPreview({ state, config }) as MockElement;

    const loadingChild = result.children.find(
      (c): c is MockElement =>
        typeof c === 'object' &&
        c !== null &&
        (c as MockElement).props?.['aria-label'] === 'Loading',
    );
    expect(loadingChild).toBeUndefined();
  });

  it('renders WebView slot when visible and URL is set', () => {
    const React = createMockReact();
    const BrowserPreview = createBrowserPreview(React);
    const renderWebView = jest.fn().mockReturnValue('mock-webview');
    const state = createTestState({ currentUrl: 'https://example.com' });
    const config = createTestConfig();

    BrowserPreview({ state, config, renderWebView });

    expect(renderWebView).toHaveBeenCalledWith(
      expect.objectContaining({
        transform: expect.any(String),
        transformOrigin: 'top left',
        width: expect.any(String),
        height: expect.any(String),
      }),
    );
  });

  it('does not render WebView when no URL', () => {
    const React = createMockReact();
    const BrowserPreview = createBrowserPreview(React);
    const renderWebView = jest.fn();
    const state = createTestState({ currentUrl: null });
    const config = createTestConfig();

    BrowserPreview({ state, config, renderWebView });

    expect(renderWebView).not.toHaveBeenCalled();
  });

  it('renders mask indicator when fields are masked', () => {
    const React = createMockReact();
    const BrowserPreview = createBrowserPreview(React);
    const state = createTestState({
      sensitiveFieldMask: {
        maskedCount: 3,
        matchedSelectors: ['input[type="password"]'],
        success: true,
      },
    });
    const config = createTestConfig();

    const result = BrowserPreview({ state, config }) as MockElement;

    const maskIndicator = result.children.find(
      (c): c is MockElement =>
        typeof c === 'object' &&
        c !== null &&
        typeof (c as MockElement).props?.['aria-label'] === 'string' &&
        ((c as MockElement).props?.['aria-label'] as string).includes('sensitive fields masked'),
    );
    expect(maskIndicator).toBeDefined();
    expect(maskIndicator?.props?.['aria-label']).toBe('3 sensitive fields masked');
  });

  it('does not render mask indicator when no fields masked', () => {
    const React = createMockReact();
    const BrowserPreview = createBrowserPreview(React);
    const state = createTestState({ sensitiveFieldMask: null });
    const config = createTestConfig();

    const result = BrowserPreview({ state, config }) as MockElement;

    const maskIndicator = result.children.find(
      (c): c is MockElement =>
        typeof c === 'object' &&
        c !== null &&
        typeof (c as MockElement).props?.['aria-label'] === 'string' &&
        ((c as MockElement).props?.['aria-label'] as string).includes('sensitive fields masked'),
    );
    expect(maskIndicator).toBeUndefined();
  });

  it('makes container clickable when onPress is provided', () => {
    const React = createMockReact();
    const BrowserPreview = createBrowserPreview(React);
    const onPress = jest.fn();
    const state = createTestState();
    const config = createTestConfig();

    const result = BrowserPreview({ state, config, onPress }) as MockElement;

    expect(result.props?.['onClick']).toBe(onPress);
    expect(result.props?.['role']).toBe('button');
    expect(result.props?.['tabIndex']).toBe(0);
  });

  it('renders status label with hostname', () => {
    const React = createMockReact();
    const BrowserPreview = createBrowserPreview(React);
    const state = createTestState({ currentUrl: 'https://bank.example.com/dashboard' });
    const config = createTestConfig();

    const result = BrowserPreview({ state, config }) as MockElement;

    const statusChild = result.children.find(
      (c): c is MockElement =>
        typeof c === 'object' && c !== null && (c as MockElement).props?.['aria-live'] === 'polite',
    );
    expect(statusChild).toBeDefined();
    // The text content should be the hostname
    expect(statusChild?.children).toContain('bank.example.com');
  });

  it('disables toggle button during transitions', () => {
    const React = createMockReact();
    const BrowserPreview = createBrowserPreview(React);
    const onToggle = jest.fn();
    const state = createTestState({
      transition: {
        phase: TransitionPhase.Transitioning,
        fromUrl: null,
        toUrl: 'https://example.com',
        animationType: TransitionType.Fade,
        progress: 0.5,
        startedAt: Date.now(),
        durationMs: 300,
      },
    });
    const config = createTestConfig();

    const result = BrowserPreview({ state, config, onToggle }) as MockElement;

    const toggleChild = result.children.find(
      (c): c is MockElement =>
        typeof c === 'object' && c !== null && (c as MockElement).type === 'button',
    );
    expect(toggleChild?.props?.['disabled']).toBe(true);
  });
});
