/**
 * Tests for the Navigation State Machine.
 */

import {
  NavigationPhase,
  isValidTransition,
  assertValidTransition,
  createIdleState,
  createNavigatingState,
  createLoadedState,
  createExtractingState,
  createCompleteState,
  createErrorState,
  NavigationErrorCode,
  type NavigationState,
  type NavigationError,
} from '../src/types/navigation';

describe('Navigation State Machine', () => {
  describe('valid transitions', () => {
    const validPairs: [string, string][] = [
      ['idle', 'navigating'],
      ['navigating', 'loaded'],
      ['navigating', 'error'],
      ['loaded', 'navigating'],
      ['loaded', 'extracting'],
      ['loaded', 'error'],
      ['extracting', 'complete'],
      ['extracting', 'error'],
      ['complete', 'idle'],
      ['complete', 'navigating'],
      ['error', 'idle'],
      ['error', 'navigating'],
    ];

    test.each(validPairs)('%s → %s is valid', (from, to) => {
      expect(isValidTransition(from as any, to as any)).toBe(true);
    });
  });

  describe('invalid transitions', () => {
    const invalidPairs: [string, string][] = [
      ['idle', 'loaded'],
      ['idle', 'extracting'],
      ['idle', 'complete'],
      ['idle', 'error'],
      ['navigating', 'extracting'],
      ['navigating', 'complete'],
      ['navigating', 'idle'],
      ['extracting', 'navigating'],
      ['extracting', 'idle'],
      ['extracting', 'loaded'],
      ['complete', 'extracting'],
      ['complete', 'loaded'],
      ['complete', 'error'],
    ];

    test.each(invalidPairs)('%s → %s is invalid', (from, to) => {
      expect(isValidTransition(from as any, to as any)).toBe(false);
    });
  });

  describe('assertValidTransition', () => {
    it('does not throw for valid transitions', () => {
      expect(() => assertValidTransition('idle', 'navigating')).not.toThrow();
    });

    it('throws for invalid transitions with descriptive message', () => {
      expect(() => assertValidTransition('idle', 'loaded')).toThrow(
        /Invalid state transition: idle → loaded/,
      );
    });

    it('includes valid transitions in error message', () => {
      expect(() => assertValidTransition('idle', 'complete')).toThrow(
        /Valid transitions from idle: \[navigating\]/,
      );
    });
  });

  describe('factory functions', () => {
    it('createIdleState', () => {
      const state = createIdleState();
      expect(state.phase).toBe(NavigationPhase.Idle);
    });

    it('createNavigatingState', () => {
      const state = createNavigatingState('https://example.com');
      expect(state.phase).toBe(NavigationPhase.Navigating);
      expect(state.url).toBe('https://example.com');
      expect(state.startedAt).toBeGreaterThan(0);
      expect(state.redirectChain).toEqual([]);
    });

    it('createNavigatingState with redirect chain', () => {
      const state = createNavigatingState('https://example.com', ['https://old.com']);
      expect(state.redirectChain).toEqual(['https://old.com']);
    });

    it('createLoadedState', () => {
      const state = createLoadedState('https://example.com', 200);
      expect(state.phase).toBe(NavigationPhase.Loaded);
      expect(state.url).toBe('https://example.com');
      expect(state.statusCode).toBe(200);
      expect(state.loadedAt).toBeGreaterThan(0);
    });

    it('createLoadedState with null status', () => {
      const state = createLoadedState('https://example.com', null);
      expect(state.statusCode).toBeNull();
    });

    it('createExtractingState', () => {
      const loadedAt = Date.now() - 500;
      const state = createExtractingState('https://example.com', loadedAt);
      expect(state.phase).toBe(NavigationPhase.Extracting);
      expect(state.loadedAt).toBe(loadedAt);
      expect(state.extractionStartedAt).toBeGreaterThan(0);
    });

    it('createCompleteState', () => {
      const startedAt = Date.now() - 1000;
      const state = createCompleteState('https://example.com', startedAt);
      expect(state.phase).toBe(NavigationPhase.Complete);
      expect(state.durationMs).toBeGreaterThanOrEqual(1000);
    });

    it('createErrorState', () => {
      const error: NavigationError = {
        code: NavigationErrorCode.Timeout,
        message: 'timed out',
        url: 'https://example.com',
      };
      const state = createErrorState(error, 'https://example.com', 'navigating');
      expect(state.phase).toBe(NavigationPhase.Error);
      expect(state.error).toBe(error);
      expect(state.failedUrl).toBe('https://example.com');
      expect(state.previousPhase).toBe('navigating');
    });
  });

  describe('type narrowing', () => {
    it('can narrow state types via switch', () => {
      const states: NavigationState[] = [
        createIdleState(),
        createNavigatingState('https://example.com'),
        createLoadedState('https://example.com', 200),
        createExtractingState('https://example.com', Date.now()),
        createCompleteState('https://example.com', Date.now()),
        createErrorState(
          { code: NavigationErrorCode.Timeout, message: 'timeout' },
          'https://example.com',
          'navigating',
        ),
      ];

      const phases = states.map((s) => {
        switch (s.phase) {
          case 'idle':
            return 'idle';
          case 'navigating':
            return `navigating:${s.url}`;
          case 'loaded':
            return `loaded:${s.statusCode}`;
          case 'extracting':
            return `extracting:${s.extractionStartedAt > 0}`;
          case 'complete':
            return `complete:${s.durationMs >= 0}`;
          case 'error':
            return `error:${s.error.code}`;
        }
      });

      expect(phases).toEqual([
        'idle',
        'navigating:https://example.com',
        'loaded:200',
        'extracting:true',
        'complete:true',
        'error:TIMEOUT',
      ]);
    });
  });

  describe('full state machine walk', () => {
    it('happy path: idle → navigating → loaded → extracting → complete → idle', () => {
      expect(isValidTransition('idle', 'navigating')).toBe(true);
      expect(isValidTransition('navigating', 'loaded')).toBe(true);
      expect(isValidTransition('loaded', 'extracting')).toBe(true);
      expect(isValidTransition('extracting', 'complete')).toBe(true);
      expect(isValidTransition('complete', 'idle')).toBe(true);
    });

    it('error recovery: idle → navigating → error → navigating → loaded', () => {
      expect(isValidTransition('idle', 'navigating')).toBe(true);
      expect(isValidTransition('navigating', 'error')).toBe(true);
      expect(isValidTransition('error', 'navigating')).toBe(true);
      expect(isValidTransition('navigating', 'loaded')).toBe(true);
    });
  });
});
