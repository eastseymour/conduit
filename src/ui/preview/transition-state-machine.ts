/**
 * Page Transition State Machine — Manages animated transitions between pages.
 *
 * Controls the lifecycle of page-to-page animations in the browser preview.
 * When the browser navigates to a new URL, the transition machine:
 * 1. Captures the current state (fromUrl)
 * 2. Begins the animation (transitioning phase)
 * 3. Advances progress via tick()
 * 4. Completes the transition (complete phase)
 * 5. Returns to idle (ready for next navigation)
 *
 * State machine: idle → transitioning → complete → idle
 *
 * Design: "Correctness by Construction"
 * - State transitions enforced by assertValidTransitionPhaseChange
 * - Progress is clamped to [0.0, 1.0]
 * - Duration must be non-negative
 * - fromUrl can be null (first navigation), toUrl cannot be empty
 *
 * Invariants:
 * 1. Only one transition active at a time
 * 2. Progress is always in [0.0, 1.0]
 * 3. State transitions follow idle → transitioning → complete → idle
 * 4. Complete phase always has a valid URL
 * 5. Calling start() while transitioning cancels the current transition first
 */

import type {
  TransitionState,
  TransitionIdleState,
  TransitionTransitioningState,
  TransitionCompleteState,
  TransitionTypeName,
} from './types';
import {
  TransitionPhase,
  TransitionType,
  assertValidTransitionPhaseChange,
} from './types';

// ─── Listener Type ───────────────────────────────────────────────────

export type TransitionStateListener = (state: TransitionState) => void;

// ─── Transition State Machine ────────────────────────────────────────

export class TransitionStateMachine {
  private _state: TransitionState;
  private readonly _listeners: Set<TransitionStateListener> = new Set();
  private _defaultDurationMs: number;
  private _defaultType: TransitionTypeName;

  constructor(
    durationMs: number = 300,
    type: TransitionTypeName = TransitionType.Fade,
  ) {
    assert(durationMs >= 0, `Duration must be non-negative, got ${durationMs}`);
    this._defaultDurationMs = durationMs;
    this._defaultType = type;
    this._state = createTransitionIdleState();
  }

  // ─── Getters ────────────────────────────────────────────────────

  get state(): TransitionState {
    return this._state;
  }

  get phase(): TransitionState['phase'] {
    return this._state.phase;
  }

  get isIdle(): boolean {
    return this._state.phase === TransitionPhase.Idle;
  }

  get isTransitioning(): boolean {
    return this._state.phase === TransitionPhase.Transitioning;
  }

  get defaultDurationMs(): number {
    return this._defaultDurationMs;
  }

  get defaultType(): TransitionTypeName {
    return this._defaultType;
  }

  // ─── Configuration ──────────────────────────────────────────────

  setDefaultDuration(durationMs: number): void {
    assert(durationMs >= 0, `Duration must be non-negative, got ${durationMs}`);
    this._defaultDurationMs = durationMs;
  }

  setDefaultType(type: TransitionTypeName): void {
    this._defaultType = type;
  }

  // ─── Event System ───────────────────────────────────────────────

  on(listener: TransitionStateListener): () => void {
    this._listeners.add(listener);
    return () => {
      this._listeners.delete(listener);
    };
  }

  private emit(): void {
    for (const listener of this._listeners) {
      try {
        listener(this._state);
      } catch {
        /* listener errors must not break the state machine */
      }
    }
  }

  // ─── State Transitions ──────────────────────────────────────────

  /**
   * Start a new transition.
   *
   * If already transitioning, the current transition is force-completed
   * before starting the new one.
   *
   * @precondition toUrl is non-empty
   * @postcondition state is TransitionTransitioningState
   */
  start(
    fromUrl: string | null,
    toUrl: string,
    options?: {
      durationMs?: number;
      animationType?: TransitionTypeName;
    },
  ): void {
    assert(
      toUrl.length > 0,
      'toUrl must be non-empty',
    );

    // If already transitioning, force-complete first
    if (this._state.phase === TransitionPhase.Transitioning) {
      this.forceComplete();
    }

    // If in complete state, return to idle first
    if (this._state.phase === TransitionPhase.Complete) {
      this.reset();
    }

    const durationMs = options?.durationMs ?? this._defaultDurationMs;
    const animationType = options?.animationType ?? this._defaultType;

    assert(durationMs >= 0, `Duration must be non-negative, got ${durationMs}`);

    // Handle zero-duration transitions as instant
    if (durationMs === 0 || animationType === TransitionType.None) {
      // Go through transitioning → complete immediately
      const transitioning = createTransitionTransitioningState(
        fromUrl, toUrl, animationType, 1.0, durationMs,
      );
      assertValidTransitionPhaseChange(this._state.phase, transitioning.phase);
      this._state = transitioning;
      this.emit();

      const complete = createTransitionCompleteState(toUrl);
      assertValidTransitionPhaseChange(this._state.phase, complete.phase);
      this._state = complete;
      this.emit();
      return;
    }

    const newState = createTransitionTransitioningState(
      fromUrl, toUrl, animationType, 0, durationMs,
    );
    assertValidTransitionPhaseChange(this._state.phase, newState.phase);
    this._state = newState;
    this.emit();
  }

  /**
   * Advance the transition progress.
   *
   * @precondition Must be in transitioning phase
   * @precondition progress is in [0.0, 1.0]
   * @postcondition If progress >= 1.0, transition completes automatically
   */
  tick(progress: number): void {
    if (this._state.phase !== TransitionPhase.Transitioning) {
      return; // Silently ignore ticks outside transitioning phase
    }

    const clamped = Math.max(0, Math.min(1, progress));

    if (clamped >= 1.0) {
      this.complete();
      return;
    }

    this._state = {
      ...this._state,
      progress: clamped,
    };
    this.emit();
  }

  /**
   * Advance transition based on elapsed time since start.
   *
   * @precondition Must be in transitioning phase
   * @postcondition Progress updated based on elapsed / duration ratio
   */
  tickByTime(currentTime: number = Date.now()): void {
    if (this._state.phase !== TransitionPhase.Transitioning) {
      return;
    }

    const elapsed = currentTime - this._state.startedAt;
    const progress = this._state.durationMs > 0
      ? elapsed / this._state.durationMs
      : 1.0;

    this.tick(progress);
  }

  /**
   * Complete the current transition.
   *
   * @precondition Must be in transitioning phase
   * @postcondition state is TransitionCompleteState
   */
  complete(): void {
    if (this._state.phase !== TransitionPhase.Transitioning) {
      throw new Error(
        `Cannot complete transition in phase '${this._state.phase}'. Expected 'transitioning'.`,
      );
    }

    const completeState = createTransitionCompleteState(this._state.toUrl);
    assertValidTransitionPhaseChange(this._state.phase, completeState.phase);
    this._state = completeState;
    this.emit();
  }

  /**
   * Force-complete a transition without advancing through phases.
   * Used when a new navigation interrupts an in-progress transition.
   */
  forceComplete(): void {
    if (this._state.phase === TransitionPhase.Transitioning) {
      const complete = createTransitionCompleteState(this._state.toUrl);
      // Skip validation — this is an intentional force
      this._state = complete;
      this.emit();
    }
  }

  /**
   * Reset to idle state.
   *
   * @precondition Must be in complete phase
   * @postcondition state is TransitionIdleState
   */
  reset(): void {
    if (this._state.phase === TransitionPhase.Idle) {
      return; // Already idle
    }

    if (this._state.phase === TransitionPhase.Transitioning) {
      this.forceComplete();
    }

    const idleState = createTransitionIdleState();
    assertValidTransitionPhaseChange(this._state.phase, idleState.phase);
    this._state = idleState;
    this.emit();
  }

  /**
   * Force reset to idle regardless of current state.
   * Used during disposal or error recovery.
   */
  forceReset(): void {
    this._state = createTransitionIdleState();
    this.emit();
  }

  /**
   * Dispose of the state machine and clear all listeners.
   */
  dispose(): void {
    this._listeners.clear();
    this._state = createTransitionIdleState();
  }
}

// ─── Factory Functions ───────────────────────────────────────────────

export function createTransitionIdleState(): TransitionIdleState {
  return { phase: TransitionPhase.Idle };
}

export function createTransitionTransitioningState(
  fromUrl: string | null,
  toUrl: string,
  animationType: TransitionTypeName,
  progress: number,
  durationMs: number,
): TransitionTransitioningState {
  return {
    phase: TransitionPhase.Transitioning,
    fromUrl,
    toUrl,
    animationType,
    progress: Math.max(0, Math.min(1, progress)),
    startedAt: Date.now(),
    durationMs,
  };
}

export function createTransitionCompleteState(
  url: string,
): TransitionCompleteState {
  return {
    phase: TransitionPhase.Complete,
    url,
    completedAt: Date.now(),
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}
