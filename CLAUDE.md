# Conduit SDK — Developer Guide

Plaid competitor — an Expo SDK that runs an embedded browser to log into banking sites, extract account data (accounts, routing/account numbers, transactions), and shows a live minimized visual preview of the browser with status captions explaining each step.

## Commands

```bash
npm install           # Install dependencies
npm run build         # Compile TypeScript to dist/
npm test              # Run all tests
npm run test:watch    # Run tests in watch mode
npm run test:coverage # Run tests with coverage report
npm run typecheck     # Type-check without emitting
npm run lint          # Lint with ESLint
npm run lint:fix      # Lint and auto-fix
npm run format        # Format with Prettier
npm run format:check  # Check formatting without writing
npm run clean         # Remove dist/
```

## Project Architecture

```
src/
├── adapters/                # Bank-specific adapter implementations (per-bank automation)
│   └── .gitkeep
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
│   ├── conduit.ts           # Core domain types: Account, Transaction, BankAdapter, ConduitConfig, LinkSession
│   ├── navigation.ts        # Navigation state machine (discriminated union, transitions)
│   ├── bridge.ts            # WebView message types (inbound/outbound), WebViewRef, CookieData
│   └── index.ts             # Barrel export
├── ui/                      # Preview UI components (browser preview, status captions)
│   ├── ConduitPreview.ts    # React component factory for bank browser preview
│   ├── types.ts             # UI component types (ConduitPreviewProps, PreviewRenderInfo)
│   ├── preview/             # Visual browser preview module (CDT-4)
│   │   ├── types.ts         # Preview types: dimensions, positions, transitions, masking config
│   │   ├── browser-preview-controller.ts  # Headless controller orchestrating preview state
│   │   ├── sensitive-field-masker.ts      # JS injection for blurring sensitive fields
│   │   ├── transition-state-machine.ts    # Page transition animation state machine
│   │   └── index.ts         # Barrel exports
│   └── index.ts             # UI module barrel exports
└── index.ts                 # SDK entry point

tests/
├── auth/
│   ├── types.test.ts              # Validation and error type tests
│   ├── auth-state-machine.test.ts # State machine transition tests
│   ├── auth-module.test.ts        # Integration tests with mock browser
│   └── mfa-handler.test.ts        # MFA flow tests
├── ui/
│   └── preview/
│       ├── types.test.ts                      # Preview types, factories, validation tests
│       ├── browser-preview-controller.test.ts # Controller lifecycle, events, render info tests
│       ├── sensitive-field-masker.test.ts      # Script generation and result parsing tests
│       └── transition-state-machine.test.ts   # Transition state machine lifecycle tests
├── conduit-types.test.ts          # Account, Transaction, BankAdapter, Config, LinkSession tests
├── navigation.test.ts             # Navigation state machine transition tests
├── MessageBridge.test.ts          # Bridge communication tests
├── BrowserEngine.test.ts          # Engine integration tests (mock WebView)
└── CookieManager.test.ts          # Cookie storage and persistence tests
```

## Key Patterns

### Correctness by Construction
- **Discriminated unions** for all variant types (MFA challenges, auth results, events, navigation states, messages, link session states)
- **State machines** with explicit valid transitions — illegal transitions throw
- **Runtime assertions** for preconditions (credentials non-empty, MFA response matches challenge, page loaded before extraction, valid config)
- **Type-safe error codes** via `ConduitAuthErrorCode`, `NavigationErrorCode`, and `LinkErrorCode` union types
- **Exhaustive const enums** with `as const` pattern for runtime + type safety (AccountType, TransactionStatus, LogLevel, etc.)

### Core Domain Types
- **Account** — bank account with balance, type enum, masked account/routing numbers
- **Transaction** — signed amount (negative=debit), status (pending/posted), ISO dates
- **BankAdapter** — interface for per-bank automation (authenticate → getAccounts → getTransactions → cleanup)
- **ConduitConfig** — SDK configuration with validation (assertValidConfig)
- **LinkSession** — discriminated union tracking user-facing flow (created → institution_selected → authenticating → extracting → succeeded/failed/cancelled)

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

### Link Session State Machine
```
created → institution_selected → authenticating → extracting → succeeded
                                               ↘ mfa_required ↗
                                               ↘ failed
          Any active state → cancelled
```

### Visual Browser Preview (CDT-4)

The preview system renders a miniaturized view of the WebView during bank automation. It uses a **headless controller pattern** — `BrowserPreviewController` manages all state and emits events, while rendering is delegated to the host app's UI layer (React Native, web, etc.).

Key components:
- **BrowserPreviewController** — orchestrates expand/collapse, visibility, position, page transitions, and sensitive field masking. Attaches to `BrowserEngine` for navigation events.
- **TransitionStateMachine** — `idle → transitioning → complete → idle` for page transition animations with configurable duration and type (fade, slide_left, none).
- **Sensitive Field Masker** — generates self-contained IIFE scripts injected into WebView to blur sensitive fields (passwords, SSNs, credit cards) via CSS `filter: blur()`. Masking is idempotent (element marking with data attributes, style element ID check).
- **Dimension system** — discriminated union: `{ type: 'pixels', value: number }` or `{ type: 'percentage', value: number }` with `resolveDimension(dim, containerSize)` resolver.
- **ScriptInjector** interface — test seam for masking without a real WebView.

### Transition State Machine
```
idle → transitioning → complete → idle
       (start)          (tick→1.0)  (reset)
```
- Zero-duration or `TransitionType.None` transitions complete instantly
- `tickByTime(currentTime)` calculates progress from elapsed/duration ratio
- Starting a new transition while transitioning force-completes the current one

### Sensitive Field Masking
- `generateMaskingScript(config)` builds a JS IIFE that creates a `<style>` element with blur CSS, queries elements matching selectors, applies MASK_CLASS
- `generateUnmaskingScript()` removes all masks and the style element
- Scripts return JSON results parsed by `parseMaskingResult()`
- Default rules cover: password inputs, hidden inputs, credit card numbers, CVV/CVC, SSN fields, social security, PIN inputs, `[data-sensitive]` elements

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

## SDK Distribution

The package is configured for SDK distribution:
- `main`: `dist/index.js` — CommonJS entry point
- `types`: `dist/index.d.ts` — TypeScript declarations
- `peerDependencies`: `react`, `react-native`, `react-native-webview`, `expo` (optional)

## Environment Variables

None required for the SDK itself. Browser driver implementations may need environment-specific config. `ConduitConfig` provides runtime configuration.

## Invariants

### Core Domain
1. `ConduitConfig.clientId` must be non-empty — validated at construction via `assertValidConfig()`
2. `Account.id` is unique within a single adapter session
3. `Transaction.amount` is signed: negative = debit, positive = credit
4. BankAdapter methods must be called in order: authenticate → getAccounts → getTransactions → cleanup
5. LinkSession transitions follow the state machine — enforced via `assertValidLinkTransition()`
6. Terminal states (succeeded, failed, cancelled) have no outgoing transitions

### Auth Module
7. Only one auth flow per `AuthModule` instance at a time
8. State transitions follow `VALID_TRANSITIONS` map — enforced at runtime
9. Credentials are never stored — only used transiently during login
10. Browser resources are always cleaned up (finally block), even on errors
11. MFA retries never exceed `maxMfaRetries`
12. Every MFA response is validated against its challenge before submission

### Browser Engine
13. Navigation state transitions follow `VALID_TRANSITIONS` — enforced at runtime via `assertValidTransition()`
14. Every outbound message gets a unique `messageId` (monotonic counter + timestamp)
15. Every pending request is resolved or rejected within its timeout — no leaked promises
16. The `MessageBridge` is the ONLY communication path between RN and WebView
17. DOM extraction and JS injection require page to be in `loaded` state — enforced by precondition checks
18. `dispose()` cancels all pending requests and clears all handlers
19. Expired cookies are automatically pruned on access — never returned to callers

### Visual Browser Preview
20. `BrowserPreviewController` must be disposed before the engine it's attached to — `dispose()` detaches automatically
21. Transition state follows `idle → transitioning → complete → idle` — enforced via `assertValidTransitionPhaseChange()`
22. Starting a new transition while already transitioning force-completes the previous transition first
23. Zero-duration or `TransitionType.None` transitions complete instantly (no transitioning state)
24. Sensitive field masking is idempotent — elements are marked with `PROCESSED_ATTR`, style element checked by ID
25. `resolveDimension()` for percentage type returns `Math.round(value / 100 * containerSize)`
26. Negative blur radius is clamped to 0
27. Empty or whitespace-only selectors are filtered out before script generation
28. `parseMaskingResult()` never throws — always returns a valid `SensitiveFieldMaskResult`
29. `BrowserPreviewConfig` validation requires: width/height > 0, blurRadius ≥ 0, transitionDuration ≥ 0, at least one field rule
30. Events are emitted synchronously — listeners execute in registration order
