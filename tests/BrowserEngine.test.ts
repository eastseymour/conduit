/**
 * Tests for the BrowserEngine.
 */

import { BrowserEngine } from '../src/core/BrowserEngine';
import type { WebViewRef } from '../src/types/bridge';
import { NavigationPhase, InboundMessageType } from '../src/types';

function createMockWebViewRef(): WebViewRef & { injectedScripts: string[] } {
  const injectedScripts: string[] = [];
  return {
    injectedScripts,
    injectJavaScript: jest.fn((script: string) => {
      injectedScripts.push(script);
    }),
    reload: jest.fn(),
    goBack: jest.fn(),
    goForward: jest.fn(),
    stopLoading: jest.fn(),
  };
}

describe('BrowserEngine', () => {
  let engine: BrowserEngine;
  let mockRef: ReturnType<typeof createMockWebViewRef>;

  beforeEach(() => {
    engine = new BrowserEngine({ defaultTimeoutMs: 5000, debug: false });
    mockRef = createMockWebViewRef();
    engine.setWebViewRef(mockRef);
  });

  afterEach(() => {
    engine.dispose();
  });

  describe('initial state', () => {
    it('starts idle', () => {
      const e = new BrowserEngine();
      expect(e.phase).toBe(NavigationPhase.Idle);
      expect(e.isBusy).toBe(false);
      expect(e.isDisposed).toBe(false);
      e.dispose();
    });
  });

  describe('URL validation', () => {
    it('rejects invalid URLs', async () => {
      const result = await engine.navigate('not-a-url');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid URL');
      expect(engine.phase).toBe(NavigationPhase.Error);
    });

    it('accepts http URLs', () => {
      engine.navigate('http://example.com');
      expect(engine.phase).toBe(NavigationPhase.Navigating);
    });

    it('accepts https URLs', () => {
      engine.navigate('https://example.com');
      expect(engine.phase).toBe(NavigationPhase.Navigating);
    });
  });

  describe('navigation', () => {
    it('transitions to navigating', () => {
      engine.navigate('https://example.com');
      expect(engine.phase).toBe(NavigationPhase.Navigating);
      expect(engine.isBusy).toBe(true);
    });

    it('transitions to loaded on handlePageLoaded', () => {
      engine.navigate('https://example.com');
      engine.handlePageLoaded('https://example.com', 200);
      expect(engine.phase).toBe(NavigationPhase.Loaded);
    });

    it('resolves navigation promise', async () => {
      const promise = engine.navigate('https://example.com');
      engine.handlePageLoaded('https://example.com', 200);
      const result = await promise;
      expect(result.success).toBe(true);
      expect(result.url).toBe('https://example.com');
      expect(result.statusCode).toBe(200);
    });

    it('tracks redirect chain', async () => {
      const promise = engine.navigate('https://old.example.com');
      engine.handleLoadStart('https://new.example.com');
      engine.handlePageLoaded('https://new.example.com', 200);
      const result = await promise;
      expect(result.redirectChain).toContain('https://new.example.com');
    });
  });

  describe('navigation timeout', () => {
    it('times out', async () => {
      const e = new BrowserEngine({ defaultTimeoutMs: 50 });
      e.setWebViewRef(mockRef);
      const result = await e.navigate('https://slow.example.com');
      expect(result.success).toBe(false);
      expect(result.error).toContain('timeout');
      expect(e.phase).toBe(NavigationPhase.Error);
      e.dispose();
    });
  });

  describe('load errors', () => {
    it('handles generic load error', async () => {
      const promise = engine.navigate('https://broken.com');
      engine.handleLoadError(-1, 'Connection refused', 'https://broken.com');
      const result = await promise;
      expect(result.success).toBe(false);
      expect(engine.phase).toBe(NavigationPhase.Error);
    });

    it('detects SSL errors by code', async () => {
      const promise = engine.navigate('https://bad-ssl.com');
      engine.handleLoadError(-1202, 'SSL cert error', 'https://bad-ssl.com');
      await promise;
      const state = engine.state;
      if (state.phase === 'error') {
        expect(state.error.code).toBe('SSL_ERROR');
      }
    });

    it('detects SSL errors by description', async () => {
      const promise = engine.navigate('https://bad-cert.com');
      engine.handleLoadError(0, 'The SSL certificate is invalid', 'https://bad-cert.com');
      await promise;
      const state = engine.state;
      if (state.phase === 'error') {
        expect(state.error.code).toBe('SSL_ERROR');
      }
    });

    it('handles HTTP errors as loaded', () => {
      engine.navigate('https://example.com/404');
      engine.handleHttpError(404, 'https://example.com/404', 'Not Found');
      expect(engine.phase).toBe(NavigationPhase.Loaded);
    });
  });

  describe('state change listeners', () => {
    it('notifies on state changes', () => {
      const listener = jest.fn();
      engine.on(listener);
      engine.navigate('https://example.com');
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'stateChange',
          state: expect.objectContaining({ phase: 'navigating' }),
        }),
      );
    });

    it('supports unsubscription', () => {
      const listener = jest.fn();
      const unsub = engine.on(listener);
      unsub();
      engine.navigate('https://example.com');
      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('JavaScript injection', () => {
    it('requires page to be loaded', async () => {
      await expect(engine.injectJavaScript('return 1')).rejects.toThrow('page is not loaded');
    });

    it('works when loaded', async () => {
      engine.navigate('https://example.com');
      engine.handlePageLoaded('https://example.com', 200);

      const promise = engine.injectJavaScript('return document.title');
      const last = mockRef.injectedScripts[mockRef.injectedScripts.length - 1]!;
      const match = last.match(/"messageId":"(msg_[^"]+)"/);
      if (match) {
        engine.bridge.handleInboundMessage(
          JSON.stringify({
            type: InboundMessageType.ScriptResult,
            messageId: 'r1',
            requestId: match[1],
            result: 'Test',
          }),
        );
      }
      const result = await promise;
      expect(result.success).toBe(true);
      expect(result.result).toBe('Test');
    });
  });

  describe('DOM extraction', () => {
    it('requires page to be loaded', async () => {
      await expect(engine.extractDOM()).rejects.toThrow('page is not loaded');
    });

    it('transitions extracting → complete', async () => {
      engine.navigate('https://example.com');
      engine.handlePageLoaded('https://example.com', 200);

      const promise = engine.extractDOM();
      expect(engine.phase).toBe(NavigationPhase.Extracting);

      const last = mockRef.injectedScripts[mockRef.injectedScripts.length - 1]!;
      const match = last.match(/"messageId":"(msg_[^"]+)"/);
      if (match) {
        engine.bridge.handleInboundMessage(
          JSON.stringify({
            type: InboundMessageType.DOMContent,
            messageId: 'r1',
            requestId: match[1],
            html: '<html><body>Hello</body></html>',
          }),
        );
      }
      const result = await promise;
      expect(result.success).toBe(true);
      expect(result.html).toBe('<html><body>Hello</body></html>');
      expect(engine.phase).toBe(NavigationPhase.Complete);
    });
  });

  describe('waitForElement', () => {
    it('requires page loaded', async () => {
      await expect(engine.waitForElement('#test')).rejects.toThrow('page is not loaded');
    });

    it('returns true when found', async () => {
      engine.navigate('https://example.com');
      engine.handlePageLoaded('https://example.com', 200);

      const promise = engine.waitForElement('#login');
      const last = mockRef.injectedScripts[mockRef.injectedScripts.length - 1]!;
      const match = last.match(/"messageId":"(msg_[^"]+)"/);
      if (match) {
        engine.bridge.handleInboundMessage(
          JSON.stringify({
            type: InboundMessageType.ElementFound,
            messageId: 'r1',
            requestId: match[1],
            selector: '#login',
            found: true,
          }),
        );
      }
      expect(await promise).toBe(true);
    });

    it('returns false on timeout', async () => {
      engine.navigate('https://example.com');
      engine.handlePageLoaded('https://example.com', 200);

      const promise = engine.waitForElement('#missing', 100);
      const last = mockRef.injectedScripts[mockRef.injectedScripts.length - 1]!;
      const match = last.match(/"messageId":"(msg_[^"]+)"/);
      if (match) {
        engine.bridge.handleInboundMessage(
          JSON.stringify({
            type: InboundMessageType.ElementTimeout,
            messageId: 'r1',
            requestId: match[1],
            selector: '#missing',
            found: false,
            elapsedMs: 100,
          }),
        );
      }
      expect(await promise).toBe(false);
    });
  });

  describe('waitForNavigation', () => {
    it('resolves immediately if loaded', async () => {
      engine.navigate('https://example.com');
      engine.handlePageLoaded('https://example.com', 200);
      expect(await engine.waitForNavigation()).toBe(true);
    });

    it('waits for load', async () => {
      engine.navigate('https://example.com');
      const promise = engine.waitForNavigation(5000);
      engine.handlePageLoaded('https://example.com', 200);
      expect(await promise).toBe(true);
    });

    it('returns false on timeout', async () => {
      engine.navigate('https://example.com');
      expect(await engine.waitForNavigation(50)).toBe(false);
    });
  });

  describe('cookies', () => {
    it('getCookies requires loaded', async () => {
      await expect(engine.getCookies()).rejects.toThrow('page is not loaded');
    });

    it('setCookies requires loaded', async () => {
      await expect(engine.setCookies([{ name: 'a', value: 'b' }])).rejects.toThrow(
        'page is not loaded',
      );
    });

    it('provides cookie manager', () => {
      expect(engine.cookieManager).toBeDefined();
      expect(typeof engine.cookieManager.getCookies).toBe('function');
    });
  });

  describe('reset', () => {
    it('resets from complete', async () => {
      engine.navigate('https://example.com');
      engine.handlePageLoaded('https://example.com', 200);
      const ep = engine.extractDOM();
      const last = mockRef.injectedScripts[mockRef.injectedScripts.length - 1]!;
      const match = last.match(/"messageId":"(msg_[^"]+)"/);
      if (match) {
        engine.bridge.handleInboundMessage(
          JSON.stringify({
            type: InboundMessageType.DOMContent,
            messageId: 'r1',
            requestId: match[1],
            html: '<html></html>',
          }),
        );
      }
      await ep;
      expect(engine.phase).toBe(NavigationPhase.Complete);
      engine.reset();
      expect(engine.phase).toBe(NavigationPhase.Idle);
    });

    it('resets from error', async () => {
      await engine.navigate('invalid');
      engine.reset();
      expect(engine.phase).toBe(NavigationPhase.Idle);
    });

    it('force resets from navigating', () => {
      engine.navigate('https://example.com');
      engine.reset();
      expect(engine.phase).toBe(NavigationPhase.Idle);
    });
  });

  describe('dispose', () => {
    it('marks as disposed', () => {
      engine.dispose();
      expect(engine.isDisposed).toBe(true);
    });

    it('throws on operations after dispose', () => {
      engine.dispose();
      expect(() => engine.navigateTo('https://example.com')).toThrow('disposed');
    });
  });

  describe('edge cases', () => {
    it('ignores handlePageLoaded when not navigating', () => {
      engine.handlePageLoaded('https://random.com', 200);
      expect(engine.phase).toBe(NavigationPhase.Idle);
    });

    it('can navigate after error', async () => {
      await engine.navigate('invalid');
      const promise = engine.navigate('https://valid.com');
      engine.handlePageLoaded('https://valid.com', 200);
      const result = await promise;
      expect(result.success).toBe(true);
    });
  });
});
