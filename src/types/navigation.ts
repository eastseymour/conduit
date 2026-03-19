/**
 * Navigation State Machine Types
 *
 * Implements a discriminated union for the browser navigation state machine.
 * States: idle → navigating → loaded → extracting → complete
 * Error state can be reached from any active state.
 *
 * Design: "Make illegal states unrepresentable" — each state variant
 * carries only the data relevant to that state, preventing access to
 * fields that don't exist in the current state.
 */

// ─── Phase Discriminants ──────────────────────────────────────────

export const NavigationPhase = {
  Idle: 'idle',
  Navigating: 'navigating',
  Loaded: 'loaded',
  Extracting: 'extracting',
  Complete: 'complete',
  Error: 'error',
} as const;

export type NavigationPhaseName = (typeof NavigationPhase)[keyof typeof NavigationPhase];

// ─── State Variants (Discriminated Union) ──────────────────────────

/** Browser is idle, no navigation in progress. */
export interface IdleState {
  readonly phase: typeof NavigationPhase.Idle;
}

/** Browser is navigating to a URL. */
export interface NavigatingState {
  readonly phase: typeof NavigationPhase.Navigating;
  readonly url: string;
  readonly startedAt: number;
  readonly redirectChain: readonly string[];
}

/** Page has finished loading. */
export interface LoadedState {
  readonly phase: typeof NavigationPhase.Loaded;
  readonly url: string;
  readonly loadedAt: number;
  readonly statusCode: number | null;
  readonly redirectChain: readonly string[];
}

/** Currently extracting data from the loaded page. */
export interface ExtractingState {
  readonly phase: typeof NavigationPhase.Extracting;
  readonly url: string;
  readonly loadedAt: number;
  readonly extractionStartedAt: number;
}

/** Navigation and extraction are complete. */
export interface CompleteState {
  readonly phase: typeof NavigationPhase.Complete;
  readonly url: string;
  readonly completedAt: number;
  readonly durationMs: number;
}

/** An error occurred during navigation or extraction. */
export interface ErrorState {
  readonly phase: typeof NavigationPhase.Error;
  readonly error: NavigationError;
  readonly failedUrl: string | null;
  readonly failedAt: number;
  readonly previousPhase: NavigationPhaseName;
}

/**
 * The complete navigation state — a discriminated union.
 * Use `state.phase` as the discriminant to narrow the type.
 */
export type NavigationState =
  | IdleState
  | NavigatingState
  | LoadedState
  | ExtractingState
  | CompleteState
  | ErrorState;

// ─── Error Types ───────────────────────────────────────────────────

export const NavigationErrorCode = {
  Timeout: 'TIMEOUT',
  LoadFailed: 'LOAD_FAILED',
  SSLError: 'SSL_ERROR',
  NetworkError: 'NETWORK_ERROR',
  JavaScriptError: 'JAVASCRIPT_ERROR',
  ExtractionError: 'EXTRACTION_ERROR',
  InvalidURL: 'INVALID_URL',
  Aborted: 'ABORTED',
} as const;

export type NavigationErrorCodeType =
  (typeof NavigationErrorCode)[keyof typeof NavigationErrorCode];

export interface NavigationError {
  readonly code: NavigationErrorCodeType;
  readonly message: string;
  readonly url?: string;
  readonly originalError?: unknown;
}

// ─── Transition Validation ─────────────────────────────────────────

/**
 * Valid state transitions. Encodes the state machine graph.
 *
 * idle       → navigating
 * navigating → loaded, error
 * loaded     → navigating (redirect/new nav), extracting, error
 * extracting → complete, error
 * complete   → idle, navigating (new navigation)
 * error      → idle, navigating (retry)
 */
const VALID_TRANSITIONS: Record<NavigationPhaseName, readonly NavigationPhaseName[]> = {
  [NavigationPhase.Idle]: [NavigationPhase.Navigating],
  [NavigationPhase.Navigating]: [NavigationPhase.Loaded, NavigationPhase.Error],
  [NavigationPhase.Loaded]: [
    NavigationPhase.Navigating,
    NavigationPhase.Extracting,
    NavigationPhase.Error,
  ],
  [NavigationPhase.Extracting]: [NavigationPhase.Complete, NavigationPhase.Error],
  [NavigationPhase.Complete]: [NavigationPhase.Idle, NavigationPhase.Navigating],
  [NavigationPhase.Error]: [NavigationPhase.Idle, NavigationPhase.Navigating],
} as const;

/**
 * Validates a state transition is legal.
 *
 * @precondition from and to must be valid NavigationPhaseName values
 * @postcondition returns true iff the transition from → to is in the state machine graph
 */
export function isValidTransition(from: NavigationPhaseName, to: NavigationPhaseName): boolean {
  const allowed = VALID_TRANSITIONS[from];
  return allowed.includes(to);
}

/**
 * Asserts a state transition is valid, throwing if not.
 * Use at transition boundaries to enforce the state machine invariant.
 */
export function assertValidTransition(from: NavigationPhaseName, to: NavigationPhaseName): void {
  if (!isValidTransition(from, to)) {
    throw new Error(
      `Invalid state transition: ${from} → ${to}. ` +
        `Valid transitions from ${from}: [${VALID_TRANSITIONS[from].join(', ')}]`,
    );
  }
}

// ─── Factory Functions ─────────────────────────────────────────────

export function createIdleState(): IdleState {
  return { phase: NavigationPhase.Idle };
}

export function createNavigatingState(
  url: string,
  redirectChain: readonly string[] = [],
): NavigatingState {
  return {
    phase: NavigationPhase.Navigating,
    url,
    startedAt: Date.now(),
    redirectChain,
  };
}

export function createLoadedState(
  url: string,
  statusCode: number | null,
  redirectChain: readonly string[] = [],
): LoadedState {
  return {
    phase: NavigationPhase.Loaded,
    url,
    loadedAt: Date.now(),
    statusCode,
    redirectChain,
  };
}

export function createExtractingState(url: string, loadedAt: number): ExtractingState {
  return {
    phase: NavigationPhase.Extracting,
    url,
    loadedAt,
    extractionStartedAt: Date.now(),
  };
}

export function createCompleteState(url: string, startedAt: number): CompleteState {
  const now = Date.now();
  return {
    phase: NavigationPhase.Complete,
    url,
    completedAt: now,
    durationMs: now - startedAt,
  };
}

export function createErrorState(
  error: NavigationError,
  failedUrl: string | null,
  previousPhase: NavigationPhaseName,
): ErrorState {
  return {
    phase: NavigationPhase.Error,
    error,
    failedUrl,
    failedAt: Date.now(),
    previousPhase,
  };
}
