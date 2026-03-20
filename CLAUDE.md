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
│   ├── banks/               # Built-in bank adapter configurations
│   │   ├── bank-of-america.ts
│   │   ├── chase.ts
│   │   ├── index.ts         # Barrel export for built-in adapters
│   │   └── wells-fargo.ts
│   ├── index.ts             # Public API re-exports
│   ├── registry.ts          # BankAdapterRegistry — plugin registration with duplicate/conflict detection
│   ├── types.ts             # Adapter types: selectors, extractors, MFA detection, config
│   └── validation.ts        # Config validation with detailed error messages
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
├── sdk/                     # High-level SDK types for host app integration
│   ├── types.ts             # PreviewState, PreviewStatus — host-facing preview state
│   └── index.ts             # Barrel export
├── ui/                      # Preview UI components (browser preview, status captions)
│   ├── BankSelector.ts      # Searchable bank list controller (headless, framework-agnostic)
│   ├── ConduitPreview.ts    # React component factory for bank browser preview
│   ├── types.ts             # UI component types (ConduitPreviewProps, PreviewRenderInfo)
│   ├── preview/             # Visual browser preview module (CDT-4)
│   │   ├── types.ts         # Preview types: dimensions, positions, transitions, masking config
│   │   ├── browser-preview-controller.ts  # Headless controller orchestrating preview state
│   │   ├── browser-preview-component.ts   # React component factory for live browser preview
│   │   ├── style-utilities.ts             # CSS style computation (scaling, positioning, transitions)
│   │   ├── sensitive-field-masker.ts      # JS injection for blurring sensitive fields
│   │   ├── transition-state-machine.ts    # Page transition animation state machine
│   │   └── index.ts         # Barrel exports
│   └── index.ts             # UI module barrel exports
└── index.ts                 # SDK entry point

server/
├── server.ts                  # Live testing server (Puppeteer + Express)
├── stealth.ts                 # Anti-detection stealth module (CDT-10)
└── package.json               # Server-specific dependencies

tests/
├── auth/
│   ├── types.test.ts              # Validation and error type tests
│   ├── auth-state-machine.test.ts # State machine transition tests
│   ├── auth-module.test.ts        # Integration tests with mock browser
│   └── mfa-handler.test.ts        # MFA flow tests
├── adapters/
│   ├── banks.test.ts              # Built-in adapter config tests (Chase, BofA, Wells Fargo)
│   ├── registry.test.ts           # Registry registration, lookup, search, conflict detection
│   ├── types.test.ts              # Adapter type construction and validation
│   └── validation.test.ts         # Config validation: selectors, extractors, MFA rules
├── server/
│   └── stealth.test.ts           # Stealth module: UA building, version extraction, script generation (57 tests)
├── ui/
│   ├── BankSelector.test.ts       # Bank selector controller: search, filter, selection state
│   ├── ConduitPreview.test.ts     # ConduitPreview component factory tests
│   └── preview/
│       ├── types.test.ts                      # Preview types, factories, validation tests
│       ├── browser-preview-controller.test.ts # Controller lifecycle, events, render info tests
│       ├── browser-preview-component.test.ts  # BrowserPreview React factory tests
│       ├── style-utilities.test.ts            # CSS scaling, positioning, dimension tests
│       ├── sensitive-field-masker.test.ts      # Script generation and result parsing tests
│       ├── transition-state-machine.test.ts   # Transition state machine lifecycle tests
│       └── integration.test.ts                # End-to-end preview flow tests
├── conduit-types.test.ts          # Account, Transaction, BankAdapter, Config, LinkSession tests
├── navigation.test.ts             # Navigation state machine transition tests
├── MessageBridge.test.ts          # Bridge communication tests
├── BrowserEngine.test.ts          # Engine integration tests (mock WebView)
└── CookieManager.test.ts          # Cookie storage and persistence tests

server/
├── server.ts                      # Express server with Puppeteer bank automation
├── test-chase-e2e.ts              # Chase login E2E test script (CDT-11)
├── test-chase-e2e.test.ts         # Unit tests for the E2E script
├── jest.config.js                 # Server-specific Jest config (ts-jest, diagnostics off)
├── package.json                   # Server dependencies (express, puppeteer, tsx)
└── screenshots/                   # (gitignored) Timestamped E2E screenshots
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

### Bank Adapter Framework (CDT-7)

The adapter system provides a pluggable architecture for bank-specific automation:

- **BankAdapterConfig** — declares selectors, extractors, and MFA detection rules for a bank
- **BankAdapterRegistry** — plugin registry with `register()`, `get()`, `search()`, and `listAll()`. Enforces unique bank IDs and detects URL conflicts at registration time.
- **Validation** — `validateBankAdapterConfig()` returns structured `AdapterValidationResult` with field-level errors; `assertValidBankAdapterConfig()` throws on invalid config
- **Built-in adapters** — Chase, Bank of America, Wells Fargo (in `src/adapters/banks/`)
- **BankSelectors** — CSS selectors for login fields, MFA prompts, account pages, transaction tables
- **BankExtractors** — `FieldExtractor` with `selector`, `attribute`, optional `transform` for extracting structured data from bank pages
- **MfaDetector** — URL patterns + CSS selectors to detect MFA challenge type (sms, email, security_question, push)

### Bank Selector UI

`BankSelectorController` is a headless, framework-agnostic controller for bank selection:
- Wraps `BankAdapterRegistry` to provide searchable, filterable bank listing
- Manages selection state with automatic deselection when filtered bank is no longer visible
- Listener-based state updates (no React dependency)

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
- **BrowserPreview Component** — `createBrowserPreview(React)` factory produces a React component from controller state. Includes WebView slot, toggle button, loading overlay, status label, and mask indicator.
- **Style Utilities** — `computePreviewStyles()` returns complete CSS for container and WebView. `computeWebViewScaleStyle()` computes CSS `transform: scale()` for thumbnail rendering. `computeContainerStyle()` maps position enums to CSS positioning.
- **TransitionStateMachine** — `idle → transitioning → complete → idle` for page transition animations with configurable duration and type (fade, slide_left, none).
- **Sensitive Field Masker** — generates self-contained IIFE scripts injected into WebView to blur sensitive fields (passwords, SSNs, credit cards) via CSS `filter: blur()`. Masking is idempotent (element marking with data attributes, style element ID check).
- **Dimension system** — discriminated union: `{ type: 'pixels', value: number }` or `{ type: 'percentage', value: number }` with `resolveDimension(dim, containerSize)` resolver.
- **ScriptInjector** interface — test seam for masking without a real WebView.

#### CSS Scaling for Thumbnail Preview
The thumbnail view uses CSS `transform: scale()` for smooth page scaling:
- `scaleFactor` (0.0, 1.0] controls the scale — default 1.0 (native)
- At scaleFactor 0.5 with 300x200 container: WebView is rendered at 600x400 then scaled to 300x200
- `computeWebViewScaleStyle()` computes the transform and compensating dimensions
- When expanded, scale is always 1.0 (native size)

#### Position System
Three configurable positions with CSS style mapping:
- **bottom_sheet** — `position: fixed; bottom: 0; left: 0; right: 0; z-index: 1000`
- **inline** — `position: relative; z-index: 1`
- **modal** — `position: fixed; top: 0; left: 0; right: 0; bottom: 0; z-index: 9999`

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

### Browser Anti-Detection Stealth (CDT-10)

The `server/stealth.ts` module provides comprehensive fingerprint evasion for headless Puppeteer:

- **`applyStealthToPage(page, browser, config?)`** — applies all stealth patches to a page before navigation
- **`buildCleanUserAgent(headlessUA, config?)`** — strips `HeadlessChrome` and fakes macOS platform
- **`extractChromeVersion(ua)`** — extracts the real Chrome version from Puppeteer's UA
- **`buildStealthScript(config?)`** — generates the in-browser JS that patches all detectable surfaces
- **`STEALTH_LAUNCH_ARGS`** — Chrome launch arguments optimized for stealth
- **`DEFAULT_STEALTH_CONFIG`** — sensible defaults for a macOS Chrome profile

**20 fingerprint surfaces patched:**
1. User-Agent string (HeadlessChrome → Chrome, Linux → macOS)
2. `navigator.webdriver` → false
3. `navigator.platform` → 'MacIntel' (consistent with UA)
4. `navigator.vendor` → 'Google Inc.'
5. `navigator.plugins` → realistic Chrome PDF/NaCl plugins
6. `navigator.mimeTypes` → matches plugins
7. `navigator.languages` → ['en-US', 'en']
8. `navigator.hardwareConcurrency` → 8
9. `navigator.deviceMemory` → 8 GB
10. `navigator.maxTouchPoints` → 0 (desktop)
11. `window.chrome` → comprehensive runtime/app/csi/loadTimes
12. `navigator.permissions.query` → correct notifications response
13. WebGL vendor/renderer → Apple M1 Pro (ANGLE)
14. Canvas fingerprint → subtle noise injection on toDataURL/toBlob
15. `window.outerWidth/outerHeight` → match screen dimensions
16. `screen.*` properties → realistic 1440×900 Retina display
17. `window.devicePixelRatio` → 2 (Retina)
18. CDP runtime artifacts → `cdc_*` properties removed
19. iframe stealth propagation → patches contentWindow on new iframes
20. `navigator.connection` → 4g/50ms RTT

**Key invariant:** The Chrome version in the UA is always extracted from the real browser, never hardcoded. This prevents version mismatch detection (e.g., UA says Chrome 131 but JS APIs report 146).

## SDK Distribution

The package is configured for SDK distribution:
- `main`: `dist/index.js` — CommonJS entry point
- `types`: `dist/index.d.ts` — TypeScript declarations
- `peerDependencies`: `react`, `react-native`, `react-native-webview`, `expo` (optional)

## Live Server (`server/`)

The `server/` directory contains a local Puppeteer-based backend for live bank testing.

### Commands (from `server/`)

```bash
npm install           # Install dependencies (auto-installs Chrome)
npm start             # Start the Express server (tsx server.ts)
npm run dev           # Start in watch mode
npm test              # Run server unit tests (Jest)
npm run test:chase    # Run the Chase E2E login test (requires credentials)
```

### Chase E2E Test (`server/test-chase-e2e.ts`)

Manual E2E test script that validates the Chase login flow with screenshots at each step.

**Expected flow:** `init → browser_launched → navigating → login_page_loaded → credentials_filled → submitted → device_verification → mfa_code_entry → mfa_submitted → success`

**Environment variables:**
| Variable | Required | Default | Description |
|---|---|---|---|
| `CHASE_USER` | Yes | — | Chase username |
| `CHASE_PASS` | Yes | — | Chase password |
| `CHASE_E2E_HEADLESS` | No | `true` | Run browser headless (`true`/`false`) |
| `CHASE_E2E_TIMEOUT` | No | `45000` | Navigation timeout in ms |
| `CHASE_E2E_SCREENSHOT_DIR` | No | `./screenshots` | Directory for timestamped screenshots |

**Usage:**
```bash
cd server
CHASE_USER=myuser CHASE_PASS=mypass npm run test:chase
# Or for visible browser:
CHASE_USER=myuser CHASE_PASS=mypass CHASE_E2E_HEADLESS=false npm run test:chase
```

**Key features:**
- Mirrors all stealth patches from `server.ts` (UA cleaning, navigator.webdriver, plugins, chrome runtime)
- Multi-strategy form detection: known selectors → iframe probe → shadow DOM → deep DOM probe
- Outcome detection: success, MFA code entry, device verification, error (via CSS selectors + text pattern matching)
- Timestamped screenshots at every stage transition
- Interactive TTY mode for MFA code entry (when running non-headless)
- Prints summary report with PASS/STOPPED result and stage log

**Exports (for unit testing):** `CHASE_SELECTORS`, `CHASE_LOGIN_URL`, `STAGE_ORDER`, `buildConfig`, `applyStealthPatches`, `probeForLoginForm`, `detectOutcome`, `extractMfaMethods`, `extractErrorText`, `takeScreenshot`, `runChaseE2E`, `printReport`

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

### Bank Adapter Framework
20. Bank adapter IDs are unique within a registry — duplicate registration throws `AdapterRegistrationError`
21. URL conflict detection: two adapters cannot claim the same `loginUrl` — enforced at registration
22. `BankAdapterConfig` validation is comprehensive: requires non-empty selectors, valid extractor fields, and at least one MFA detection rule
23. `BankSelectorController.filteredBanks` is always a subset of `allBanks`
24. Selected bank is cleared when it's no longer in the filtered results

### Visual Browser Preview
25. `BrowserPreviewController` must be disposed before the engine it's attached to — `dispose()` detaches automatically
26. Transition state follows `idle → transitioning → complete → idle` — enforced via `assertValidTransitionPhaseChange()`
27. Starting a new transition while already transitioning force-completes the previous transition first
28. Zero-duration or `TransitionType.None` transitions complete instantly (no transitioning state)
29. Sensitive field masking is idempotent — elements are marked with `PROCESSED_ATTR`, style element checked by ID
30. `resolveDimension()` for percentage type returns `Math.round(value / 100 * containerSize)`
31. Negative blur radius is clamped to 0
32. Empty or whitespace-only selectors are filtered out before script generation
33. `parseMaskingResult()` never throws — always returns a valid `SensitiveFieldMaskResult`
34. `BrowserPreviewConfig` validation requires: width/height > 0, blurRadius ≥ 0, transitionDuration ≥ 0, at least one field rule
35. Events are emitted synchronously — listeners execute in registration order

### Browser Stealth (CDT-10)
36. UA Chrome version always matches Puppeteer's actual Chrome version — never hardcoded
37. `navigator.platform` must be consistent with the OS string in the UA
38. WebGL vendor/renderer strings must correspond to a real GPU on the spoofed platform
39. All stealth patches run via `evaluateOnNewDocument` — before any bank JS executes
40. Stealth script is wrapped in IIFE and uses strict mode — no global scope pollution
