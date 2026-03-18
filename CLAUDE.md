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
├── adapters/                # Bank adapter framework (CDT-7)
│   ├── types.ts             # BankAdapterConfig, selectors, extractors, MFA detector types
│   ├── registry.ts          # BankAdapterRegistry — lookup by bankId, search, list
│   ├── validation.ts        # Adapter config validation with detailed error reporting
│   ├── banks/               # Built-in bank adapter configurations
│   │   ├── chase.ts         # Chase adapter (CSS selectors, extractors, MFA detection)
│   │   ├── bank-of-america.ts # Bank of America adapter
│   │   ├── wells-fargo.ts   # Wells Fargo adapter
│   │   └── index.ts         # Re-exports all bank adapters
│   └── index.ts             # Public API re-exports
├── ui/                      # Headless UI components
│   ├── BankSelector.ts      # Bank selection controller (searchable list with logos)
│   └── index.ts             # Public API re-exports
├── types/                   # Shared type definitions
│   ├── navigation.ts        # Navigation state machine (discriminated union, transitions)
│   ├── bridge.ts            # WebView message types (inbound/outbound), WebViewRef, CookieData
│   └── index.ts             # Barrel export
└── index.ts                 # SDK entry point

tests/
├── adapters/
│   ├── types.test.ts              # Adapter type compilation and value tests
│   ├── validation.test.ts         # Validation logic tests (150 cases)
│   ├── registry.test.ts           # Registry CRUD, search, default registry
│   └── banks.test.ts              # Built-in adapter validation and structure tests
├── ui/
│   └── BankSelector.test.ts       # Bank selector controller tests
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

### Bank Adapter Framework
Each bank has unique login pages, MFA flows, and data layouts. The adapter framework encapsulates all bank-specific details:
- **`BankAdapterConfig`** — Complete bank-specific configuration (selectors, extractors, MFA detection)
- **`BankAdapterRegistry`** — Central lookup; validates adapters at registration time, rejects duplicates
- **`BankSelectorController`** — Headless UI controller for bank selection (searchable, subscribe/unsubscribe pattern)
- **Validation-at-registration** — Every adapter is validated before it can be added to the registry
- **Discriminated unions** for `ExtractionStrategy` (`textContent | innerText | attribute | value | regex`)
- **`as const` adapter configs** for maximum type safety in built-in banks

### Adding a New Bank Adapter
1. Create `src/adapters/banks/<bank-name>.ts` exporting a `BankAdapterConfig`
2. Define login selectors (username, password, submit — all required)
3. Add MFA detection rules (at least one required)
4. Optionally add account/transaction extractors
5. Re-export from `src/adapters/banks/index.ts`
6. Register in `createDefaultRegistry()` in `src/adapters/registry.ts`
7. Run `npm test` to verify validation passes

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

### Bank Adapter Framework
14. No two adapters may share the same bankId — enforced at registration time
15. All registered adapters must pass validation — enforced at registration time
16. Lookup by bankId returns `undefined` (not an error) for unknown banks
17. Search results are sorted alphabetically by bank name
18. Every adapter must define login selectors — cannot create an adapter without them
19. MFA detector must define at least one detection rule
20. bankId must match pattern `/^[a-z][a-z0-9_]{0,49}$/` — lowercase, underscores, max 50 chars
21. BankSelectorController selection auto-clears when filtered bank is no longer visible
22. `dispose()` removes all subscribers — no leaked listeners
