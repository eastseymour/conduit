/**
 * Tests for ConduitPreview component factory (CDT-4)
 *
 * Verifies the simple preview component factory that shows
 * connection status, progress, and captions.
 */

import {
  resolvePreviewProps,
  getPreviewRenderInfo,
  createConduitPreview,
  IDLE_PREVIEW_STATE,
  type ReactLike,
} from '../../src/ui/ConduitPreview';
import { PreviewStatus } from '../../src/sdk/types';
import type { PreviewState } from '../../src/sdk/types';

// ─── Mock React ───────────────────────────────────────────────────────

interface MockElement {
  type: string | ((...args: unknown[]) => unknown);
  props: Record<string, unknown> | null;
  children: unknown[];
}

function createMockReact(): ReactLike {
  return {
    createElement(
      type: string | ((...args: unknown[]) => unknown),
      props: Record<string, unknown> | null,
      ...children: unknown[]
    ): MockElement {
      return { type, props, children };
    },
  };
}

// ─── resolvePreviewProps Tests ────────────────────────────────────────

describe('resolvePreviewProps', () => {
  it('resolves with all defaults when minimal props provided', () => {
    const resolved = resolvePreviewProps({ state: IDLE_PREVIEW_STATE });
    expect(resolved.width).toBe(320);
    expect(resolved.height).toBe(240);
    expect(resolved.showCaption).toBe(true);
    expect(resolved.showProgress).toBe(true);
    expect(resolved.style).toEqual({});
    expect(resolved.onPress).toBeUndefined();
    expect(resolved.testID).toBeUndefined();
  });

  it('uses custom width and height', () => {
    const resolved = resolvePreviewProps({
      state: IDLE_PREVIEW_STATE,
      width: 500,
      height: 300,
    });
    expect(resolved.width).toBe(500);
    expect(resolved.height).toBe(300);
  });

  it('uses custom showCaption and showProgress', () => {
    const resolved = resolvePreviewProps({
      state: IDLE_PREVIEW_STATE,
      showCaption: false,
      showProgress: false,
    });
    expect(resolved.showCaption).toBe(false);
    expect(resolved.showProgress).toBe(false);
  });

  it('passes through onPress and testID', () => {
    const onPress = jest.fn();
    const resolved = resolvePreviewProps({
      state: IDLE_PREVIEW_STATE,
      onPress,
      testID: 'test-preview',
    });
    expect(resolved.onPress).toBe(onPress);
    expect(resolved.testID).toBe('test-preview');
  });

  it('passes through custom style', () => {
    const style = { margin: 10, borderWidth: 1 };
    const resolved = resolvePreviewProps({
      state: IDLE_PREVIEW_STATE,
      style,
    });
    expect(resolved.style).toEqual(style);
  });
});

// ─── getPreviewRenderInfo Tests ───────────────────────────────────────

describe('getPreviewRenderInfo', () => {
  it('returns spinner for loading status', () => {
    const state: PreviewState = {
      status: PreviewStatus.Loading,
      caption: 'Connecting...',
      progress: null,
    };
    const info = getPreviewRenderInfo({ state });
    expect(info.showSpinner).toBe(true);
    expect(info.showSuccess).toBe(false);
    expect(info.showError).toBe(false);
  });

  it('returns spinner for active status', () => {
    const state: PreviewState = {
      status: PreviewStatus.Active,
      caption: 'Extracting data',
      progress: 0.5,
    };
    const info = getPreviewRenderInfo({ state });
    expect(info.showSpinner).toBe(true);
    expect(info.progressPercent).toBe(50);
  });

  it('returns success for complete status', () => {
    const state: PreviewState = {
      status: PreviewStatus.Complete,
      caption: 'Done',
      progress: null,
    };
    const info = getPreviewRenderInfo({ state });
    expect(info.showSuccess).toBe(true);
    expect(info.showSpinner).toBe(false);
  });

  it('returns error for error status', () => {
    const state: PreviewState = {
      status: PreviewStatus.Error,
      caption: 'Connection failed',
      progress: null,
    };
    const info = getPreviewRenderInfo({ state });
    expect(info.showError).toBe(true);
    expect(info.showSpinner).toBe(false);
  });

  it('hides caption when showCaption is false', () => {
    const state: PreviewState = {
      status: PreviewStatus.Active,
      caption: 'Some caption',
      progress: null,
    };
    const info = getPreviewRenderInfo({ state, showCaption: false });
    expect(info.caption).toBe('');
  });

  it('shows caption when showCaption is true (default)', () => {
    const state: PreviewState = {
      status: PreviewStatus.Active,
      caption: 'Some caption',
      progress: null,
    };
    const info = getPreviewRenderInfo({ state });
    expect(info.caption).toBe('Some caption');
  });

  it('hides progress when showProgress is false', () => {
    const state: PreviewState = {
      status: PreviewStatus.Active,
      caption: '',
      progress: 0.75,
    };
    const info = getPreviewRenderInfo({ state, showProgress: false });
    expect(info.progressPercent).toBeNull();
  });

  it('returns accessibility label for each status', () => {
    const idleInfo = getPreviewRenderInfo({ state: IDLE_PREVIEW_STATE });
    expect(idleInfo.accessibilityLabel).toContain('idle');

    const loadingState: PreviewState = {
      status: PreviewStatus.Loading,
      caption: '',
      progress: null,
    };
    const loadingInfo = getPreviewRenderInfo({ state: loadingState });
    expect(loadingInfo.accessibilityLabel).toContain('loading');
  });
});

// ─── IDLE_PREVIEW_STATE Tests ─────────────────────────────────────────

describe('IDLE_PREVIEW_STATE', () => {
  it('has idle status', () => {
    expect(IDLE_PREVIEW_STATE.status).toBe(PreviewStatus.Idle);
  });

  it('has empty caption', () => {
    expect(IDLE_PREVIEW_STATE.caption).toBe('');
  });

  it('has null progress', () => {
    expect(IDLE_PREVIEW_STATE.progress).toBeNull();
  });
});

// ─── createConduitPreview Tests ───────────────────────────────────────

describe('createConduitPreview', () => {
  it('returns a function component', () => {
    const React = createMockReact();
    const ConduitPreview = createConduitPreview(React);
    expect(typeof ConduitPreview).toBe('function');
    expect(ConduitPreview.name).toBe('ConduitPreview');
  });

  it('renders container with dimensions', () => {
    const React = createMockReact();
    const ConduitPreview = createConduitPreview(React);
    const result = ConduitPreview({
      state: IDLE_PREVIEW_STATE,
      width: 400,
      height: 300,
    }) as MockElement;

    expect(result.type).toBe('div');
    const style = result.props?.['style'] as Record<string, unknown>;
    expect(style.width).toBe(400);
    expect(style.height).toBe(300);
  });

  it('renders spinner when loading', () => {
    const React = createMockReact();
    const ConduitPreview = createConduitPreview(React);
    const loadingState: PreviewState = {
      status: PreviewStatus.Loading,
      caption: 'Connecting...',
      progress: null,
    };

    const result = ConduitPreview({ state: loadingState }) as MockElement;
    const spinnerChild = result.children.find(
      (c): c is MockElement =>
        typeof c === 'object' &&
        c !== null &&
        (c as MockElement).props?.['aria-label'] === 'Loading',
    );
    expect(spinnerChild).toBeDefined();
  });

  it('renders progress bar when active with progress', () => {
    const React = createMockReact();
    const ConduitPreview = createConduitPreview(React);
    const activeState: PreviewState = {
      status: PreviewStatus.Active,
      caption: 'Extracting',
      progress: 0.75,
    };

    const result = ConduitPreview({ state: activeState }) as MockElement;
    const progressChild = result.children.find(
      (c): c is MockElement =>
        typeof c === 'object' && c !== null && (c as MockElement).props?.['role'] === 'progressbar',
    );
    expect(progressChild).toBeDefined();
    expect(progressChild?.props?.['aria-valuenow']).toBe(75);
  });

  it('renders caption text', () => {
    const React = createMockReact();
    const ConduitPreview = createConduitPreview(React);
    const state: PreviewState = {
      status: PreviewStatus.Active,
      caption: 'Logging in to bank...',
      progress: null,
    };

    const result = ConduitPreview({ state }) as MockElement;
    const captionChild = result.children.find(
      (c): c is MockElement =>
        typeof c === 'object' && c !== null && (c as MockElement).props?.['key'] === 'caption',
    );
    expect(captionChild).toBeDefined();
    expect(captionChild?.children).toContain('Logging in to bank...');
  });

  it('makes container clickable with onPress', () => {
    const React = createMockReact();
    const ConduitPreview = createConduitPreview(React);
    const onPress = jest.fn();

    const result = ConduitPreview({
      state: IDLE_PREVIEW_STATE,
      onPress,
    }) as MockElement;

    expect(result.props?.['onClick']).toBe(onPress);
    expect(result.props?.['role']).toBe('button');
  });

  it('applies custom style', () => {
    const React = createMockReact();
    const ConduitPreview = createConduitPreview(React);

    const result = ConduitPreview({
      state: IDLE_PREVIEW_STATE,
      style: { margin: 20 },
    }) as MockElement;

    const style = result.props?.['style'] as Record<string, unknown>;
    expect(style.margin).toBe(20);
    // Default styles should still be present
    expect(style.overflow).toBe('hidden');
    expect(style.borderRadius).toBe(12);
  });

  it('applies accessibility label', () => {
    const React = createMockReact();
    const ConduitPreview = createConduitPreview(React);

    const result = ConduitPreview({ state: IDLE_PREVIEW_STATE }) as MockElement;

    expect(result.props?.['aria-label']).toContain('idle');
  });

  it('renders success indicator for complete status', () => {
    const React = createMockReact();
    const ConduitPreview = createConduitPreview(React);
    const completeState: PreviewState = {
      status: PreviewStatus.Complete,
      caption: 'All done',
      progress: null,
    };

    const result = ConduitPreview({ state: completeState }) as MockElement;
    const successChild = result.children.find(
      (c): c is MockElement =>
        typeof c === 'object' &&
        c !== null &&
        (c as MockElement).props?.['aria-label'] === 'Success',
    );
    expect(successChild).toBeDefined();
  });

  it('renders error indicator for error status', () => {
    const React = createMockReact();
    const ConduitPreview = createConduitPreview(React);
    const errorState: PreviewState = {
      status: PreviewStatus.Error,
      caption: 'Failed',
      progress: null,
    };

    const result = ConduitPreview({ state: errorState }) as MockElement;
    const errorChild = result.children.find(
      (c): c is MockElement =>
        typeof c === 'object' && c !== null && (c as MockElement).props?.['aria-label'] === 'Error',
    );
    expect(errorChild).toBeDefined();
  });
});
