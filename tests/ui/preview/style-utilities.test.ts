/**
 * Tests for Style Utilities (CDT-4)
 *
 * Verifies CSS style computation for the visual browser preview:
 * - WebView scaling transforms
 * - Container position styles
 * - Combined style computation
 * - Dimension scaling helpers
 */

import {
  computeWebViewScaleStyle,
  computeContainerStyle,
  computePreviewStyles,
  computeDisplayModeSize,
  scaleCSSDimension,
} from '../../../src/ui/preview/style-utilities';
import type { BrowserPreviewRenderInfo } from '../../../src/ui/preview/browser-preview-controller';
import {
  PreviewPosition,
  PreviewDisplayMode,
  pixels,
  percentage,
} from '../../../src/ui/preview/types';

// ─── Helper Factories ─────────────────────────────────────────────────

function createRenderInfo(overrides?: Partial<BrowserPreviewRenderInfo>): BrowserPreviewRenderInfo {
  return {
    showWebView: true,
    showLoadingOverlay: false,
    showToggleButton: true,
    webViewScale: 1.0,
    containerWidth: '300px',
    containerHeight: '200px',
    opacity: 1.0,
    isInteractive: true,
    accessibilityLabel: 'Browser preview',
    ...overrides,
  };
}

// ─── scaleCSSDimension Tests ──────────────────────────────────────────

describe('scaleCSSDimension', () => {
  it('scales pixel values by factor', () => {
    expect(scaleCSSDimension('300px', 2)).toBe('600px');
    expect(scaleCSSDimension('200px', 0.5)).toBe('100px');
    expect(scaleCSSDimension('100px', 1)).toBe('100px');
  });

  it('rounds scaled pixel values', () => {
    expect(scaleCSSDimension('300px', 1.5)).toBe('450px');
    expect(scaleCSSDimension('100px', 3)).toBe('300px');
    // 333 * 0.33 = 109.89 → 110
    expect(scaleCSSDimension('333px', 0.33)).toBe('110px');
  });

  it('returns percentage values unchanged', () => {
    expect(scaleCSSDimension('100%', 2)).toBe('100%');
    expect(scaleCSSDimension('50%', 0.5)).toBe('50%');
  });

  it('returns unknown formats unchanged', () => {
    expect(scaleCSSDimension('auto', 2)).toBe('auto');
    expect(scaleCSSDimension('10em', 2)).toBe('10em');
    expect(scaleCSSDimension('', 2)).toBe('');
  });

  it('handles decimal pixel values', () => {
    expect(scaleCSSDimension('100.5px', 2)).toBe('201px');
  });
});

// ─── computeWebViewScaleStyle Tests ───────────────────────────────────

describe('computeWebViewScaleStyle', () => {
  it('returns no transform when scaleFactor is 1.0', () => {
    const style = computeWebViewScaleStyle(1.0, '300px', '200px');
    expect(style.transform).toBe('none');
    expect(style.transformOrigin).toBe('top left');
    expect(style.width).toBe('300px');
    expect(style.height).toBe('200px');
  });

  it('applies CSS scale transform for scaleFactor < 1.0', () => {
    const style = computeWebViewScaleStyle(0.5, '300px', '200px');
    expect(style.transform).toBe('scale(0.5)');
    expect(style.transformOrigin).toBe('top left');
    // At 0.5 scale, logical WebView is 2x the container size
    expect(style.width).toBe('600px');
    expect(style.height).toBe('400px');
  });

  it('handles 0.25 scale factor', () => {
    const style = computeWebViewScaleStyle(0.25, '300px', '200px');
    expect(style.transform).toBe('scale(0.25)');
    expect(style.width).toBe('1200px');
    expect(style.height).toBe('800px');
  });

  it('handles percentage dimensions (kept as-is)', () => {
    const style = computeWebViewScaleStyle(0.5, '100%', '100%');
    expect(style.transform).toBe('scale(0.5)');
    expect(style.width).toBe('100%');
    expect(style.height).toBe('100%');
  });

  it('throws for scaleFactor <= 0', () => {
    expect(() => computeWebViewScaleStyle(0, '300px', '200px')).toThrow(
      'scaleFactor must be in (0.0, 1.0]',
    );
    expect(() => computeWebViewScaleStyle(-0.5, '300px', '200px')).toThrow(
      'scaleFactor must be in (0.0, 1.0]',
    );
  });

  it('throws for scaleFactor > 1.0', () => {
    expect(() => computeWebViewScaleStyle(1.5, '300px', '200px')).toThrow(
      'scaleFactor must be in (0.0, 1.0]',
    );
  });
});

// ─── computeContainerStyle Tests ──────────────────────────────────────

describe('computeContainerStyle', () => {
  describe('bottom sheet position', () => {
    it('applies fixed positioning at bottom', () => {
      const renderInfo = createRenderInfo();
      const style = computeContainerStyle(renderInfo, PreviewPosition.BottomSheet);
      expect(style.position).toBe('fixed');
      expect(style.bottom).toBe('0');
      expect(style.left).toBe('0');
      expect(style.right).toBe('0');
      expect(style.zIndex).toBe(1000);
    });
  });

  describe('inline position', () => {
    it('applies relative positioning', () => {
      const renderInfo = createRenderInfo();
      const style = computeContainerStyle(renderInfo, PreviewPosition.Inline);
      expect(style.position).toBe('relative');
      expect(style.zIndex).toBe(1);
      expect(style.bottom).toBeUndefined();
      expect(style.top).toBeUndefined();
    });
  });

  describe('modal position', () => {
    it('applies fixed full-screen positioning', () => {
      const renderInfo = createRenderInfo();
      const style = computeContainerStyle(renderInfo, PreviewPosition.Modal);
      expect(style.position).toBe('fixed');
      expect(style.top).toBe('0');
      expect(style.left).toBe('0');
      expect(style.right).toBe('0');
      expect(style.bottom).toBe('0');
      expect(style.zIndex).toBe(9999);
    });
  });

  it('sets dimensions from render info', () => {
    const renderInfo = createRenderInfo({ containerWidth: '500px', containerHeight: '300px' });
    const style = computeContainerStyle(renderInfo, PreviewPosition.Inline);
    expect(style.width).toBe('500px');
    expect(style.height).toBe('300px');
  });

  it('sets opacity from render info', () => {
    const renderInfo = createRenderInfo({ opacity: 0.5 });
    const style = computeContainerStyle(renderInfo, PreviewPosition.Inline);
    expect(style.opacity).toBe('0.50');
  });

  it('sets pointer events based on interactivity', () => {
    const interactive = createRenderInfo({ isInteractive: true });
    expect(computeContainerStyle(interactive, PreviewPosition.Inline).pointerEvents).toBe('auto');

    const nonInteractive = createRenderInfo({ isInteractive: false });
    expect(computeContainerStyle(nonInteractive, PreviewPosition.Inline).pointerEvents).toBe(
      'none',
    );
  });

  it('includes transition duration in CSS transition', () => {
    const renderInfo = createRenderInfo();
    const style = computeContainerStyle(renderInfo, PreviewPosition.Inline, 500);
    expect(style.transition).toContain('0.50s');
  });

  it('uses default transition duration of 300ms', () => {
    const renderInfo = createRenderInfo();
    const style = computeContainerStyle(renderInfo, PreviewPosition.Inline);
    expect(style.transition).toContain('0.30s');
  });

  it('always sets overflow to hidden', () => {
    const renderInfo = createRenderInfo();
    const style = computeContainerStyle(renderInfo, PreviewPosition.Inline);
    expect(style.overflow).toBe('hidden');
  });
});

// ─── computePreviewStyles Tests ───────────────────────────────────────

describe('computePreviewStyles', () => {
  it('returns both container and webView styles', () => {
    const renderInfo = createRenderInfo({ webViewScale: 0.5 });
    const styles = computePreviewStyles(renderInfo, PreviewPosition.BottomSheet);

    expect(styles.container).toBeDefined();
    expect(styles.container.position).toBe('fixed');
    expect(styles.webView).toBeDefined();
    expect(styles.webView.transform).toBe('scale(0.5)');
  });

  it('passes transition duration to container', () => {
    const renderInfo = createRenderInfo();
    const styles = computePreviewStyles(renderInfo, PreviewPosition.Inline, 1000);
    expect(styles.container.transition).toContain('1.00s');
  });

  it('computes consistent styles for expanded mode', () => {
    const renderInfo = createRenderInfo({
      webViewScale: 1.0,
      containerWidth: '100%',
      containerHeight: '100%',
      opacity: 1.0,
    });
    const styles = computePreviewStyles(renderInfo, PreviewPosition.Modal);

    expect(styles.container.width).toBe('100%');
    expect(styles.container.height).toBe('100%');
    expect(styles.webView.transform).toBe('none');
    expect(styles.webView.width).toBe('100%');
    expect(styles.webView.height).toBe('100%');
  });

  it('computes consistent styles for collapsed thumbnail mode', () => {
    const renderInfo = createRenderInfo({
      webViewScale: 0.5,
      containerWidth: '300px',
      containerHeight: '200px',
    });
    const styles = computePreviewStyles(renderInfo, PreviewPosition.BottomSheet);

    expect(styles.container.width).toBe('300px');
    expect(styles.container.height).toBe('200px');
    expect(styles.webView.transform).toBe('scale(0.5)');
    expect(styles.webView.width).toBe('600px');
    expect(styles.webView.height).toBe('400px');
  });
});

// ─── computeDisplayModeSize Tests ─────────────────────────────────────

describe('computeDisplayModeSize', () => {
  const collapsedSize = {
    width: pixels(300),
    height: pixels(200),
  };
  const expandedSize = {
    width: percentage(100),
    height: percentage(100),
  };

  it('returns collapsed size when collapsed', () => {
    const size = computeDisplayModeSize(PreviewDisplayMode.Collapsed, collapsedSize, expandedSize);
    expect(size.width).toBe('300px');
    expect(size.height).toBe('200px');
  });

  it('returns expanded size when expanded', () => {
    const size = computeDisplayModeSize(PreviewDisplayMode.Expanded, collapsedSize, expandedSize);
    expect(size.width).toBe('100%');
    expect(size.height).toBe('100%');
  });

  it('handles mixed dimension types', () => {
    const mixed = {
      width: pixels(400),
      height: percentage(50),
    };
    const size = computeDisplayModeSize(PreviewDisplayMode.Collapsed, mixed, expandedSize);
    expect(size.width).toBe('400px');
    expect(size.height).toBe('50%');
  });
});
