/**
 * ConduitPreview — React component factory for the bank browser preview.
 *
 * Uses a factory pattern to avoid direct React dependency in the SDK.
 * Host apps provide their React instance to createConduitPreview().
 */

import type { ConduitPreviewProps, PreviewRenderInfo } from './types';
import { computePreviewRenderInfo } from './types';
import type { PreviewState } from '../sdk/types';
import { PreviewStatus } from '../sdk/types';

const DEFAULT_WIDTH = 320;
const DEFAULT_HEIGHT = 240;

export function resolvePreviewProps(props: ConduitPreviewProps): {
  state: PreviewState;
  width: number;
  height: number;
  showCaption: boolean;
  showProgress: boolean;
  style: Record<string, unknown>;
  onPress: (() => void) | undefined;
  testID: string | undefined;
} {
  return {
    state: props.state,
    width: props.width ?? DEFAULT_WIDTH,
    height: props.height ?? DEFAULT_HEIGHT,
    showCaption: props.showCaption ?? true,
    showProgress: props.showProgress ?? true,
    style: props.style ?? {},
    onPress: props.onPress,
    testID: props.testID,
  };
}

export function getPreviewRenderInfo(
  props: ConduitPreviewProps,
): PreviewRenderInfo {
  const resolved = resolvePreviewProps(props);
  return computePreviewRenderInfo(
    resolved.state,
    resolved.showCaption,
    resolved.showProgress,
  );
}

export interface ReactLike {
  createElement(
    type: string | ((...args: unknown[]) => unknown),
    props: Record<string, unknown> | null,
    ...children: unknown[]
  ): unknown;
}

export function createConduitPreview(
  React: ReactLike,
): (props: ConduitPreviewProps) => unknown {
  return function ConduitPreview(props: ConduitPreviewProps): unknown {
    const resolved = resolvePreviewProps(props);
    const renderInfo = computePreviewRenderInfo(
      resolved.state,
      resolved.showCaption,
      resolved.showProgress,
    );

    const containerStyle = {
      width: resolved.width,
      height: resolved.height,
      overflow: 'hidden' as const,
      borderRadius: 12,
      backgroundColor: '#f5f5f5',
      position: 'relative' as const,
      ...resolved.style,
    };

    const children: unknown[] = [];

    if (renderInfo.showSpinner) {
      children.push(
        React.createElement('div', { key: 'spinner', 'aria-label': 'Loading' }),
      );
    }

    if (renderInfo.showSuccess) {
      children.push(
        React.createElement('div', { key: 'success', 'aria-label': 'Success' }),
      );
    }

    if (renderInfo.showError) {
      children.push(
        React.createElement('div', { key: 'error', 'aria-label': 'Error' }),
      );
    }

    if (renderInfo.progressPercent !== null) {
      children.push(
        React.createElement(
          'div',
          {
            key: 'progress',
            role: 'progressbar',
            'aria-valuenow': renderInfo.progressPercent,
            'aria-valuemin': 0,
            'aria-valuemax': 100,
          },
          React.createElement('div', {
            style: { width: `${renderInfo.progressPercent}%` },
          }),
        ),
      );
    }

    if (renderInfo.caption) {
      children.push(
        React.createElement('div', { key: 'caption' }, renderInfo.caption),
      );
    }

    const containerProps: Record<string, unknown> = {
      style: containerStyle,
      'aria-label': renderInfo.accessibilityLabel,
      'data-testid': resolved.testID,
    };

    if (resolved.onPress) {
      containerProps['onClick'] = resolved.onPress;
      containerProps['role'] = 'button';
      containerProps['tabIndex'] = 0;
    }

    return React.createElement('div', containerProps, ...children);
  };
}

export const IDLE_PREVIEW_STATE: Readonly<PreviewState> = {
  status: PreviewStatus.Idle,
  caption: '',
  progress: null,
};
