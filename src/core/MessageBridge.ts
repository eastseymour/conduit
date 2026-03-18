/**
 * MessageBridge — Communication layer between React Native and WebView JS context.
 *
 * Responsibilities:
 * - Serialize and inject JavaScript messages into the WebView
 * - Parse and dispatch messages received from the WebView
 * - Correlate request/response pairs via messageId
 * - Handle timeouts for pending requests
 *
 * Invariants:
 * - Every outbound message gets a unique messageId
 * - Every pending request is resolved or rejected within its timeout
 * - The bridge is the ONLY communication path between RN and WebView
 */

import {
  type InboundMessage,
  InboundMessageType,
  type OutboundMessageTypeName,
  type PendingRequest,
  type WebViewRef,
  generateMessageId,
} from '../types';

// ─── Event Handler Types ───────────────────────────────────────────

export type InboundMessageHandler = (message: InboundMessage) => void;

export interface MessageBridgeConfig {
  readonly defaultTimeoutMs: number;
  readonly debug: boolean;
}

const DEFAULT_CONFIG: MessageBridgeConfig = {
  defaultTimeoutMs: 30_000,
  debug: false,
};

// ─── Bridge Injected Script ────────────────────────────────────────

/**
 * JavaScript injected into the WebView to set up the communication bridge.
 * Creates `window.__CONDUIT_BRIDGE__` that handles messages from React Native
 * and sends responses back via `window.ReactNativeWebView.postMessage`.
 */
export const BRIDGE_INJECTION_SCRIPT = `
(function() {
  if (window.__CONDUIT_BRIDGE__) return;

  window.__CONDUIT_BRIDGE__ = {
    initialized: true,

    sendToNative: function(message) {
      try {
        var payload = JSON.stringify(message);
        if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
          window.ReactNativeWebView.postMessage(payload);
        }
      } catch (e) { /* Cannot report */ }
    },

    generateId: function() {
      return 'wv_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    },

    handleMessage: function(message) {
      try {
        switch (message.type) {
          case 'EXTRACT_DOM':      this.handleExtractDOM(message); break;
          case 'WAIT_FOR_ELEMENT': this.handleWaitForElement(message); break;
          case 'GET_COOKIES':      this.handleGetCookies(message); break;
          case 'SET_COOKIES':      this.handleSetCookies(message); break;
          case 'INJECT_SCRIPT':    this.handleInjectScript(message); break;
          case 'EVAL_EXPRESSION':  this.handleEvalExpression(message); break;
        }
      } catch (e) {
        this.sendToNative({
          type: 'SCRIPT_ERROR', messageId: this.generateId(),
          requestId: message.messageId, error: e.message || String(e), stack: e.stack
        });
      }
    },

    handleExtractDOM: function(msg) {
      var html;
      if (msg.selector) {
        var el = document.querySelector(msg.selector);
        html = el ? (msg.attribute ? el.getAttribute(msg.attribute) || '' : el.outerHTML) : '';
      } else { html = document.documentElement.outerHTML; }
      this.sendToNative({ type: 'DOM_CONTENT', messageId: this.generateId(),
        requestId: msg.messageId, html: html, selector: msg.selector });
    },

    handleWaitForElement: function(msg) {
      var self = this, startTime = Date.now();
      var interval = msg.pollIntervalMs || 100, timeout = msg.timeoutMs || 10000;
      function check() {
        var el = document.querySelector(msg.selector);
        if (el) {
          self.sendToNative({ type: 'ELEMENT_FOUND', messageId: self.generateId(),
            requestId: msg.messageId, selector: msg.selector, found: true });
        } else if (Date.now() - startTime >= timeout) {
          self.sendToNative({ type: 'ELEMENT_TIMEOUT', messageId: self.generateId(),
            requestId: msg.messageId, selector: msg.selector, found: false,
            elapsedMs: Date.now() - startTime });
        } else { setTimeout(check, interval); }
      }
      check();
    },

    handleGetCookies: function(msg) {
      var cookies = document.cookie.split(';').map(function(c) {
        var parts = c.trim().split('=');
        return { name: parts[0], value: parts.slice(1).join('=') };
      }).filter(function(c) { return c.name; });
      this.sendToNative({ type: 'COOKIES_RESULT', messageId: this.generateId(),
        requestId: msg.messageId, cookies: cookies });
    },

    handleSetCookies: function(msg) {
      if (msg.cookies && Array.isArray(msg.cookies)) {
        msg.cookies.forEach(function(cookie) {
          var str = cookie.name + '=' + cookie.value;
          if (cookie.path) str += '; path=' + cookie.path;
          if (cookie.domain) str += '; domain=' + cookie.domain;
          if (cookie.expires) str += '; expires=' + new Date(cookie.expires).toUTCString();
          if (cookie.secure) str += '; secure';
          if (cookie.sameSite) str += '; samesite=' + cookie.sameSite;
          document.cookie = str;
        });
      }
      this.sendToNative({ type: 'SCRIPT_RESULT', messageId: this.generateId(),
        requestId: msg.messageId, result: true });
    },

    handleInjectScript: function(msg) {
      try {
        var result = new Function(msg.script)();
        this.sendToNative({ type: 'SCRIPT_RESULT', messageId: this.generateId(),
          requestId: msg.messageId, result: result !== undefined ? result : null });
      } catch (e) {
        this.sendToNative({ type: 'SCRIPT_ERROR', messageId: this.generateId(),
          requestId: msg.messageId, error: e.message || String(e), stack: e.stack });
      }
    },

    handleEvalExpression: function(msg) {
      try {
        var result = eval(msg.expression);
        this.sendToNative({ type: 'SCRIPT_RESULT', messageId: this.generateId(),
          requestId: msg.messageId, result: result !== undefined ? result : null });
      } catch (e) {
        this.sendToNative({ type: 'SCRIPT_ERROR', messageId: this.generateId(),
          requestId: msg.messageId, error: e.message || String(e), stack: e.stack });
      }
    }
  };

  // Intercept console methods
  ['log', 'warn', 'error', 'info'].forEach(function(level) {
    var original = console[level];
    console[level] = function() {
      var args = Array.prototype.slice.call(arguments);
      try {
        window.__CONDUIT_BRIDGE__.sendToNative({
          type: 'CONSOLE_LOG', messageId: window.__CONDUIT_BRIDGE__.generateId(),
          level: level, args: args.map(function(a) {
            try { return JSON.parse(JSON.stringify(a)); } catch(e) { return String(a); }
          })
        });
      } catch(e) {}
      if (original) original.apply(console, arguments);
    };
  });

  // Global error handler
  window.addEventListener('error', function(e) {
    window.__CONDUIT_BRIDGE__.sendToNative({
      type: 'PAGE_ERROR', messageId: window.__CONDUIT_BRIDGE__.generateId(),
      error: e.message || 'Unknown error', stack: e.error ? e.error.stack : undefined,
      url: e.filename
    });
  });

  true;
})();
`;

// ─── MessageBridge Class ───────────────────────────────────────────

export class MessageBridge {
  private webViewRef: WebViewRef | null = null;
  private readonly pendingRequests: Map<string, PendingRequest> = new Map();
  private readonly handlers: Set<InboundMessageHandler> = new Set();
  private readonly config: MessageBridgeConfig;
  private bridgeInjected = false;

  constructor(config: Partial<MessageBridgeConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  setWebViewRef(ref: WebViewRef | null): void {
    this.webViewRef = ref;
    if (ref && !this.bridgeInjected) {
      this.injectBridgeScript();
    }
  }

  getWebViewRef(): WebViewRef | null {
    return this.webViewRef;
  }

  isConnected(): boolean {
    return this.webViewRef !== null;
  }

  injectBridgeScript(): void {
    if (!this.webViewRef) return;
    this.webViewRef.injectJavaScript(BRIDGE_INJECTION_SCRIPT);
    this.bridgeInjected = true;
  }

  markBridgeStale(): void {
    this.bridgeInjected = false;
  }

  sendMessage<T = unknown>(
    message: { type: string; messageId?: string; [key: string]: unknown },
    timeoutMs?: number,
  ): Promise<T> {
    if (!this.webViewRef) {
      return Promise.reject(new Error('WebView ref not set — cannot send message'));
    }

    const messageId = message.messageId ?? generateMessageId();
    const fullMessage = { ...message, messageId };
    const timeout = timeoutMs ?? this.config.defaultTimeoutMs;

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pendingRequests.has(messageId)) {
          this.pendingRequests.delete(messageId);
          reject(
            new Error(
              `Bridge message timeout after ${timeout}ms for ${fullMessage.type} (id: ${messageId})`,
            ),
          );
        }
      }, timeout);

      const pendingRequest: PendingRequest<T> = {
        messageId,
        type: fullMessage.type as OutboundMessageTypeName,
        sentAt: Date.now(),
        timeoutMs: timeout,
        resolve: (value: T) => { clearTimeout(timer); resolve(value); },
        reject: (error: Error) => { clearTimeout(timer); reject(error); },
      };

      this.pendingRequests.set(messageId, pendingRequest as PendingRequest);

      const js = `(function(){if(window.__CONDUIT_BRIDGE__){window.__CONDUIT_BRIDGE__.handleMessage(${JSON.stringify(fullMessage)});}})();true;`;
      this.webViewRef!.injectJavaScript(js);
    });
  }

  sendOneWay(
    message: { type: string; messageId?: string; [key: string]: unknown },
  ): void {
    if (!this.webViewRef) {
      throw new Error('WebView ref not set — cannot send message');
    }
    const messageId = message.messageId ?? generateMessageId();
    const fullMessage = { ...message, messageId };
    const js = `(function(){if(window.__CONDUIT_BRIDGE__){window.__CONDUIT_BRIDGE__.handleMessage(${JSON.stringify(fullMessage)});}})();true;`;
    this.webViewRef.injectJavaScript(js);
  }

  handleInboundMessage(rawData: string): void {
    let message: InboundMessage;
    try {
      message = JSON.parse(rawData) as InboundMessage;
    } catch {
      return;
    }

    if (!message.type) return;

    const requestId = 'requestId' in message
      ? (message as { requestId?: string }).requestId
      : undefined;

    if (requestId) {
      const pending = this.pendingRequests.get(requestId);
      if (pending) {
        this.pendingRequests.delete(requestId);
        if (message.type === InboundMessageType.ScriptError) {
          pending.reject(new Error(`Script error: ${message.error}`));
        } else if (message.type === InboundMessageType.ElementTimeout) {
          pending.reject(
            new Error(`Element not found: ${message.selector} after ${message.elapsedMs}ms`),
          );
        } else {
          pending.resolve(message);
        }
      }
    }

    for (const handler of this.handlers) {
      try { handler(message); } catch { /* handler errors must not break the bridge */ }
    }
  }

  onMessage(handler: InboundMessageHandler): () => void {
    this.handlers.add(handler);
    return () => { this.handlers.delete(handler); };
  }

  dispose(): void {
    for (const [, pending] of this.pendingRequests) {
      pending.reject(new Error('Bridge disposed — all pending requests cancelled'));
    }
    this.pendingRequests.clear();
    this.handlers.clear();
    this.webViewRef = null;
    this.bridgeInjected = false;
  }

  cancelPendingRequests(): void {
    for (const [, pending] of this.pendingRequests) {
      pending.reject(new Error('Pending requests cancelled'));
    }
    this.pendingRequests.clear();
  }

  getPendingCount(): number {
    return this.pendingRequests.size;
  }
}
