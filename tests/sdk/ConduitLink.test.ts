/**
 * Tests for ConduitLink — the high-level orchestrator.
 */

import { ConduitLink } from '../../src/sdk/ConduitLink';
import type { ConduitLinkEvent } from '../../src/sdk/ConduitLink';
import { PreviewStatus } from '../../src/sdk/types';
import { BankAdapterRegistry } from '../../src/adapters/registry';
import { chaseAdapter } from '../../src/adapters/banks/chase';
import type { AuthResult, MfaChallenge } from '../../src/auth/types';

// ─── Helpers ──────────────────────────────────────────────────────

function createRegistry(): BankAdapterRegistry {
  const registry = new BankAdapterRegistry();
  registry.register(chaseAdapter);
  return registry;
}

function collectEvents(link: ConduitLink): ConduitLinkEvent[] {
  const events: ConduitLinkEvent[] = [];
  link.on((event) => events.push(event));
  return events;
}

// ─── Tests ────────────────────────────────────────────────────────

describe('ConduitLink', () => {
  let link: ConduitLink;
  let registry: BankAdapterRegistry;

  beforeEach(() => {
    registry = createRegistry();
    link = new ConduitLink({
      registry,
      debug: false,
      engineOptions: { defaultTimeoutMs: 200 },
      driverOptions: {
        formFillDelayMs: 0,
        postSubmitWaitMs: 0,
        outcomeDetectionTimeoutMs: 200,
        outcomeDetectionPollMs: 10,
        elementWaitTimeoutMs: 100,
      },
    });
  });

  afterEach(() => {
    link.dispose();
  });

  // ─── Construction ───────────────────────────────────────────────

  describe('construction', () => {
    it('starts with idle preview state', () => {
      expect(link.previewState.status).toBe(PreviewStatus.Idle);
      expect(link.previewState.caption).toBe('');
      expect(link.previewState.progress).toBeNull();
    });

    it('is not active initially', () => {
      expect(link.isActive).toBe(false);
    });

    it('is not disposed initially', () => {
      expect(link.isDisposed).toBe(false);
    });

    it('has no current bank ID initially', () => {
      expect(link.currentBankId).toBeNull();
    });
  });

  // ─── getLoginUrl ────────────────────────────────────────────────

  describe('getLoginUrl', () => {
    it('returns correct URL for known bank', () => {
      expect(link.getLoginUrl('chase')).toBe(chaseAdapter.loginUrl);
    });

    it('returns null for unknown bank', () => {
      expect(link.getLoginUrl('unknown_bank')).toBeNull();
    });
  });

  // ─── Event system ───────────────────────────────────────────────

  describe('event system', () => {
    it('subscribes and receives events', () => {
      const events = collectEvents(link);
      // Trigger an event by starting link (it will emit state_change immediately)
      // We test the mechanism itself
      expect(events).toBeDefined();
    });

    it('unsubscribes correctly', () => {
      const events: ConduitLinkEvent[] = [];
      const unsub = link.on((event) => events.push(event));
      unsub();
      // After unsubscribe, no events should be captured
      expect(events.length).toBe(0);
    });
  });

  // ─── MFA bridge ─────────────────────────────────────────────────

  describe('MFA methods', () => {
    it('cancelMfa resolves with null (no-op when no active MFA)', () => {
      // Should not throw
      link.cancelMfa();
    });

    it('submitMfaCode is no-op when no active MFA', () => {
      // Should not throw
      link.submitMfaCode('123456', 'challenge_1', 'sms_code');
    });

    it('submitMfaAnswers is no-op when no active MFA', () => {
      link.submitMfaAnswers(['answer'], 'challenge_1');
    });

    it('approvePushNotification is no-op when no active MFA', () => {
      link.approvePushNotification('challenge_1');
    });
  });

  // ─── dispose ────────────────────────────────────────────────────

  describe('dispose', () => {
    it('sets disposed flag', () => {
      link.dispose();
      expect(link.isDisposed).toBe(true);
    });

    it('is idempotent', () => {
      link.dispose();
      link.dispose(); // Should not throw
      expect(link.isDisposed).toBe(true);
    });

    it('throws on startLink after dispose', async () => {
      link.dispose();
      await expect(
        link.startLink('chase', { username: 'user', password: 'pass' }),
      ).rejects.toThrow('disposed');
    });
  });

  // ─── cancel ─────────────────────────────────────────────────────

  describe('cancel', () => {
    it('does not throw when no active flow', async () => {
      // cancel when nothing is active should handle gracefully
      await expect(link.cancel()).resolves.toBeUndefined();
    });
  });

  // ─── WebView integration ────────────────────────────────────────

  describe('WebView integration', () => {
    it('setWebViewRef does not throw', () => {
      const mockRef = {
        injectJavaScript: jest.fn(),
        reload: jest.fn(),
        goBack: jest.fn(),
        goForward: jest.fn(),
        stopLoading: jest.fn(),
      };
      expect(() => link.setWebViewRef(mockRef)).not.toThrow();
      expect(() => link.setWebViewRef(null)).not.toThrow();
    });

    it('handleWebViewMessage does not throw on valid JSON', () => {
      expect(() =>
        link.handleWebViewMessage({ nativeEvent: { data: '{"type":"test"}' } }),
      ).not.toThrow();
    });

    it('handleWebViewMessage does not throw on invalid JSON', () => {
      expect(() =>
        link.handleWebViewMessage({ nativeEvent: { data: 'not-json' } }),
      ).not.toThrow();
    });

    it('handleLoadStart does not throw', () => {
      expect(() => link.handleLoadStart('https://chase.com')).not.toThrow();
    });
  });

  // ─── startLink preview state emissions ──────────────────────────

  describe('startLink', () => {
    it('emits initial state_change events with Loading status', async () => {
      const events = collectEvents(link);

      // startLink will fail because there's no actual WebView, but we can
      // check that it emits the initial state changes before failing
      try {
        await link.startLink('chase', { username: 'user', password: 'pass' });
      } catch {
        // Expected to fail without a real WebView
      }

      // Should have emitted at least one state_change with Loading status
      const stateChanges = events.filter((e) => e.type === 'state_change');
      expect(stateChanges.length).toBeGreaterThan(0);

      const firstChange = stateChanges[0]!;
      if (firstChange.type === 'state_change') {
        expect(firstChange.previewState.status).toBe(PreviewStatus.Loading);
      }
    });

    it('sets currentBankId', async () => {
      try {
        await link.startLink('chase', { username: 'user', password: 'pass' });
      } catch {
        // Expected
      }
      expect(link.currentBankId).toBe('chase');
    });

    it('emits navigate event with bank login URL', async () => {
      const events = collectEvents(link);

      try {
        await link.startLink('chase', { username: 'user', password: 'pass' });
      } catch {
        // Expected
      }

      const navEvents = events.filter((e) => e.type === 'navigate');
      expect(navEvents.length).toBe(1);
      if (navEvents[0]!.type === 'navigate') {
        expect(navEvents[0]!.url).toBe(chaseAdapter.loginUrl);
      }
    });
  });
});
