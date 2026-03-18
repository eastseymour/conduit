/**
 * WebView ↔ React Native Message Bridge Types
 *
 * Defines the protocol for communication between the WebView JavaScript
 * context and the React Native host. Uses discriminated unions for
 * message types to ensure type-safe message handling.
 *
 * Invariant: Every message has a unique `type` discriminant and a `messageId`
 * for correlation. Response messages carry the `requestId` of their request.
 */

// ─── Message Directions ────────────────────────────────────────────

export const OutboundMessageType = {
  InjectScript: 'INJECT_SCRIPT',
  ExtractDOM: 'EXTRACT_DOM',
  WaitForElement: 'WAIT_FOR_ELEMENT',
  GetCookies: 'GET_COOKIES',
  SetCookies: 'SET_COOKIES',
  EvalExpression: 'EVAL_EXPRESSION',
} as const;

export type OutboundMessageTypeName =
  (typeof OutboundMessageType)[keyof typeof OutboundMessageType];

export const InboundMessageType = {
  NavigationEvent: 'NAVIGATION_EVENT',
  DOMContent: 'DOM_CONTENT',
  ElementFound: 'ELEMENT_FOUND',
  ElementTimeout: 'ELEMENT_TIMEOUT',
  CookiesResult: 'COOKIES_RESULT',
  ScriptResult: 'SCRIPT_RESULT',
  ScriptError: 'SCRIPT_ERROR',
  ConsoleLog: 'CONSOLE_LOG',
  PageError: 'PAGE_ERROR',
} as const;

export type InboundMessageTypeName =
  (typeof InboundMessageType)[keyof typeof InboundMessageType];

// ─── Outbound Message Variants ─────────────────────────────────────

export interface InjectScriptMessage {
  readonly type: typeof OutboundMessageType.InjectScript;
  readonly messageId: string;
  readonly script: string;
}

export interface ExtractDOMMessage {
  readonly type: typeof OutboundMessageType.ExtractDOM;
  readonly messageId: string;
  readonly selector?: string;
  readonly attribute?: string;
}

export interface WaitForElementMessage {
  readonly type: typeof OutboundMessageType.WaitForElement;
  readonly messageId: string;
  readonly selector: string;
  readonly timeoutMs: number;
  readonly pollIntervalMs: number;
}

export interface GetCookiesMessage {
  readonly type: typeof OutboundMessageType.GetCookies;
  readonly messageId: string;
}

export interface SetCookiesMessage {
  readonly type: typeof OutboundMessageType.SetCookies;
  readonly messageId: string;
  readonly cookies: readonly CookieData[];
}

export interface EvalExpressionMessage {
  readonly type: typeof OutboundMessageType.EvalExpression;
  readonly messageId: string;
  readonly expression: string;
}

export type OutboundMessage =
  | InjectScriptMessage
  | ExtractDOMMessage
  | WaitForElementMessage
  | GetCookiesMessage
  | SetCookiesMessage
  | EvalExpressionMessage;

// ─── Inbound Message Variants ──────────────────────────────────────

export interface NavigationEventMessage {
  readonly type: typeof InboundMessageType.NavigationEvent;
  readonly messageId: string;
  readonly requestId?: string;
  readonly event: 'start' | 'redirect' | 'load' | 'error';
  readonly url: string;
  readonly statusCode?: number;
  readonly errorMessage?: string;
}

export interface DOMContentMessage {
  readonly type: typeof InboundMessageType.DOMContent;
  readonly messageId: string;
  readonly requestId: string;
  readonly html: string;
  readonly selector?: string;
}

export interface ElementFoundMessage {
  readonly type: typeof InboundMessageType.ElementFound;
  readonly messageId: string;
  readonly requestId: string;
  readonly selector: string;
  readonly found: true;
}

export interface ElementTimeoutMessage {
  readonly type: typeof InboundMessageType.ElementTimeout;
  readonly messageId: string;
  readonly requestId: string;
  readonly selector: string;
  readonly found: false;
  readonly elapsedMs: number;
}

export interface CookiesResultMessage {
  readonly type: typeof InboundMessageType.CookiesResult;
  readonly messageId: string;
  readonly requestId: string;
  readonly cookies: readonly CookieData[];
}

export interface ScriptResultMessage {
  readonly type: typeof InboundMessageType.ScriptResult;
  readonly messageId: string;
  readonly requestId: string;
  readonly result: unknown;
}

export interface ScriptErrorMessage {
  readonly type: typeof InboundMessageType.ScriptError;
  readonly messageId: string;
  readonly requestId: string;
  readonly error: string;
  readonly stack?: string;
}

export interface ConsoleLogMessage {
  readonly type: typeof InboundMessageType.ConsoleLog;
  readonly messageId: string;
  readonly level: 'log' | 'warn' | 'error' | 'info';
  readonly args: readonly unknown[];
}

export interface PageErrorMessage {
  readonly type: typeof InboundMessageType.PageError;
  readonly messageId: string;
  readonly error: string;
  readonly stack?: string;
  readonly url?: string;
}

export type InboundMessage =
  | NavigationEventMessage
  | DOMContentMessage
  | ElementFoundMessage
  | ElementTimeoutMessage
  | CookiesResultMessage
  | ScriptResultMessage
  | ScriptErrorMessage
  | ConsoleLogMessage
  | PageErrorMessage;

// ─── Cookie Data ───────────────────────────────────────────────────

export interface CookieData {
  readonly name: string;
  readonly value: string;
  readonly domain?: string;
  readonly path?: string;
  readonly expires?: number;
  readonly httpOnly?: boolean;
  readonly secure?: boolean;
  readonly sameSite?: 'strict' | 'lax' | 'none';
}

// ─── WebView Ref Abstraction ───────────────────────────────────────

/**
 * Minimal interface that a WebView ref must satisfy.
 * Decoupled from react-native-webview to allow testing with mocks.
 */
export interface WebViewRef {
  injectJavaScript(script: string): void;
  reload(): void;
  goBack(): void;
  goForward(): void;
  stopLoading(): void;
}

// ─── Pending Request Tracking ──────────────────────────────────────

export interface PendingRequest<T = unknown> {
  readonly messageId: string;
  readonly type: OutboundMessageTypeName;
  readonly sentAt: number;
  readonly timeoutMs: number;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
}

// ─── Message ID Generation ─────────────────────────────────────────

let messageCounter = 0;

export function generateMessageId(): string {
  messageCounter += 1;
  return `msg_${Date.now()}_${messageCounter}`;
}

export function resetMessageCounter(): void {
  messageCounter = 0;
}
