/**
 * UI module — React components and visual browser preview for host app integration.
 */

export {
  createConduitPreview,
  resolvePreviewProps,
  getPreviewRenderInfo,
  IDLE_PREVIEW_STATE,
  type ReactLike,
} from './ConduitPreview';

export {
  type ConduitPreviewProps,
  type PreviewRenderInfo,
  computePreviewRenderInfo,
} from './types';

// Visual browser preview (CDT-4)
export * from './preview';
