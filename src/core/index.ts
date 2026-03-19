/**
 * Core module — Browser engine, message bridge, and cookie management
 */

export { BrowserEngine } from './BrowserEngine';
export type {
  BrowserEngineConfig,
  BrowserEngineEvent,
  BrowserEngineEventListener,
  NavigationResult,
  DOMExtractionResult,
  ScriptResult,
} from './BrowserEngine';

export { MessageBridge, BRIDGE_INJECTION_SCRIPT } from './MessageBridge';
export type { InboundMessageHandler, MessageBridgeConfig } from './MessageBridge';

export { CookieManager } from './CookieManager';
export type { CookiePersistenceCallbacks } from './CookieManager';
