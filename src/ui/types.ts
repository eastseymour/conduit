/**
 * UI component types for the Conduit SDK.
 */

import type { PreviewState, PreviewStatusName } from '../sdk/types';

export interface ConduitPreviewProps {
  readonly state: PreviewState;
  readonly width?: number;
  readonly height?: number;
  readonly showCaption?: boolean;
  readonly showProgress?: boolean;
  readonly style?: Record<string, unknown>;
  readonly onPress?: () => void;
  readonly testID?: string;
}

export interface PreviewRenderInfo {
  readonly showSpinner: boolean;
  readonly showSuccess: boolean;
  readonly showError: boolean;
  readonly progressPercent: number | null;
  readonly caption: string;
  readonly accessibilityLabel: string;
}

/**
 * Derive render info from preview state and props.
 * Pure function — no side effects.
 */
export function computePreviewRenderInfo(
  state: PreviewState,
  showCaption: boolean,
  showProgress: boolean,
): PreviewRenderInfo {
  const caption = showCaption ? state.caption : '';
  const progressPercent =
    showProgress && state.progress !== null ? Math.round(state.progress * 100) : null;

  const statusAccessibilityMap: Record<PreviewStatusName, string> = {
    idle: 'Bank connection preview, idle',
    loading: 'Bank connection preview, loading',
    active: `Bank connection preview, ${state.caption}`,
    complete: 'Bank connection complete',
    error: `Bank connection error: ${state.caption}`,
  };

  return {
    showSpinner: state.status === 'loading' || state.status === 'active',
    showSuccess: state.status === 'complete',
    showError: state.status === 'error',
    progressPercent,
    caption,
    accessibilityLabel: statusAccessibilityMap[state.status],
  };
}
