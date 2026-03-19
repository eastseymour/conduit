/**
 * ConduitLink — High-level orchestrator for the bank link flow.
 *
 * Wires together BrowserEngine + ConduitBrowserDriver + AuthModule into
 * a single developer-facing API. Host apps create one ConduitLink instance,
 * connect it to a WebView, then call startLink() to run the full flow.
 *
 * Usage:
 *   const link = new ConduitLink({ registry });
 *   link.setWebViewRef(webViewRef);
 *   link.on(event => { ... });
 *   const result = await link.startLink('chase', { username, password });
 */

import { BrowserEngine } from '../core/BrowserEngine';
import type { BrowserEngineConfig } from '../core/BrowserEngine';
import { ConduitBrowserDriver } from '../core/ConduitBrowserDriver';
import type { ConduitBrowserDriverConfig } from '../core/ConduitBrowserDriver';
import { AuthModule } from '../auth/auth-module';
import type {
  AuthResult,
  Credentials,
  MfaChallenge,
  MfaChallengeType,
  MfaResponse,
  AuthEvent,
  AuthModuleOptions,
} from '../auth/types';
import type { WebViewRef } from '../types/bridge';
import type { BankAdapterRegistry } from '../adapters/registry';
import { PreviewStatus } from './types';
import type { PreviewState } from './types';

// ─── Event Types ──────────────────────────────────────────────────

export type ConduitLinkEvent =
  | { readonly type: 'state_change'; readonly previewState: PreviewState }
  | { readonly type: 'auth_event'; readonly event: AuthEvent }
  | { readonly type: 'mfa_required'; readonly challenge: MfaChallenge }
  | { readonly type: 'link_complete'; readonly result: AuthResult }
  | { readonly type: 'navigate'; readonly url: string }
  | { readonly type: 'error'; readonly error: Error };

export type ConduitLinkEventListener = (event: ConduitLinkEvent) => void;

// ─── Configuration ────────────────────────────────────────────────

export interface ConduitLinkConfig {
  /** Bank adapter registry (pre-populated with bank configs). */
  readonly registry: BankAdapterRegistry;
  /** Options for the auth module (timeouts, MFA retries, etc.). */
  readonly authOptions?: Partial<AuthModuleOptions>;
  /** Options for the browser engine. */
  readonly engineOptions?: BrowserEngineConfig;
  /** Options for the browser driver. */
  readonly driverOptions?: ConduitBrowserDriverConfig;
  /** Enable debug logging. Default: false. */
  readonly debug?: boolean;
}

// ─── ConduitLink ──────────────────────────────────────────────────

export class ConduitLink {
  private readonly _engine: BrowserEngine;
  private readonly _registry: BankAdapterRegistry;
  private readonly _authModule: AuthModule;
  private readonly _listeners: Set<ConduitLinkEventListener> = new Set();
  private readonly _driverConfig: ConduitBrowserDriverConfig;

  private _previewState: PreviewState;
  private _mfaResolver: ((response: MfaResponse | null) => void) | null = null;
  private _disposed: boolean = false;
  private _currentBankId: string | null = null;

  constructor(config: ConduitLinkConfig) {
    this._registry = config.registry;

    this._engine = new BrowserEngine({
      persistCookies: true,
      debug: config.debug ?? false,
      ...config.engineOptions,
    });

    this._authModule = new AuthModule(config.authOptions);
    this._driverConfig = config.driverOptions ?? {};

    this._previewState = {
      status: PreviewStatus.Idle,
      caption: '',
      progress: null,
    };
  }

  // ─── Public Getters ─────────────────────────────────────────────

  /** Current preview state (status, caption, progress). */
  get previewState(): PreviewState {
    return this._previewState;
  }

  /** Whether an auth flow is currently active. */
  get isActive(): boolean {
    return this._authModule.isActive;
  }

  /** The underlying BrowserEngine (for advanced use). */
  get engine(): BrowserEngine {
    return this._engine;
  }

  /** The bank ID of the current/last link flow, if any. */
  get currentBankId(): string | null {
    return this._currentBankId;
  }

  /** Whether this instance has been disposed. */
  get isDisposed(): boolean {
    return this._disposed;
  }

  // ─── WebView Integration ────────────────────────────────────────

  /**
   * Set the WebView ref. Call this when the WebView mounts.
   * Pass null when the WebView unmounts.
   */
  setWebViewRef(ref: WebViewRef | null): void {
    this._engine.setWebViewRef(ref);
  }

  /**
   * Forward WebView's onMessage event to the engine.
   * Wire this to: <WebView onMessage={link.handleWebViewMessage} />
   */
  handleWebViewMessage(event: { nativeEvent: { data: string } }): void {
    try {
      const parsed = JSON.parse(event.nativeEvent.data);
      this._engine.bridge.handleInboundMessage(parsed);
    } catch {
      // Malformed messages from the WebView are silently ignored
    }
  }

  /**
   * Notify the engine that a page finished loading.
   * Wire this to: <WebView onLoadEnd={e => link.handlePageLoaded(e.nativeEvent.url)} />
   */
  handlePageLoaded(url: string): void {
    this._engine.handlePageLoaded(url);
  }

  /**
   * Notify the engine that navigation started.
   * Wire this to: <WebView onLoadStart={e => link.handleLoadStart(e.nativeEvent.url)} />
   */
  handleLoadStart(url: string): void {
    this._engine.handleLoadStart(url);
  }

  /**
   * Notify the engine of a load error.
   */
  handleLoadError(errorCode: number, description: string, url: string): void {
    this._engine.handleLoadError(errorCode, description, url);
  }

  // ─── Main Flow ──────────────────────────────────────────────────

  /**
   * Get the login URL for a bank. Call this to set the WebView's initial source.
   */
  getLoginUrl(bankId: string): string | null {
    const adapter = this._registry.get(bankId);
    return adapter?.loginUrl ?? null;
  }

  /**
   * Start the full link flow for a bank.
   *
   * The WebView MUST already be loaded on the bank's login page
   * (use getLoginUrl() to get the URL, set it as WebView source,
   * and wait for onLoadEnd before calling this).
   *
   * @returns AuthResult — success, failed, or locked
   */
  async startLink(bankId: string, credentials: Credentials): Promise<AuthResult> {
    this._assertNotDisposed();
    this._currentBankId = bankId;

    this._setPreviewState(PreviewStatus.Loading, 'Initializing secure connection...', 0.05);

    const driver = new ConduitBrowserDriver(this._engine, this._registry, this._driverConfig);

    try {
      this._setPreviewState(PreviewStatus.Loading, 'Connecting to bank...', 0.1);

      // Emit navigate event so the host app can set the WebView URL
      const loginUrl = this.getLoginUrl(bankId);
      if (loginUrl) {
        this._emit({ type: 'navigate', url: loginUrl });
      }

      const result = await this._authModule.authenticate(bankId, credentials, driver, {
        onStateChange: (event: AuthEvent) => {
          this._handleAuthEvent(event);
          this._emit({ type: 'auth_event', event });
        },
        onMfaRequired: (challenge: MfaChallenge): Promise<MfaResponse | null> => {
          this._setPreviewState(
            PreviewStatus.Active,
            this._getMfaCaption(challenge),
            0.5,
          );
          this._emit({ type: 'mfa_required', challenge });

          // Return a promise that resolves when the host app calls submitMfaCode/cancelMfa
          return new Promise<MfaResponse | null>((resolve) => {
            this._mfaResolver = resolve;
          });
        },
      });

      // Update preview based on result
      if (result.status === 'success') {
        this._setPreviewState(PreviewStatus.Complete, 'Connected successfully', 1.0);
      } else if (result.status === 'locked') {
        this._setPreviewState(PreviewStatus.Error, 'Account locked', null);
      } else {
        this._setPreviewState(PreviewStatus.Error, result.reason, null);
      }

      this._emit({ type: 'link_complete', result });
      return result;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this._setPreviewState(PreviewStatus.Error, error.message, null);
      this._emit({ type: 'error', error });
      throw err;
    }
  }

  // ─── MFA Response ───────────────────────────────────────────────

  /**
   * Submit an MFA code (SMS or email) in response to a mfa_required event.
   */
  submitMfaCode(code: string, challengeId: string, challengeType: 'sms_code' | 'email_code'): void {
    if (this._mfaResolver) {
      this._setPreviewState(PreviewStatus.Active, 'Submitting verification code...', 0.6);
      this._mfaResolver({ challengeId, type: challengeType, code });
      this._mfaResolver = null;
    }
  }

  /**
   * Submit security question answers in response to a mfa_required event.
   */
  submitMfaAnswers(answers: readonly string[], challengeId: string): void {
    if (this._mfaResolver) {
      this._setPreviewState(PreviewStatus.Active, 'Submitting answer...', 0.6);
      this._mfaResolver({ challengeId, type: 'security_questions', answers });
      this._mfaResolver = null;
    }
  }

  /**
   * Approve a push notification MFA challenge.
   */
  approvePushNotification(challengeId: string): void {
    if (this._mfaResolver) {
      this._setPreviewState(PreviewStatus.Active, 'Waiting for approval...', 0.6);
      this._mfaResolver({ challengeId, type: 'push_notification', approved: true });
      this._mfaResolver = null;
    }
  }

  /**
   * Cancel the current MFA prompt. This will fail the auth flow.
   */
  cancelMfa(): void {
    if (this._mfaResolver) {
      this._mfaResolver(null);
      this._mfaResolver = null;
    }
  }

  // ─── Event System ───────────────────────────────────────────────

  /**
   * Subscribe to link events (state changes, MFA prompts, completion, errors).
   * @returns Unsubscribe function.
   */
  on(listener: ConduitLinkEventListener): () => void {
    this._listeners.add(listener);
    return () => {
      this._listeners.delete(listener);
    };
  }

  // ─── Lifecycle ──────────────────────────────────────────────────

  /**
   * Cancel the active link flow, if any.
   */
  async cancel(): Promise<void> {
    this.cancelMfa();
    if (this._authModule.isActive) {
      await this._authModule.cancel();
    }
  }

  /**
   * Dispose this instance and release all resources.
   * After calling dispose(), this instance cannot be reused.
   */
  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    this.cancelMfa();
    this._engine.dispose();
    this._listeners.clear();
  }

  // ─── Private ────────────────────────────────────────────────────

  private _handleAuthEvent(event: AuthEvent): void {
    switch (event.type) {
      case 'logging_in':
        this._setPreviewState(PreviewStatus.Active, 'Logging in...', 0.25);
        break;
      case 'mfa_required':
        // Preview state is set in onMfaRequired callback (with challenge details)
        break;
      case 'mfa_submitting':
        this._setPreviewState(PreviewStatus.Active, 'Submitting verification...', 0.6);
        break;
      case 'authenticated':
        this._setPreviewState(PreviewStatus.Active, 'Authenticated', 0.9);
        break;
      case 'auth_failed':
        this._setPreviewState(PreviewStatus.Error, event.reason, null);
        break;
    }
  }

  private _getMfaCaption(challenge: MfaChallenge): string {
    switch (challenge.type) {
      case 'sms_code':
        return `Verification code sent to ${challenge.maskedPhoneNumber}`;
      case 'email_code':
        return `Verification code sent to ${challenge.maskedEmail}`;
      case 'security_questions':
        return 'Please answer the security question';
      case 'push_notification':
        return `Approve on ${challenge.deviceHint}`;
    }
  }

  private _setPreviewState(
    status: PreviewState['status'],
    caption: string,
    progress: number | null,
  ): void {
    this._previewState = { status, caption, progress };
    this._emit({ type: 'state_change', previewState: this._previewState });
  }

  private _emit(event: ConduitLinkEvent): void {
    for (const listener of this._listeners) {
      try {
        listener(event);
      } catch {
        /* must not break link flow */
      }
    }
  }

  private _assertNotDisposed(): void {
    if (this._disposed) {
      throw new Error('ConduitLink has been disposed');
    }
  }
}
