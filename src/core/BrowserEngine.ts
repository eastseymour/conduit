/**
 * BrowserEngine — Core browser automation engine with WebView integration.
 *
 * Wraps react-native-webview to provide programmatic control for:
 * - URL navigation with redirect tracking
 * - JavaScript injection and evaluation
 * - DOM content extraction
 * - Page load detection and element waiting
 * - Cookie/session persistence across navigation steps
 *
 * State Machine:
 *   idle → navigating → loaded → extracting → complete
 *   Any active state → error (on failure)
 *   error/complete → idle/navigating (reset or retry)
 *
 * Invariants:
 * - State transitions follow the NavigationPhase state machine
 * - A navigation must be in 'loaded' phase before extraction can begin
 * - Timeouts are enforced on all async operations
 * - Bridge script is re-injected on every page load
 * - Pending requests are cancelled on new navigation
 */

import {
  type NavigationState,
  type NavigationPhaseName,
  type NavigationError,
  type CookieData,
  type InboundMessage,
  type DOMContentMessage,
  type ScriptResultMessage,
  type CookiesResultMessage,
  type WebViewRef,
  NavigationPhase,
  NavigationErrorCode,
  InboundMessageType,
  OutboundMessageType,
  createIdleState,
  createNavigatingState,
  createLoadedState,
  createExtractingState,
  createCompleteState,
  createErrorState,
  assertValidTransition,
} from '../types';
import { MessageBridge } from './MessageBridge';
import { CookieManager } from './CookieManager';

// ─── Configuration ─────────────────────────────────────────────────

export interface BrowserEngineConfig {
  /** Default timeout for page loads in ms. Default: 30000. */
  readonly defaultTimeoutMs?: number;
  /** Default timeout for JS injection in ms. Default: 10000. */
  readonly jsTimeoutMs?: number;
  /** Default timeout for waiting for elements in ms. Default: 10000. */
  readonly elementWaitTimeoutMs?: number;
  /** Poll interval for element detection in ms. Default: 100. */
  readonly pollIntervalMs?: number;
  /** Whether to persist cookies across navigations. Default: true. */
  readonly persistCookies?: boolean;
  /** User agent string override. */
  readonly userAgent?: string;
  /** Enable debug logging. Default: false. */
  readonly debug?: boolean;
}

const DEFAULT_CONFIG: Required<BrowserEngineConfig> = {
  defaultTimeoutMs: 30000,
  jsTimeoutMs: 10000,
  elementWaitTimeoutMs: 10000,
  pollIntervalMs: 100,
  persistCookies: true,
  userAgent: '',
  debug: false,
};

// ─── Event Types ───────────────────────────────────────────────────

export type BrowserEngineEvent =
  | { type: 'stateChange'; state: NavigationState }
  | { type: 'console'; level: 'log' | 'warn' | 'error'; message: string }
  | { type: 'error'; error: NavigationError };

export type BrowserEngineEventListener = (event: BrowserEngineEvent) => void;

// ─── Result Types ──────────────────────────────────────────────────

export interface NavigationResult {
  readonly success: boolean;
  readonly url: string;
  readonly statusCode: number | null;
  readonly redirectChain: readonly string[];
  readonly durationMs: number;
  readonly error?: string;
}

export interface DOMExtractionResult {
  readonly html: string;
  readonly selector?: string;
  readonly success: boolean;
  readonly error?: string;
}

export interface ScriptResult<T = unknown> {
  readonly success: boolean;
  readonly result?: T;
  readonly error?: string;
}

// ─── URL Validation ────────────────────────────────────────────────

const URL_PATTERN = /^https?:\/\/.+/i;

// ─── BrowserEngine ─────────────────────────────────────────────────

export class BrowserEngine {
  private _state: NavigationState;
  private readonly _config: Required<BrowserEngineConfig>;
  private readonly _listeners: Set<BrowserEngineEventListener>;
  private readonly _bridge: MessageBridge;
  private readonly _cookieManager: CookieManager;
  private _disposed: boolean;
  private _navigationTimer: ReturnType<typeof setTimeout> | null = null;
  private _navigationResolve: ((result: NavigationResult) => void) | null = null;
  private _redirectChain: string[] = [];
  private _navigationStartedAt: number = 0;

  constructor(config: BrowserEngineConfig = {}) {
    this._config = { ...DEFAULT_CONFIG, ...config };
    this._state = createIdleState();
    this._listeners = new Set();
    this._disposed = false;
    this._bridge = new MessageBridge({
      defaultTimeoutMs: this._config.defaultTimeoutMs,
      debug: this._config.debug,
    });
    this._cookieManager = new CookieManager();
    this._bridge.onMessage(this._handleBridgeMessage.bind(this));
  }

  // ─── Public Getters ────────────────────────────────────────────

  get state(): NavigationState { return this._state; }
  get phase(): NavigationState['phase'] { return this._state.phase; }
  get isDisposed(): boolean { return this._disposed; }
  get isBusy(): boolean {
    return this._state.phase === NavigationPhase.Navigating ||
           this._state.phase === NavigationPhase.Extracting;
  }
  get config(): Readonly<Required<BrowserEngineConfig>> { return this._config; }
  get bridge(): MessageBridge { return this._bridge; }
  get cookieManager(): CookieManager { return this._cookieManager; }

  // ─── Event System ──────────────────────────────────────────────

  on(listener: BrowserEngineEventListener): () => void {
    this._listeners.add(listener);
    return () => { this._listeners.delete(listener); };
  }

  private _emit(event: BrowserEngineEvent): void {
    for (const listener of this._listeners) {
      try { listener(event); } catch { /* must not break engine */ }
    }
  }

  // ─── WebView Ref ───────────────────────────────────────────────

  setWebViewRef(ref: WebViewRef | null): void {
    this._bridge.setWebViewRef(ref);
  }

  // ─── State Management ──────────────────────────────────────────

  private _transitionTo(newState: NavigationState): void {
    this._assertNotDisposed();
    assertValidTransition(this._state.phase, newState.phase);
    this._state = newState;
    this._emit({ type: 'stateChange', state: newState });
  }

  private _transitionToError(error: NavigationError, failedUrl: string | null): void {
    this._assertNotDisposed();
    const errorState = createErrorState(error, failedUrl, this._state.phase);
    this._state = errorState;
    this._clearNavigationTimer();
    this._emit({ type: 'stateChange', state: errorState });
    this._emit({ type: 'error', error });
  }

  // ─── Navigation ────────────────────────────────────────────────

  navigateTo(url: string): void {
    this._assertNotDisposed();
    this._assertValidUrl(url);
    this._transitionTo(createNavigatingState(url));
  }

  async navigate(url: string, timeoutMs?: number): Promise<NavigationResult> {
    this._assertNotDisposed();

    if (!URL_PATTERN.test(url)) {
      const error: NavigationError = {
        code: NavigationErrorCode.InvalidURL,
        message: `Invalid URL: ${url}. Must start with http:// or https://`,
        url,
      };
      this._transitionToError(error, url);
      return { success: false, url, statusCode: null, redirectChain: [], durationMs: 0, error: error.message };
    }

    if (this._state.phase === NavigationPhase.Navigating) {
      this._clearNavigationTimer();
      this._bridge.cancelPendingRequests();
    }

    const timeout = timeoutMs ?? this._config.defaultTimeoutMs;
    this._redirectChain = [];
    this._navigationStartedAt = Date.now();

    if (this._state.phase === NavigationPhase.Idle ||
        this._state.phase === NavigationPhase.Complete ||
        this._state.phase === NavigationPhase.Error ||
        this._state.phase === NavigationPhase.Loaded) {
      this._transitionTo(createNavigatingState(url));
    } else if (this._state.phase === NavigationPhase.Navigating) {
      this._state = createNavigatingState(url);
      this._emit({ type: 'stateChange', state: this._state });
    }

    this._bridge.markBridgeStale();

    return new Promise<NavigationResult>((resolve) => {
      this._navigationTimer = setTimeout(() => {
        this._navigationTimer = null;
        const error: NavigationError = {
          code: NavigationErrorCode.Timeout,
          message: `Navigation timeout after ${timeout}ms for ${url}`,
          url,
        };
        this._transitionToError(error, url);
        resolve({
          success: false, url, statusCode: null,
          redirectChain: [...this._redirectChain],
          durationMs: Date.now() - this._navigationStartedAt,
          error: error.message,
        });
      }, timeout);
      this._navigationResolve = resolve;
    });
  }

  // ─── Page Load Handling ────────────────────────────────────────

  handlePageLoaded(url: string, statusCode: number | null = null): void {
    if (this._disposed || this._state.phase !== NavigationPhase.Navigating) return;
    this._clearNavigationTimer();
    this._bridge.injectBridgeScript();
    this._transitionTo(createLoadedState(url, statusCode, [...this._redirectChain]));
    if (this._navigationResolve) {
      const resolve = this._navigationResolve;
      this._navigationResolve = null;
      resolve({
        success: true, url, statusCode,
        redirectChain: [...this._redirectChain],
        durationMs: Date.now() - this._navigationStartedAt,
      });
    }
  }

  handleRedirect(newUrl: string): void {
    if (this._disposed) return;
    this._redirectChain.push(newUrl);
    if (this._state.phase === NavigationPhase.Loaded) {
      this._transitionTo(createNavigatingState(newUrl, [...this._state.redirectChain, this._state.url]));
    }
  }

  handleLoadStart(url: string): void {
    if (this._disposed) return;
    if (this._state.phase === NavigationPhase.Navigating && url !== this._state.url) {
      this._redirectChain.push(url);
    }
  }

  handleLoadError(errorCode: number, description: string, url: string): void {
    if (this._disposed) return;
    this._clearNavigationTimer();
    const isSSL = description.toLowerCase().includes('ssl') ||
                  description.toLowerCase().includes('certificate') ||
                  errorCode === -1202;
    const error: NavigationError = {
      code: isSSL ? NavigationErrorCode.SSLError : NavigationErrorCode.LoadFailed,
      message: description, url,
    };
    this._transitionToError(error, url);
    if (this._navigationResolve) {
      const resolve = this._navigationResolve;
      this._navigationResolve = null;
      resolve({
        success: false, url, statusCode: null,
        redirectChain: [...this._redirectChain],
        durationMs: Date.now() - this._navigationStartedAt,
        error: description,
      });
    }
  }

  handleHttpError(statusCode: number, url: string, _description: string): void {
    if (this._disposed || this._state.phase !== NavigationPhase.Navigating) return;
    this._clearNavigationTimer();
    this._bridge.injectBridgeScript();
    this._transitionTo(createLoadedState(url, statusCode, [...this._redirectChain]));
    if (this._navigationResolve) {
      const resolve = this._navigationResolve;
      this._navigationResolve = null;
      resolve({
        success: true, url, statusCode,
        redirectChain: [...this._redirectChain],
        durationMs: Date.now() - this._navigationStartedAt,
      });
    }
  }

  // ─── JavaScript Injection ──────────────────────────────────────

  async injectJavaScript<T = unknown>(script: string, timeoutMs?: number): Promise<ScriptResult<T>> {
    this._assertPageLoaded('injectJavaScript');
    try {
      const response = await this._bridge.sendMessage<ScriptResultMessage>(
        { type: OutboundMessageType.InjectScript, script },
        timeoutMs ?? this._config.jsTimeoutMs,
      );
      return { success: true, result: response.result as T };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async evalExpression<T = unknown>(expression: string, timeoutMs?: number): Promise<ScriptResult<T>> {
    this._assertPageLoaded('evalExpression');
    try {
      const response = await this._bridge.sendMessage<ScriptResultMessage>(
        { type: OutboundMessageType.EvalExpression, expression },
        timeoutMs ?? this._config.jsTimeoutMs,
      );
      return { success: true, result: response.result as T };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  // ─── DOM Extraction ────────────────────────────────────────────

  async extractDOM(selector?: string, attribute?: string): Promise<DOMExtractionResult> {
    this._assertPageLoaded('extractDOM');
    if (this._state.phase === NavigationPhase.Loaded) {
      this._transitionTo(createExtractingState(this._state.url, this._state.loadedAt));
    }
    try {
      const response = await this._bridge.sendMessage<DOMContentMessage>(
        { type: OutboundMessageType.ExtractDOM, selector, attribute },
        this._config.defaultTimeoutMs,
      );
      if (this._state.phase === NavigationPhase.Extracting) {
        this._transitionTo(createCompleteState(this._state.url, this._navigationStartedAt));
      }
      return { html: response.html, selector: response.selector, success: true };
    } catch (err) {
      const error: NavigationError = {
        code: NavigationErrorCode.ExtractionError,
        message: err instanceof Error ? err.message : String(err),
      };
      if (this._state.phase === NavigationPhase.Extracting) {
        this._transitionToError(error, this._state.url);
      }
      return { html: '', selector, success: false, error: error.message };
    }
  }

  beginExtraction(): void {
    this._assertNotDisposed();
    if (this._state.phase !== NavigationPhase.Loaded) {
      throw new Error(`Cannot begin extraction in phase '${this._state.phase}'. Expected 'loaded'.`);
    }
    this._transitionTo(createExtractingState(this._state.url, this._state.loadedAt));
  }

  completeExtraction(): void {
    this._assertNotDisposed();
    if (this._state.phase !== NavigationPhase.Extracting) {
      throw new Error(`Cannot complete extraction in phase '${this._state.phase}'. Expected 'extracting'.`);
    }
    this._transitionTo(createCompleteState(this._state.url, this._state.extractionStartedAt));
  }

  // ─── Wait Utilities ────────────────────────────────────────────

  async waitForElement(selector: string, timeoutMs?: number, pollIntervalMs?: number): Promise<boolean> {
    this._assertPageLoaded('waitForElement');
    const timeout = timeoutMs ?? this._config.elementWaitTimeoutMs;
    const interval = pollIntervalMs ?? this._config.pollIntervalMs;
    try {
      await this._bridge.sendMessage(
        { type: OutboundMessageType.WaitForElement, selector, timeoutMs: timeout, pollIntervalMs: interval },
        timeout + 1000,
      );
      return true;
    } catch { return false; }
  }

  waitForNavigation(timeoutMs?: number): Promise<boolean> {
    const timeout = timeoutMs ?? this._config.defaultTimeoutMs;
    if (this._state.phase === NavigationPhase.Loaded) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => { unsubscribe(); resolve(false); }, timeout);
      const unsubscribe = this.on((event) => {
        if (event.type === 'stateChange' &&
            (event.state.phase === NavigationPhase.Loaded || event.state.phase === NavigationPhase.Error)) {
          clearTimeout(timer);
          unsubscribe();
          resolve(event.state.phase === NavigationPhase.Loaded);
        }
      });
    });
  }

  async waitForPageReady(timeoutMs?: number): Promise<boolean> {
    this._assertPageLoaded('waitForPageReady');
    const timeout = timeoutMs ?? this._config.defaultTimeoutMs;
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
      const result = await this.evalExpression<string>('document.readyState');
      if (result.success && result.result === 'complete') return true;
      await this._sleep(this._config.pollIntervalMs);
    }
    return false;
  }

  // ─── Cookie Management ─────────────────────────────────────────

  async getCookies(): Promise<readonly CookieData[]> {
    this._assertPageLoaded('getCookies');
    try {
      const response = await this._bridge.sendMessage<CookiesResultMessage>(
        { type: OutboundMessageType.GetCookies }, this._config.jsTimeoutMs,
      );
      return response.cookies;
    } catch { return []; }
  }

  async setCookies(cookies: readonly CookieData[]): Promise<boolean> {
    this._assertPageLoaded('setCookies');
    try {
      await this._bridge.sendMessage(
        { type: OutboundMessageType.SetCookies, cookies }, this._config.jsTimeoutMs,
      );
      return true;
    } catch { return false; }
  }

  async persistCurrentCookies(): Promise<void> {
    const cookies = await this.getCookies();
    await this._cookieManager.setCookies(cookies);
    await this._cookieManager.persistCookies();
  }

  async restorePersistedCookies(): Promise<boolean> {
    await this._cookieManager.loadCookies();
    const cookies = await this._cookieManager.getCookies();
    return cookies.length > 0 ? this.setCookies(cookies) : true;
  }

  // ─── Error / Reset / Lifecycle ─────────────────────────────────

  reportError(code: NavigationError['code'], message: string): void {
    this._assertNotDisposed();
    this._transitionToError({ code, message }, null);
  }

  reset(): void {
    this._assertNotDisposed();
    this._clearNavigationTimer();
    this._bridge.cancelPendingRequests();
    this._redirectChain = [];
    this._navigationResolve = null;
    if (this._state.phase === NavigationPhase.Complete || this._state.phase === NavigationPhase.Error) {
      this._transitionTo(createIdleState());
    } else {
      this._state = createIdleState();
      this._emit({ type: 'stateChange', state: this._state });
    }
  }

  dispose(): void {
    this._clearNavigationTimer();
    this._navigationResolve = null;
    this._listeners.clear();
    this._bridge.dispose();
    this._disposed = true;
  }

  // ─── Assertions ────────────────────────────────────────────────

  private _assertNotDisposed(): void {
    if (this._disposed) throw new Error('BrowserEngine has been disposed');
  }

  private _assertValidUrl(url: string): void {
    try { new URL(url); } catch { throw new Error(`Invalid URL: ${url}`); }
  }

  private _assertPageLoaded(operation: string): void {
    this._assertNotDisposed();
    const loadedPhases: NavigationPhaseName[] = [
      NavigationPhase.Loaded, NavigationPhase.Extracting, NavigationPhase.Complete,
    ];
    if (!loadedPhases.includes(this._state.phase)) {
      throw new Error(
        `Cannot perform ${operation}: page is not loaded (current phase: ${this._state.phase}). Navigate to a URL first.`,
      );
    }
  }

  // ─── Private ───────────────────────────────────────────────────

  private _handleBridgeMessage(message: InboundMessage): void {
    if (message.type === InboundMessageType.NavigationEvent) {
      if (message.event === 'redirect') this._redirectChain.push(message.url);
      else if (message.event === 'error' && message.errorMessage) {
        this.handleLoadError(0, message.errorMessage, message.url);
      }
    }
    if (message.type === InboundMessageType.ConsoleLog) {
      const level = message.level === 'info' ? 'log' : message.level;
      if (level === 'log' || level === 'warn' || level === 'error') {
        this._emit({ type: 'console', level, message: String(message.args[0] ?? '') });
      }
    }
  }

  private _clearNavigationTimer(): void {
    if (this._navigationTimer) { clearTimeout(this._navigationTimer); this._navigationTimer = null; }
  }

  private _sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
