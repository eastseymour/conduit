# Conduit SDK — Developer Guide

Plaid competitor — an Expo SDK that runs an embedded browser to log into banking sites, extract account data (accounts, routing/account numbers, transactions), and shows a live minimized visual preview of the browser with status captions explaining each step.

## Commands

```bash
npm install          # Install dependencies
npm run build        # Compile TypeScript to dist/
npm test             # Run all tests
npm run test:watch   # Run tests in watch mode
npm run test:coverage # Run tests with coverage report
npm run lint         # Type-check without emitting
npm run clean        # Remove dist/
```

## Project Architecture

```
src/
├── auth/                    # Bank authentication module
│   ├── types.ts             # All auth types (discriminated unions, error types, validation)
│   ├── auth-state-machine.ts # State machine enforcing valid auth transitions
│   ├── auth-module.ts       # Main orchestrator for auth flow
│   ├── mfa-handler.ts       # MFA challenge/response loop handler
│   └── index.ts             # Public API re-exports
├── browser/                 # Browser automation interface (port/adapter boundary)
│   ├── types.ts             # BrowserDriver interface + result types
│   └── index.ts             # Public API re-exports
├── core/                    # Embedded browser engine (WebView integration)
│   ├── BrowserEngine.ts     # Main engine: navigation, JS injection, DOM extraction
│   ├── MessageBridge.ts     # RN ↔ WebView communication bridge with bridge injection script
│   ├── CookieManager.ts     # Cookie storage, domain filtering, persistence
│   └── index.ts             # Public API re-exports
├── types/                   # Shared type definitions
│   ├── navigation.ts        # Navigation state machine (discriminated union, transitions)
│   ├── bridge.ts            # WebView message types (inbound/outbound), WebViewRef, CookieData
│   └── index.ts             # Barrel export
└── index.ts                 # SDK entry point

tests/
├── auth/
│   ├── types.test.ts              # Validation and error type tests
│   ├── auth-state-machine.test.ts # State machine transition tests
│   ├── auth-module.test.ts        # Integration tests with mock browser
│   └── mfa-handler.test.ts        # MFA flow tests
├── navigation.test.ts             # Navigation state machine transition tests
├── MessageBridge.test.ts          # Bridge communication tests
├── BrowserEngine.test.ts          # Engine integration tests (mock WebView)
└── CookieManager.test.ts          # Cookie storage and persistence tests
```

## Key Patterns

### Correctness by Construction
- **Discriminated unions** for all variant types (MFA challenges, auth results, events, navigation states, messages)
- **State machine** with explicit valid transitions — illegal transitions throw
- **Runtime assertions** for preconditions (credentials non-empty, MFA response matches challenge, page loaded before extraction)
- **Type-safe error codes** via `ConduitAuthErrorCode` and `NavigationErrorCode` union types

### Auth State Flow
```
idle → logging_in → mfa_required → mfa_submitting → authenticated
                  ↘ authenticated                  ↗ mfa_required (retry)
                  ↘ auth_failed                    ↘ auth_failed
```

### Navigation State Machine
```
idle → navigating → loaded → extracting → complete → idle
                  ↘ error ↗            ↘ error ↗
       loaded → navigating (re-navigate)
       complete → navigating (re-navigate)
       error → navigating (retry)
```

### Browser Driver Interface
The auth module depends on the `BrowserDriver` interface (port/adapter pattern). Concrete implementations (Puppeteer, Playwright, Expo WebView) implement this interface. Tests use mock drivers.

### MessageBridge Architecture
The `MessageBridge` is the sole communication path between React Native and the WebView JavaScript context:
- **Outbound**: Serializes messages, injects JavaScript via `WebViewRef.injectJavaScript()`
- **Inbound**: Parses `postMessage` data, dispatches to handlers, correlates request/response via `messageId`
- **Bridge Script**: Injected JavaScript that creates `window.__CONDUIT_BRIDGE__` with handlers for DOM extraction, element waiting, cookie access, script injection, and expression evaluation
- **Timeout**: Every pending request has a configurable timeout; defaults to 30s

### Event System
All state transitions emit typed events via callbacks. The host app provides `AuthCallbacks` with:
- `onStateChange(event)` — called on every transition
- `onMfaRequired(challenge)` — called when MFA is needed, returns user's response

The `BrowserEngine` emits events for:
- `stateChange` — navigation state transitions
- `console` — forwarded console.log/warn/error from the WebView
- `error` — page errors and unhandled exceptions from the WebView

## Environment Variables

None required for the SDK itself. Browser driver implementations may need environment-specific config.

## Invariants

### Auth Module
1. Only one auth flow per `AuthModule` instance at a time
2. State transitions follow `VALID_TRANSITIONS` map — enforced at runtime
3. Credentials are never stored — only used transiently during login
4. Browser resources are always cleaned up (finally block), even on errors
5. MFA retries never exceed `maxMfaRetries`
6. Every MFA response is validated against its challenge before submission

### Browser Engine
7. Navigation state transitions follow `VALID_TRANSITIONS` — enforced at runtime via `assertValidTransition()`
8. Every outbound message gets a unique `messageId` (monotonic counter + timestamp)
9. Every pending request is resolved or rejected within its timeout — no leaked promises
10. The `MessageBridge` is the ONLY communication path between RN and WebView
11. DOM extraction and JS injection require page to be in `loaded` state — enforced by precondition checks
12. `dispose()` cancels all pending requests and clears all handlers
13. Expired cookies are automatically pruned on access — never returned to callers
