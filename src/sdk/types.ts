/**
 * SDK-level types for the Conduit preview system.
 *
 * These types represent the high-level preview state exposed to host apps,
 * separate from the internal browser preview controller types.
 */

// ─── Preview Status ──────────────────────────────────────────────────

/**
 * Status of the bank connection preview shown to the user.
 */
export const PreviewStatus = {
  /** No connection in progress */
  Idle: 'idle',
  /** Connection is initializing */
  Loading: 'loading',
  /** Actively interacting with the bank site */
  Active: 'active',
  /** Connection completed successfully */
  Complete: 'complete',
  /** Connection encountered an error */
  Error: 'error',
} as const;

export type PreviewStatusName = (typeof PreviewStatus)[keyof typeof PreviewStatus];

// ─── Preview State ───────────────────────────────────────────────────

/**
 * The high-level state of the Conduit preview component.
 *
 * This is the state object passed to ConduitPreview by host apps.
 * It abstracts away the internal browser engine details into a simple
 * status + caption + progress model.
 *
 * Invariants:
 * - progress is null when not applicable (idle, error, complete)
 * - progress is in [0.0, 1.0] when present
 * - caption is an empty string when no message is available
 */
export interface PreviewState {
  /** Current status of the preview */
  readonly status: PreviewStatusName;
  /** Human-readable caption describing the current step */
  readonly caption: string;
  /** Progress value in [0.0, 1.0], or null if not applicable */
  readonly progress: number | null;
}
