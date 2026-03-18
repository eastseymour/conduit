/**
 * Tests for the MessageBridge communication layer.
 */

import { MessageBridge, BRIDGE_INJECTION_SCRIPT } from '../src/core/MessageBridge';
import type { WebViewRef } from '../src/types/bridge';
import { InboundMessageType, OutboundMessageType, resetMessageCounter, generateMessageId } from '../src/types';

function createMockWebViewRef(): WebViewRef & { injectedScripts: string[] } {
  const injectedScripts: string[] = [];
  return {
    injectedScripts,
    injectJavaScript: jest.fn((script: string) => { injectedScripts.push(script); }),
    reload: jest.fn(),
    goBack: jest.fn(),
    goForward: jest.fn(),
    stopLoading: jest.fn(),
  };
}

describe('MessageBridge', () => {
  let bridge: MessageBridge;
  let mockRef: ReturnType<typeof createMockWebViewRef>;

  beforeEach(() => {
    bridge = new MessageBridge({ defaultTimeoutMs: 5000, debug: false });
    mockRef = createMockWebViewRef();
    resetMessageCounter();
  });

  afterEach(() => { bridge.dispose(); });

  describe('connection', () => {
    it('starts disconnected', () => {
      expect(bridge.isConnected()).toBe(false);
    });

    it('becomes connected when ref is set', () => {
      bridge.setWebViewRef(mockRef);
      expect(bridge.isConnected()).toBe(true);
    });

    it('becomes disconnected when ref is null', () => {
      bridge.setWebViewRef(mockRef);
      bridge.setWebViewRef(null);
      expect(bridge.isConnected()).toBe(false);
    });

    it('injects bridge script on ref set', () => {
      bridge.setWebViewRef(mockRef);
      expect(mockRef.injectJavaScript).toHaveBeenCalledWith(BRIDGE_INJECTION_SCRIPT);
    });
  });

  describe('sendMessage', () => {
    it('rejects when no WebView ref is set', async () => {
      await expect(bridge.sendMessage({ type: OutboundMessageType.GetCookies })).rejects.toThrow('WebView ref not set');
    });

    it('injects JavaScript into WebView', () => {
      bridge.setWebViewRef(mockRef);
      // Catch the eventual rejection from dispose() to avoid unhandled rejection
      bridge.sendMessage({ type: OutboundMessageType.GetCookies }).catch(() => {});
      expect(mockRef.injectJavaScript).toHaveBeenCalledTimes(2); // bridge + message
    });

    it('tracks pending requests', () => {
      bridge.setWebViewRef(mockRef);
      expect(bridge.getPendingCount()).toBe(0);
      // Catch the eventual rejection from dispose() to avoid unhandled rejection
      bridge.sendMessage({ type: OutboundMessageType.GetCookies }).catch(() => {});
      expect(bridge.getPendingCount()).toBe(1);
    });
  });

  describe('sendOneWay', () => {
    it('throws when no ref set', () => {
      expect(() => bridge.sendOneWay({ type: OutboundMessageType.GetCookies })).toThrow('WebView ref not set');
    });

    it('does not track pending requests', () => {
      bridge.setWebViewRef(mockRef);
      bridge.sendOneWay({ type: OutboundMessageType.GetCookies });
      expect(bridge.getPendingCount()).toBe(0);
    });
  });

  describe('handleInboundMessage', () => {
    it('dispatches valid JSON to handlers', () => {
      const handler = jest.fn();
      bridge.onMessage(handler);
      bridge.handleInboundMessage(JSON.stringify({
        type: InboundMessageType.ConsoleLog, messageId: 'msg-1', level: 'log', args: ['hello'],
      }));
      expect(handler).toHaveBeenCalled();
    });

    it('ignores invalid JSON', () => {
      const handler = jest.fn();
      bridge.onMessage(handler);
      bridge.handleInboundMessage('not-json');
      expect(handler).not.toHaveBeenCalled();
    });

    it('ignores messages without type', () => {
      const handler = jest.fn();
      bridge.onMessage(handler);
      bridge.handleInboundMessage(JSON.stringify({ messageId: 'msg-1' }));
      expect(handler).not.toHaveBeenCalled();
    });

    it('resolves pending request on matching response', async () => {
      bridge.setWebViewRef(mockRef);
      const promise = bridge.sendMessage<{ type: string; cookies: unknown[] }>({
        type: OutboundMessageType.GetCookies, messageId: 'req-1',
      });
      bridge.handleInboundMessage(JSON.stringify({
        type: InboundMessageType.CookiesResult, messageId: 'resp-1', requestId: 'req-1',
        cookies: [{ name: 'session', value: 'abc' }],
      }));
      const result = await promise;
      expect(result.cookies).toEqual([{ name: 'session', value: 'abc' }]);
    });

    it('rejects on ScriptError', async () => {
      bridge.setWebViewRef(mockRef);
      const promise = bridge.sendMessage({
        type: OutboundMessageType.InjectScript, messageId: 'req-2', script: 'fail',
      });
      bridge.handleInboundMessage(JSON.stringify({
        type: InboundMessageType.ScriptError, messageId: 'resp-2', requestId: 'req-2', error: 'fail',
      }));
      await expect(promise).rejects.toThrow('Script error: fail');
    });

    it('rejects on ElementTimeout', async () => {
      bridge.setWebViewRef(mockRef);
      const promise = bridge.sendMessage({
        type: OutboundMessageType.WaitForElement, messageId: 'req-3',
        selector: '#missing', timeoutMs: 1000, pollIntervalMs: 100,
      });
      bridge.handleInboundMessage(JSON.stringify({
        type: InboundMessageType.ElementTimeout, messageId: 'resp-3', requestId: 'req-3',
        selector: '#missing', found: false, elapsedMs: 1000,
      }));
      await expect(promise).rejects.toThrow('Element not found: #missing after 1000ms');
    });
  });

  describe('timeout', () => {
    it('rejects after timeout', async () => {
      const b = new MessageBridge({ defaultTimeoutMs: 50, debug: false });
      b.setWebViewRef(mockRef);
      await expect(b.sendMessage({ type: OutboundMessageType.GetCookies })).rejects.toThrow(/timeout/i);
      b.dispose();
    });
  });

  describe('handler management', () => {
    it('supports unsubscription', () => {
      const handler = jest.fn();
      const unsub = bridge.onMessage(handler);
      unsub();
      bridge.handleInboundMessage(JSON.stringify({
        type: InboundMessageType.ConsoleLog, messageId: 'msg-1', level: 'log', args: [],
      }));
      expect(handler).not.toHaveBeenCalled();
    });

    it('survives handler errors', () => {
      const bad = jest.fn(() => { throw new Error('crash'); });
      const good = jest.fn();
      bridge.onMessage(bad);
      bridge.onMessage(good);
      bridge.handleInboundMessage(JSON.stringify({
        type: InboundMessageType.ConsoleLog, messageId: 'msg-1', level: 'log', args: [],
      }));
      expect(bad).toHaveBeenCalled();
      expect(good).toHaveBeenCalled();
    });
  });

  describe('cleanup', () => {
    it('cancelPendingRequests rejects all', async () => {
      bridge.setWebViewRef(mockRef);
      const p1 = bridge.sendMessage({ type: OutboundMessageType.GetCookies });
      const p2 = bridge.sendMessage({ type: OutboundMessageType.ExtractDOM });
      bridge.cancelPendingRequests();
      await expect(p1).rejects.toThrow('cancelled');
      await expect(p2).rejects.toThrow('cancelled');
    });

    it('dispose cleans up everything', async () => {
      bridge.setWebViewRef(mockRef);
      const promise = bridge.sendMessage({ type: OutboundMessageType.GetCookies });
      bridge.dispose();
      await expect(promise).rejects.toThrow('disposed');
      expect(bridge.isConnected()).toBe(false);
    });
  });

  describe('BRIDGE_INJECTION_SCRIPT', () => {
    it('contains bridge namespace and handlers', () => {
      expect(BRIDGE_INJECTION_SCRIPT).toContain('__CONDUIT_BRIDGE__');
      expect(BRIDGE_INJECTION_SCRIPT).toContain('handleExtractDOM');
      expect(BRIDGE_INJECTION_SCRIPT).toContain('handleWaitForElement');
      expect(BRIDGE_INJECTION_SCRIPT).toContain('handleGetCookies');
      expect(BRIDGE_INJECTION_SCRIPT).toContain('handleSetCookies');
      expect(BRIDGE_INJECTION_SCRIPT).toContain('handleInjectScript');
      expect(BRIDGE_INJECTION_SCRIPT).toContain('handleEvalExpression');
      expect(BRIDGE_INJECTION_SCRIPT).toContain('ReactNativeWebView');
      expect(BRIDGE_INJECTION_SCRIPT).toContain('CONSOLE_LOG');
      expect(BRIDGE_INJECTION_SCRIPT).toContain('PAGE_ERROR');
    });
  });

  describe('generateMessageId', () => {
    it('generates unique IDs', () => {
      resetMessageCounter();
      const id1 = generateMessageId();
      const id2 = generateMessageId();
      expect(id1).not.toBe(id2);
      expect(id1).toMatch(/^msg_\d+_\d+$/);
    });
  });
});
