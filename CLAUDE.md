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
└── index.ts                 # SDK entry point

tests/
├── auth/
│   ├── types.test.ts              # Validation and error type tests
│   ├── auth-state-machine.test.ts # State machine transition tests
│   ├── auth-module.test.ts        # Integration tests with mock browser
│   └── mfa-handler.test.ts        # MFA flow tests
```

## Key Patterns

### Correctness by Construction
- **Discriminated unions** for all variant types (MFA challenges, auth results, events)
- **State machine** with explicit valid transitions — illegal transitions throw
- **Runtime assertions** for preconditions (credentials non-empty, MFA response matches challenge)
- **Type-safe error codes** via `ConduitAuthErrorCode` union type

### Auth State Flow
```
idle → logging_in → mfa_required → mfa_submitting → authenticated
                  ↘ authenticated                  ↗ mfa_required (retry)
                  ↘ auth_failed                    ↘ auth_failed
```

### Browser Driver Interface
The auth module depends on the `BrowserDriver` interface (port/adapter pattern). Concrete implementations (Puppeteer, Playwright, Expo WebView) implement this interface. Tests use mock drivers.

### Event System
All state transitions emit typed events via callbacks. The host app provides `AuthCallbacks` with:
- `onStateChange(event)` — called on every transition
- `onMfaRequired(challenge)` — called when MFA is needed, returns user's response

## Environment Variables

None required for the SDK itself. Browser driver implementations may need environment-specific config.

## Invariants

1. Only one auth flow per `AuthModule` instance at a time
2. State transitions follow `VALID_TRANSITIONS` map — enforced at runtime
3. Credentials are never stored — only used transiently during login
4. Browser resources are always cleaned up (finally block), even on errors
5. MFA retries never exceed `maxMfaRetries`
6. Every MFA response is validated against its challenge before submission
