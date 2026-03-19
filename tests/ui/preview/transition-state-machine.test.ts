/**
 * Tests for Transition State Machine (CDT-4)
 */

import {
  TransitionStateMachine,
  createTransitionIdleState,
  createTransitionTransitioningState,
  createTransitionCompleteState,
} from '../../../src/ui/preview/transition-state-machine';
import { TransitionPhase, TransitionType } from '../../../src/ui/preview/types';

// ─── Construction Tests ──────────────────────────────────────────────

describe('TransitionStateMachine — construction', () => {
  it('starts in idle state', () => {
    const machine = new TransitionStateMachine();
    expect(machine.state.phase).toBe(TransitionPhase.Idle);
    expect(machine.isIdle).toBe(true);
    expect(machine.isTransitioning).toBe(false);
  });

  it('accepts default duration and type', () => {
    const machine = new TransitionStateMachine(500, TransitionType.SlideLeft);
    expect(machine.defaultDurationMs).toBe(500);
    expect(machine.defaultType).toBe('slide_left');
  });

  it('uses 300ms and fade as defaults', () => {
    const machine = new TransitionStateMachine();
    expect(machine.defaultDurationMs).toBe(300);
    expect(machine.defaultType).toBe('fade');
  });

  it('throws for negative duration', () => {
    expect(() => new TransitionStateMachine(-100)).toThrow('Duration must be non-negative');
  });

  it('accepts zero duration', () => {
    const machine = new TransitionStateMachine(0);
    expect(machine.defaultDurationMs).toBe(0);
  });
});

// ─── Start Transition Tests ──────────────────────────────────────────

describe('TransitionStateMachine — start()', () => {
  let machine: TransitionStateMachine;

  beforeEach(() => {
    machine = new TransitionStateMachine(300, TransitionType.Fade);
  });

  it('transitions from idle to transitioning', () => {
    machine.start(null, 'https://bank.com/login');
    expect(machine.phase).toBe(TransitionPhase.Transitioning);
    expect(machine.isTransitioning).toBe(true);
  });

  it('sets fromUrl and toUrl', () => {
    machine.start('https://bank.com/home', 'https://bank.com/login');
    const state = machine.state;
    expect(state.phase).toBe(TransitionPhase.Transitioning);
    if (state.phase === TransitionPhase.Transitioning) {
      expect(state.fromUrl).toBe('https://bank.com/home');
      expect(state.toUrl).toBe('https://bank.com/login');
    }
  });

  it('allows null fromUrl (first navigation)', () => {
    machine.start(null, 'https://bank.com/login');
    const state = machine.state;
    if (state.phase === TransitionPhase.Transitioning) {
      expect(state.fromUrl).toBeNull();
      expect(state.toUrl).toBe('https://bank.com/login');
    }
  });

  it('sets progress to 0', () => {
    machine.start(null, 'https://bank.com/login');
    const state = machine.state;
    if (state.phase === TransitionPhase.Transitioning) {
      expect(state.progress).toBe(0);
    }
  });

  it('uses default duration and type', () => {
    machine.start(null, 'https://bank.com/login');
    const state = machine.state;
    if (state.phase === TransitionPhase.Transitioning) {
      expect(state.durationMs).toBe(300);
      expect(state.animationType).toBe('fade');
    }
  });

  it('accepts custom duration and type', () => {
    machine.start(null, 'https://bank.com/login', {
      durationMs: 500,
      animationType: TransitionType.SlideLeft,
    });
    const state = machine.state;
    if (state.phase === TransitionPhase.Transitioning) {
      expect(state.durationMs).toBe(500);
      expect(state.animationType).toBe('slide_left');
    }
  });

  it('throws for empty toUrl', () => {
    expect(() => machine.start(null, '')).toThrow('toUrl must be non-empty');
  });

  it('force-completes existing transition when starting new one', () => {
    const events: string[] = [];
    machine.on((state) => events.push(state.phase));

    machine.start(null, 'https://bank.com/login');
    machine.start('https://bank.com/login', 'https://bank.com/accounts');

    // Should see: transitioning, complete, idle, transitioning
    expect(events).toContain(TransitionPhase.Complete);
    expect(machine.phase).toBe(TransitionPhase.Transitioning);
    const state = machine.state;
    if (state.phase === TransitionPhase.Transitioning) {
      expect(state.toUrl).toBe('https://bank.com/accounts');
    }
  });

  it('handles zero-duration as instant transition', () => {
    const events: string[] = [];
    machine.on((state) => events.push(state.phase));

    machine.start(null, 'https://bank.com/login', { durationMs: 0 });

    // Should go through transitioning → complete instantly
    expect(events).toContain(TransitionPhase.Transitioning);
    expect(events).toContain(TransitionPhase.Complete);
    expect(machine.phase).toBe(TransitionPhase.Complete);
  });

  it('handles TransitionType.None as instant transition', () => {
    machine.start(null, 'https://bank.com/login', {
      animationType: TransitionType.None,
    });
    expect(machine.phase).toBe(TransitionPhase.Complete);
  });
});

// ─── Tick Tests ──────────────────────────────────────────────────────

describe('TransitionStateMachine — tick()', () => {
  let machine: TransitionStateMachine;

  beforeEach(() => {
    machine = new TransitionStateMachine(300);
    machine.start(null, 'https://bank.com/login');
  });

  it('updates progress', () => {
    machine.tick(0.5);
    const state = machine.state;
    if (state.phase === TransitionPhase.Transitioning) {
      expect(state.progress).toBe(0.5);
    }
  });

  it('clamps progress to [0, 1]', () => {
    machine.tick(-0.5);
    let state = machine.state;
    if (state.phase === TransitionPhase.Transitioning) {
      expect(state.progress).toBe(0);
    }

    machine.tick(0.5);
    machine.tick(1.5); // Should auto-complete
    // After tick(1.5), it should complete
    expect(machine.phase).toBe(TransitionPhase.Complete);
  });

  it('auto-completes at progress >= 1.0', () => {
    machine.tick(1.0);
    expect(machine.phase).toBe(TransitionPhase.Complete);
  });

  it('silently ignores ticks when not transitioning', () => {
    machine.complete();
    machine.reset();
    expect(() => machine.tick(0.5)).not.toThrow();
    expect(machine.phase).toBe(TransitionPhase.Idle);
  });

  it('emits on progress updates', () => {
    const events: number[] = [];
    machine.on((state) => {
      if (state.phase === TransitionPhase.Transitioning) {
        events.push(state.progress);
      }
    });

    machine.tick(0.25);
    machine.tick(0.5);
    machine.tick(0.75);

    expect(events).toEqual([0.25, 0.5, 0.75]);
  });
});

// ─── tickByTime Tests ────────────────────────────────────────────────

describe('TransitionStateMachine — tickByTime()', () => {
  it('calculates progress from elapsed time', () => {
    const machine = new TransitionStateMachine(1000);
    machine.start(null, 'https://bank.com/login');

    const state = machine.state;
    if (state.phase === TransitionPhase.Transitioning) {
      // Simulate 500ms elapsed
      machine.tickByTime(state.startedAt + 500);
      const updated = machine.state;
      if (updated.phase === TransitionPhase.Transitioning) {
        expect(updated.progress).toBeCloseTo(0.5, 1);
      }
    }
  });

  it('auto-completes when elapsed >= duration', () => {
    const machine = new TransitionStateMachine(300);
    machine.start(null, 'https://bank.com/login');

    const state = machine.state;
    if (state.phase === TransitionPhase.Transitioning) {
      machine.tickByTime(state.startedAt + 400);
      expect(machine.phase).toBe(TransitionPhase.Complete);
    }
  });

  it('silently ignores when not transitioning', () => {
    const machine = new TransitionStateMachine(300);
    expect(() => machine.tickByTime(Date.now())).not.toThrow();
    expect(machine.phase).toBe(TransitionPhase.Idle);
  });
});

// ─── Complete Tests ──────────────────────────────────────────────────

describe('TransitionStateMachine — complete()', () => {
  it('transitions from transitioning to complete', () => {
    const machine = new TransitionStateMachine();
    machine.start(null, 'https://bank.com/login');
    machine.complete();
    expect(machine.phase).toBe(TransitionPhase.Complete);
  });

  it('sets the URL in complete state', () => {
    const machine = new TransitionStateMachine();
    machine.start(null, 'https://bank.com/login');
    machine.complete();
    const state = machine.state;
    if (state.phase === TransitionPhase.Complete) {
      expect(state.url).toBe('https://bank.com/login');
    }
  });

  it('throws when not in transitioning phase', () => {
    const machine = new TransitionStateMachine();
    expect(() => machine.complete()).toThrow("Cannot complete transition in phase 'idle'");
  });
});

// ─── Reset Tests ─────────────────────────────────────────────────────

describe('TransitionStateMachine — reset()', () => {
  it('transitions from complete to idle', () => {
    const machine = new TransitionStateMachine();
    machine.start(null, 'https://bank.com/login');
    machine.complete();
    machine.reset();
    expect(machine.phase).toBe(TransitionPhase.Idle);
    expect(machine.isIdle).toBe(true);
  });

  it('is a no-op when already idle', () => {
    const machine = new TransitionStateMachine();
    machine.reset();
    expect(machine.phase).toBe(TransitionPhase.Idle);
  });

  it('force-completes then resets when transitioning', () => {
    const machine = new TransitionStateMachine();
    machine.start(null, 'https://bank.com/login');
    machine.reset();
    expect(machine.phase).toBe(TransitionPhase.Idle);
  });
});

// ─── Force Reset Tests ───────────────────────────────────────────────

describe('TransitionStateMachine — forceReset()', () => {
  it('resets to idle from any state', () => {
    const machine = new TransitionStateMachine();
    machine.start(null, 'https://bank.com/login');
    machine.forceReset();
    expect(machine.phase).toBe(TransitionPhase.Idle);
  });

  it('emits state change', () => {
    const machine = new TransitionStateMachine();
    machine.start(null, 'https://bank.com/login');

    let emitted = false;
    machine.on((state) => {
      if (state.phase === TransitionPhase.Idle) emitted = true;
    });
    machine.forceReset();
    expect(emitted).toBe(true);
  });
});

// ─── Configuration Tests ─────────────────────────────────────────────

describe('TransitionStateMachine — configuration', () => {
  it('allows changing default duration', () => {
    const machine = new TransitionStateMachine(300);
    machine.setDefaultDuration(500);
    expect(machine.defaultDurationMs).toBe(500);
  });

  it('throws for negative duration', () => {
    const machine = new TransitionStateMachine();
    expect(() => machine.setDefaultDuration(-1)).toThrow('Duration must be non-negative');
  });

  it('allows changing default type', () => {
    const machine = new TransitionStateMachine();
    machine.setDefaultType(TransitionType.SlideLeft);
    expect(machine.defaultType).toBe('slide_left');
  });
});

// ─── Event System Tests ──────────────────────────────────────────────

describe('TransitionStateMachine — event system', () => {
  it('notifies listeners on state changes', () => {
    const machine = new TransitionStateMachine();
    const events: string[] = [];
    machine.on((state) => events.push(state.phase));

    machine.start(null, 'https://bank.com/login');
    machine.complete();
    machine.reset();

    expect(events).toEqual([
      TransitionPhase.Transitioning,
      TransitionPhase.Complete,
      TransitionPhase.Idle,
    ]);
  });

  it('returns unsubscribe function', () => {
    const machine = new TransitionStateMachine();
    const events: string[] = [];
    const unsubscribe = machine.on((state) => events.push(state.phase));

    machine.start(null, 'https://bank.com/login');
    unsubscribe();
    machine.complete();

    expect(events).toEqual([TransitionPhase.Transitioning]);
  });

  it('does not break on listener errors', () => {
    const machine = new TransitionStateMachine();
    machine.on(() => {
      throw new Error('Listener error');
    });

    expect(() => machine.start(null, 'https://bank.com/login')).not.toThrow();
    expect(machine.phase).toBe(TransitionPhase.Transitioning);
  });
});

// ─── Dispose Tests ───────────────────────────────────────────────────

describe('TransitionStateMachine — dispose()', () => {
  it('clears all listeners', () => {
    const machine = new TransitionStateMachine();
    const events: string[] = [];
    machine.on((state) => events.push(state.phase));

    machine.dispose();
    // No events should be emitted after dispose
    expect(events).toHaveLength(0);
  });

  it('resets to idle state', () => {
    const machine = new TransitionStateMachine();
    machine.start(null, 'https://bank.com/login');
    machine.dispose();
    expect(machine.phase).toBe(TransitionPhase.Idle);
  });
});

// ─── Factory Function Tests ──────────────────────────────────────────

describe('createTransitionIdleState()', () => {
  it('creates idle state', () => {
    const state = createTransitionIdleState();
    expect(state.phase).toBe(TransitionPhase.Idle);
  });
});

describe('createTransitionTransitioningState()', () => {
  it('creates transitioning state with all fields', () => {
    const state = createTransitionTransitioningState(
      'https://from.com',
      'https://to.com',
      TransitionType.Fade,
      0.5,
      300,
    );
    expect(state.phase).toBe(TransitionPhase.Transitioning);
    expect(state.fromUrl).toBe('https://from.com');
    expect(state.toUrl).toBe('https://to.com');
    expect(state.animationType).toBe('fade');
    expect(state.progress).toBe(0.5);
    expect(state.durationMs).toBe(300);
    expect(state.startedAt).toBeGreaterThan(0);
  });

  it('clamps progress to [0, 1]', () => {
    const state1 = createTransitionTransitioningState(null, 'https://to.com', 'fade', -0.5, 300);
    expect(state1.progress).toBe(0);

    const state2 = createTransitionTransitioningState(null, 'https://to.com', 'fade', 1.5, 300);
    expect(state2.progress).toBe(1);
  });
});

describe('createTransitionCompleteState()', () => {
  it('creates complete state', () => {
    const state = createTransitionCompleteState('https://bank.com/login');
    expect(state.phase).toBe(TransitionPhase.Complete);
    expect(state.url).toBe('https://bank.com/login');
    expect(state.completedAt).toBeGreaterThan(0);
  });
});
