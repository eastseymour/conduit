/**
 * UI module — React components, visual browser preview, and headless components
 * for the Conduit link flow.
 */

export {
  BankSelectorController,
  type BankSelectorState,
  type BankSelectorListener,
} from './BankSelector';

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
