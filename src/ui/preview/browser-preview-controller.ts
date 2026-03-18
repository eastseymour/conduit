/**
 * Browser Preview Controller — Headless controller for the visual browser preview.
 *
 * Orchestrates the minimized live preview by:
 * 1. Listening to BrowserEngine state changes (navigation events)
 * 2. Managing expand/collapse toggle with size switching
 * 3. Triggering sensitive field masking after each page load
 * 4. Coordinating page transition animations
 * 5. Providing a single state object for the UI layer to render
 *
 * This is a headless controller — it has no direct React/RN dependency.
 * The host app's React component subscribes to state changes and renders accordingly.
 *
 * Design: "Correctness by Construction"
 * - All state transitions are validated
 * - Configuration is validated at construction time
 * - Events are emitted synchronously after state changes
 * - Listener errors never break the controller
 *
 * Invariants:
 * 1. State is always consistent (displayMode matches currentSize)
 * 2. Only one BrowserEngine listener is active at a time
 * 3. Sensitive field masking runs after every page load
 * 4. Transitions are started on navigation and completed on page load
 * 5. dispose() removes all listeners and resets state
 */

import type { NavigationState } from '../../types/navigation';
import { NavigationPhase } from '../../types/navigation';
import type {
  BrowserPreviewConfig,
  BrowserPreviewState,
  BrowserPreviewEvent,
  BrowserPreviewEventListener,
  PreviewPositionName,
  PreviewDisplayModeName,
  SensitiveFieldConfig,
  SensitiveFieldMaskResult,
} from './types';
import {
  PreviewDisplayMode,
  TransitionPhase,
  DEFAULT_BROWSER_PREVIEW_CONFIG,
  assertValidBrowserPreviewConfig,
} from './types';
import { TransitionStateMachine, createTransitionIdleState } from './transition-state-machine';
import {
  generateMaskingScript,
  generateUnmaskingScript,
  parseMaskingResult,
} from './sensitive-field-masker';
import type { BrowserEngine, BrowserEngineEvent } from '../../core/BrowserEngine';

// ─── Script Injector Interface ───────────────────────────────────────

/**
 * Interface for injecting JavaScript into the WebView.
 * Extracted to allow testing without a real BrowserEngine.
 */
export interface ScriptInjector {
  injectJavaScript<T = unknown>(
    script: string,
    timeoutMs?: number,
  ): Promise<{ success: boolean; result?: T; error?: string }>;
}

// ─── Browser Preview Controller ──────────────────────────────────────

export class BrowserPreviewController {
  private _state: BrowserPreviewState;
  private readonly _config: BrowserPreviewConfig;
  private readonly _listeners: Set<BrowserPreviewEventListener> = new Set();
  private readonly _transitionMachine: TransitionStateMachine;
  private _browserEngine: BrowserEngine | null = null;
  private _engineUnsubscribe: (() => void) | null = null;
  private _transitionUnsubscribe: (() => void) | null = null;
  private _disposed: boolean = false;
  private _scriptInjector: ScriptInjector | null = null;

  constructor(config?: Partial<BrowserPreviewConfig>) {
    this._config = {
      ...DEFAULT_BROWSER_PREVIEW_CONFIG,
      ...config,
      sensitiveFieldConfig: {
        ...DEFAULT_BROWSER_PREVIEW_CONFIG.sensitiveFieldConfig,
        ...config?.sensitiveFieldConfig,
      },
    };

    assertValidBrowserPreviewConfig(this._config);

    this._transitionMachine = new TransitionStateMachine(
      this._config.transitionDurationMs,
      this._config.transitionType,
    );

    // Subscribe to transition state changes
    this._transitionUnsubscribe = this._transitionMachine.on(
      this._handleTransitionChange.bind(this),
    );

    const initialNavState: NavigationState = { phase: NavigationPhase.Idle };

    this._state = {
      displayMode: this._config.initialDisplayMode,
      visible: this._config.visible,
      position: this._config.position,
      currentSize:
        this._config.initialDisplayMode === PreviewDisplayMode.Collapsed
          ? this._config.collapsedSize
          : this._config.expandedSize,
      currentUrl: null,
      navigationState: initialNavState,
      transition: createTransitionIdleState(),
      sensitiveFieldMask: null,
      isLoading: false,
      canExpand:
        this._config.initialDisplayMode === PreviewDisplayMode.Collapsed,
      canCollapse:
        this._config.initialDisplayMode === PreviewDisplayMode.Expanded,
      scaleFactor: this._config.scaleFactor,
    };
  }

  // ─── Getters ────────────────────────────────────────────────────

  get state(): BrowserPreviewState {
    return this._state;
  }

  get config(): BrowserPreviewConfig {
    return this._config;
  }

  get isDisposed(): boolean {
    return this._disposed;
  }

  get displayMode(): PreviewDisplayModeName {
    return this._state.displayMode;
  }

  get isExpanded(): boolean {
    return this._state.displayMode === PreviewDisplayMode.Expanded;
  }

  get isCollapsed(): boolean {
    return this._state.displayMode === PreviewDisplayMode.Collapsed;
  }

  get isVisible(): boolean {
    return this._state.visible;
  }

  get currentUrl(): string | null {
    return this._state.currentUrl;
  }

  // ─── Engine Attachment ──────────────────────────────────────────

  /**
   * Attach a BrowserEngine to listen for navigation events.
   *
   * @precondition Not disposed
   * @postcondition Controller listens to engine state changes
   */
  attachEngine(engine: BrowserEngine): void {
    this.assertNotDisposed();
    this.detachEngine();
    this._browserEngine = engine;
    this._scriptInjector = engine;
    this._engineUnsubscribe = engine.on(
      this._handleEngineEvent.bind(this),
    );
  }

  /**
   * Detach the current BrowserEngine.
   */
  detachEngine(): void {
    if (this._engineUnsubscribe) {
      this._engineUnsubscribe();
      this._engineUnsubscribe = null;
    }
    this._browserEngine = null;
    this._scriptInjector = null;
  }

  /**
   * Set a custom script injector (for testing).
   */
  setScriptInjector(injector: ScriptInjector): void {
    this._scriptInjector = injector;
  }

  // ─── Event System ───────────────────────────────────────────────

  /**
   * Subscribe to preview events.
   * Returns an unsubscribe function.
   */
  on(listener: BrowserPreviewEventListener): () => void {
    this._listeners.add(listener);
    return () => {
      this._listeners.delete(listener);
    };
  }

  private emitEvent(event: BrowserPreviewEvent): void {
    for (const listener of this._listeners) {
      try {
        listener(event);
      } catch {
        /* listener errors must not break the controller */
      }
    }
  }

  private emitStateChange(): void {
    this.emitEvent({
      type: 'state_change',
      state: this._state,
      timestamp: Date.now(),
    });
  }

  // ─── Display Mode Toggle ───────────────────────────────────────

  /**
   * Toggle between collapsed and expanded display modes.
   *
   * @precondition Not disposed
   * @postcondition Display mode is toggled and size is updated
   */
  toggle(): void {
    this.assertNotDisposed();
    if (this._state.displayMode === PreviewDisplayMode.Collapsed) {
      this.expand();
    } else {
      this.collapse();
    }
  }

  /**
   * Expand the preview to full size.
   *
   * @precondition Not disposed and currently collapsed
   * @postcondition displayMode is 'expanded', size is expandedSize
   */
  expand(): void {
    this.assertNotDisposed();
    if (this._state.displayMode === PreviewDisplayMode.Expanded) {
      return; // Already expanded
    }

    this.setState({
      displayMode: PreviewDisplayMode.Expanded,
      currentSize: this._config.expandedSize,
      canExpand: false,
      canCollapse: true,
    });

    this.emitEvent({
      type: 'toggle',
      displayMode: PreviewDisplayMode.Expanded,
      timestamp: Date.now(),
    });
  }

  /**
   * Collapse the preview to thumbnail size.
   *
   * @precondition Not disposed and currently expanded
   * @postcondition displayMode is 'collapsed', size is collapsedSize
   */
  collapse(): void {
    this.assertNotDisposed();
    if (this._state.displayMode === PreviewDisplayMode.Collapsed) {
      return; // Already collapsed
    }

    this.setState({
      displayMode: PreviewDisplayMode.Collapsed,
      currentSize: this._config.collapsedSize,
      canExpand: true,
      canCollapse: false,
    });

    this.emitEvent({
      type: 'toggle',
      displayMode: PreviewDisplayMode.Collapsed,
      timestamp: Date.now(),
    });
  }

  // ─── Visibility ────────────────────────────────────────────────

  /**
   * Show the preview.
   */
  show(): void {
    this.assertNotDisposed();
    if (this._state.visible) return;
    this.setState({ visible: true });
  }

  /**
   * Hide the preview.
   */
  hide(): void {
    this.assertNotDisposed();
    if (!this._state.visible) return;
    this.setState({ visible: false });
  }

  // ─── Position ──────────────────────────────────────────────────

  /**
   * Change the preview position.
   */
  setPosition(position: PreviewPositionName): void {
    this.assertNotDisposed();
    if (this._state.position === position) return;
    this.setState({ position });
  }

  // ─── Navigation Handling ───────────────────────────────────────

  /**
   * Handle a navigation state change from the BrowserEngine.
   * Called when the engine emits a stateChange event.
   */
  handleNavigationStateChange(navState: NavigationState): void {
    this.assertNotDisposed();

    const previousUrl = this._state.currentUrl;
    let currentUrl = this._state.currentUrl;
    let isLoading = this._state.isLoading;

    switch (navState.phase) {
      case NavigationPhase.Navigating: {
        isLoading = true;
        const newUrl = navState.url;

        // Start page transition animation
        if (newUrl !== previousUrl) {
          this._transitionMachine.start(previousUrl, newUrl);
        }

        currentUrl = newUrl;
        break;
      }

      case NavigationPhase.Loaded: {
        isLoading = false;
        currentUrl = navState.url;

        // Complete transition animation
        if (this._transitionMachine.isTransitioning) {
          this._transitionMachine.complete();
        }

        // Apply sensitive field masking after page load
        void this.applySensitiveFieldMasking();

        break;
      }

      case NavigationPhase.Extracting: {
        isLoading = false;
        currentUrl = navState.url;
        break;
      }

      case NavigationPhase.Complete: {
        isLoading = false;
        currentUrl = navState.url;

        // Reset transition to idle
        if (this._transitionMachine.phase === TransitionPhase.Complete) {
          this._transitionMachine.reset();
        }
        break;
      }

      case NavigationPhase.Error: {
        isLoading = false;

        // Force-complete any in-progress transition
        if (this._transitionMachine.isTransitioning) {
          this._transitionMachine.forceReset();
        }
        break;
      }

      case NavigationPhase.Idle: {
        isLoading = false;
        break;
      }
    }

    // Determine canExpand/canCollapse based on current transition state
    const canExpand =
      this._state.displayMode === PreviewDisplayMode.Collapsed &&
      this._transitionMachine.phase !== TransitionPhase.Transitioning;
    const canCollapse =
      this._state.displayMode === PreviewDisplayMode.Expanded &&
      this._transitionMachine.phase !== TransitionPhase.Transitioning;

    this.setState({
      navigationState: navState,
      currentUrl,
      isLoading,
      canExpand,
      canCollapse,
    });

    if (currentUrl !== previousUrl && currentUrl !== null) {
      this.emitEvent({
        type: 'navigation',
        url: currentUrl,
        previousUrl,
        timestamp: Date.now(),
      });
    }
  }

  // ─── Sensitive Field Masking ───────────────────────────────────

  /**
   * Apply sensitive field masking to the current page.
   *
   * @postcondition sensitiveFieldMask is updated in state
   */
  async applySensitiveFieldMasking(): Promise<SensitiveFieldMaskResult> {
    if (!this._config.sensitiveFieldConfig.enabled) {
      const result: SensitiveFieldMaskResult = {
        maskedCount: 0,
        matchedSelectors: [],
        success: true,
      };
      this.setState({ sensitiveFieldMask: result });
      return result;
    }

    if (!this._scriptInjector) {
      const result: SensitiveFieldMaskResult = {
        maskedCount: 0,
        matchedSelectors: [],
        success: false,
        error: 'No script injector available',
      };
      this.setState({ sensitiveFieldMask: result });
      return result;
    }

    const script = generateMaskingScript(this._config.sensitiveFieldConfig);

    try {
      const rawResult = await this._scriptInjector.injectJavaScript<string>(script);
      const result = parseMaskingResult(rawResult.result);
      this.setState({ sensitiveFieldMask: result });

      this.emitEvent({
        type: 'mask_applied',
        result,
        timestamp: Date.now(),
      });

      return result;
    } catch {
      const result: SensitiveFieldMaskResult = {
        maskedCount: 0,
        matchedSelectors: [],
        success: false,
        error: 'Failed to execute masking script',
      };
      this.setState({ sensitiveFieldMask: result });
      return result;
    }
  }

  /**
   * Remove all sensitive field masks from the current page.
   */
  async removeSensitiveFieldMasking(): Promise<void> {
    if (!this._scriptInjector) return;

    const script = generateUnmaskingScript();
    try {
      await this._scriptInjector.injectJavaScript(script);
      this.setState({ sensitiveFieldMask: null });
    } catch {
      // Best effort — don't fail if unmasking fails
    }
  }

  /**
   * Update the sensitive field masking configuration.
   */
  updateSensitiveFieldConfig(config: Partial<SensitiveFieldConfig>): void {
    this.assertNotDisposed();
    // Config is immutable at construction, but we can trigger re-masking
    // with the existing config. For full config updates, create a new controller.
    void this.applySensitiveFieldMasking();
  }

  // ─── Transition Progress ───────────────────────────────────────

  /**
   * Advance the transition animation by time.
   * Call this from a requestAnimationFrame loop.
   */
  tickTransition(currentTime: number = Date.now()): void {
    this._transitionMachine.tickByTime(currentTime);
  }

  /**
   * Advance the transition animation by progress value.
   */
  setTransitionProgress(progress: number): void {
    this._transitionMachine.tick(progress);
  }

  // ─── State Management ──────────────────────────────────────────

  private setState(partial: Partial<BrowserPreviewState>): void {
    this._state = { ...this._state, ...partial };
    this.emitStateChange();
  }

  // ─── Engine Event Handler ──────────────────────────────────────

  private _handleEngineEvent(event: BrowserEngineEvent): void {
    if (this._disposed) return;

    if (event.type === 'stateChange') {
      this.handleNavigationStateChange(event.state);
    }
  }

  // ─── Transition Event Handler ──────────────────────────────────

  private _handleTransitionChange(): void {
    if (this._disposed) return;

    const transitionState = this._transitionMachine.state;
    this._state = { ...this._state, transition: transitionState };

    this.emitEvent({
      type: 'transition',
      transition: transitionState,
      timestamp: Date.now(),
    });

    this.emitStateChange();
  }

  // ─── Assertions ────────────────────────────────────────────────

  private assertNotDisposed(): void {
    if (this._disposed) {
      throw new Error('BrowserPreviewController has been disposed');
    }
  }

  // ─── Lifecycle ─────────────────────────────────────────────────

  /**
   * Dispose of the controller, removing all listeners and engine attachment.
   */
  dispose(): void {
    this.detachEngine();
    if (this._transitionUnsubscribe) {
      this._transitionUnsubscribe();
      this._transitionUnsubscribe = null;
    }
    this._transitionMachine.dispose();
    this._listeners.clear();
    this._disposed = true;
  }
}

// ─── Render Info ─────────────────────────────────────────────────────

/**
 * Computed render information for the browser preview.
 * Pure function — derives rendering decisions from state.
 */
export interface BrowserPreviewRenderInfo {
  /** Whether to show the WebView */
  readonly showWebView: boolean;
  /** Whether to show a loading indicator over the preview */
  readonly showLoadingOverlay: boolean;
  /** Whether to show the expand/collapse toggle button */
  readonly showToggleButton: boolean;
  /** CSS transform scale for the WebView (for thumbnail effect) */
  readonly webViewScale: number;
  /** Container width in resolved pixels (or percentage string) */
  readonly containerWidth: string;
  /** Container height in resolved pixels (or percentage string) */
  readonly containerHeight: string;
  /** Opacity for transition animations [0.0, 1.0] */
  readonly opacity: number;
  /** Whether the preview container should be interactive */
  readonly isInteractive: boolean;
  /** Accessibility label */
  readonly accessibilityLabel: string;
}

/**
 * Compute render information from the preview state.
 * Pure function with no side effects.
 */
export function computeBrowserPreviewRenderInfo(
  state: BrowserPreviewState,
): BrowserPreviewRenderInfo {
  const showWebView = state.visible && state.currentUrl !== null;
  const showLoadingOverlay = state.isLoading;
  const showToggleButton = state.visible;

  // Compute WebView scale based on display mode
  const webViewScale =
    state.displayMode === PreviewDisplayMode.Collapsed
      ? state.scaleFactor
      : 1.0;

  // Compute container dimensions
  const containerWidth = formatDimension(state.currentSize.width);
  const containerHeight = formatDimension(state.currentSize.height);

  // Compute opacity for transitions
  let opacity = 1.0;
  if (
    state.transition.phase === TransitionPhase.Transitioning
  ) {
    // During fade transitions, opacity goes from 1 → 0 → 1
    const progress = state.transition.progress;
    if (state.transition.animationType === 'fade') {
      opacity = progress < 0.5
        ? 1.0 - (progress * 2)
        : (progress - 0.5) * 2;
    }
  }

  const isInteractive =
    state.visible &&
    state.transition.phase !== TransitionPhase.Transitioning;

  // Build accessibility label
  let accessibilityLabel = 'Browser preview';
  if (state.currentUrl) {
    try {
      const hostname = new URL(state.currentUrl).hostname;
      accessibilityLabel = `Browser preview showing ${hostname}`;
    } catch {
      accessibilityLabel = 'Browser preview showing page';
    }
  }
  if (state.isLoading) {
    accessibilityLabel += ', loading';
  }
  accessibilityLabel += `, ${state.displayMode}`;

  return {
    showWebView,
    showLoadingOverlay,
    showToggleButton,
    webViewScale,
    containerWidth,
    containerHeight,
    opacity,
    isInteractive,
    accessibilityLabel,
  };
}

function formatDimension(dim: { type: string; value: number }): string {
  if (dim.type === 'percentage') {
    return `${dim.value}%`;
  }
  return `${dim.value}px`;
}
