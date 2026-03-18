# Conduit SDK

Plaid competitor — an Expo SDK that runs an embedded browser to log into banking sites, extract account data (accounts, routing/account numbers, transactions), and shows a live minimized visual preview of the browser with status captions explaining each step.

## Features

### Embedded Browser Engine (CDT-2)
- **WebView integration** — `BrowserEngine` wraps react-native-webview for headless-like browser automation
- **Navigation state machine** — Type-safe state flow: `idle → navigating → loaded → extracting → complete`
- **MessageBridge** — Bidirectional RN ↔ WebView communication via injected JavaScript bridge
- **DOM extraction** — Extract full page HTML or targeted elements via CSS selectors
- **JavaScript injection** — Execute arbitrary scripts and eval expressions in the WebView context
- **Wait utilities** — `waitForElement()`, `waitForNavigation()`, `waitForPageReady()` with configurable timeouts
- **Cookie management** — In-memory cookie store with domain filtering, expiration pruning, and pluggable persistence
- **Error handling** — Typed errors for timeouts, SSL failures, load errors, network errors
- **Redirect tracking** — Full redirect chain captured during navigation

### Bank Authentication (CDT-3)
- **Credential submission** — Accept username/password via SDK API, navigate to bank login, fill & submit
- **MFA handling** — Detect and handle SMS codes, email codes, security questions, and push notifications
- **Host app integration** — Surface MFA prompts via callbacks/events, accept MFA input from host app
- **Login outcome detection** — Distinguish between successful login, failed login, and account locked
- **Session persistence** — Handle "remember this device" prompts
- **State events** — Emit typed events throughout: `logging_in`, `mfa_required`, `mfa_submitting`, `authenticated`, `auth_failed`
- **Safety** — Timeout protection, max MFA retry limits, automatic browser cleanup

### Bank Adapter Framework (CDT-7)
- **Pluggable per-bank scripts** — Each bank defines its own CSS selectors, data extractors, and MFA detection rules
- **3 built-in adapters** — Chase, Bank of America, Wells Fargo with full login, MFA, account, and transaction selectors
- **Adapter registry** — Central lookup by `bankId` with search, filtering, and validation at registration time
- **Bank selection UI** — Headless `BankSelectorController` with search, subscribe/unsubscribe, and auto-managed selection state
- **Validation utilities** — `validateBankAdapterConfig()` with detailed error/warning reporting for custom adapters
- **Type-safe extraction** — Discriminated union `ExtractionStrategy` (textContent, innerText, attribute, value, regex)
- **MFA detection** — Priority-ordered detection rules mapping CSS selectors to MFA challenge types

## Setup

```bash
# Install dependencies
npm install

# Build
npm run build

# Run tests
npm test

# Type-check
npm run lint
```

## Usage

### Browser Engine

```typescript
import { BrowserEngine } from '@conduit/sdk';

// 1. Create and configure the engine
const engine = new BrowserEngine({
  defaultTimeoutMs: 30_000,
  jsTimeoutMs: 10_000,
  elementWaitTimeoutMs: 15_000,
  debug: false,
});

// 2. Connect the WebView ref (from react-native-webview)
engine.setWebViewRef(webViewRef);

// 3. Listen for events
engine.on((event) => {
  if (event.type === 'stateChange') {
    console.log(`Navigation: ${event.state.phase}`);
  }
});

// 4. Navigate and extract data
const navResult = await engine.navigate('https://bank.example.com/login');
if (navResult.success) {
  // Wait for the login form to appear
  const found = await engine.waitForElement('#login-form');
  if (found) {
    // Inject JavaScript to fill and submit the form
    await engine.injectJavaScript(`
      document.querySelector('#username').value = 'user';
      document.querySelector('#password').value = 'pass';
      document.querySelector('#login-form').submit();
    `);

    // Wait for navigation to complete
    await engine.waitForNavigation();

    // Extract the page DOM
    const dom = await engine.extractDOM();
    console.log(dom.html);
  }
}

// 5. Cleanup
engine.dispose();
```

### Auth Module

```typescript
import { AuthModule } from '@conduit/sdk';
import type { BrowserDriver } from '@conduit/sdk';

// 1. Create an auth module with options
const auth = new AuthModule({
  maxMfaRetries: 3,
  rememberDevice: true,
  timeoutMs: 120_000,
  mfaTimeoutMs: 300_000,
});

// 2. Implement the BrowserDriver interface for your platform
const browserDriver: BrowserDriver = {
  async navigateToLogin(bankId) { /* ... */ },
  async submitCredentials(credentials) { /* ... */ },
  async submitMfaResponse(response) { /* ... */ },
  async handleRememberDevice(remember) { /* ... */ },
  async cleanup() { /* ... */ },
};

// 3. Start authentication with callbacks
const result = await auth.authenticate(
  'chase',                               // bank ID
  { username: 'user', password: 'pass' }, // credentials
  browserDriver,                          // browser driver
  {
    onStateChange(event) {
      console.log(`Auth state: ${event.type}`);
      // event.type is one of: 'idle' | 'logging_in' | 'mfa_required' |
      //                       'mfa_submitting' | 'authenticated' | 'auth_failed'
    },

    async onMfaRequired(challenge) {
      // Surface the MFA challenge to your UI
      // challenge.type is one of: 'sms_code' | 'email_code' |
      //                           'security_questions' | 'push_notification'

      if (challenge.type === 'sms_code') {
        const code = await promptUserForCode(challenge.maskedPhoneNumber);
        return {
          challengeId: challenge.challengeId,
          type: 'sms_code',
          code,
        };
      }

      // Return null to cancel MFA
      return null;
    },
  },
);

// 4. Handle the result
switch (result.status) {
  case 'success':
    console.log('Authenticated!', result.sessionToken);
    break;
  case 'failed':
    console.log('Login failed:', result.reason);
    break;
  case 'locked':
    console.log('Account locked:', result.reason);
    if (result.retryAfter) {
      console.log('Retry after:', result.retryAfter);
    }
    break;
}
```

### Bank Adapter Framework

```typescript
import {
  BankAdapterRegistry,
  createDefaultRegistry,
  BankSelectorController,
  validateBankAdapterConfig,
} from '@conduit/sdk';

// 1. Use the built-in registry with Chase, BofA, and Wells Fargo
const registry = createDefaultRegistry();

// 2. Look up a bank adapter by ID
const chaseAdapter = registry.get('chase');
console.log(chaseAdapter?.loginUrl); // https://secure.chase.com/...

// 3. Search for banks
const results = registry.search({ query: 'chase' });
console.log(results[0]?.name); // "Chase"

// 4. Filter by capabilities
const withTransactions = registry.search({ requireTransactions: true });

// 5. Use the bank selector controller for UI
const selector = new BankSelectorController(registry);

// Subscribe to state changes
const unsubscribe = selector.subscribe((state) => {
  console.log('Filtered banks:', state.filteredBanks.length);
  console.log('Selected:', state.selectedBank?.name);
});

// Search and select
selector.setQuery('chase');
selector.select('chase');

// Cleanup
unsubscribe();
selector.dispose();
```

### Adding a Custom Bank Adapter

```typescript
import {
  BankAdapterRegistry,
  validateBankAdapterConfig,
  type BankAdapterConfig,
} from '@conduit/sdk';

const myBankAdapter: BankAdapterConfig = {
  bankId: 'my_bank',
  name: 'My Bank',
  loginUrl: 'https://www.mybank.com/login',
  logoUrl: 'https://www.mybank.com/logo.png',
  selectors: {
    login: {
      usernameInput: '#username',
      passwordInput: '#password',
      submitButton: '#login-btn',
    },
    mfa: {
      codeInput: '#mfa-code',
      submitButton: '#mfa-submit',
    },
  },
  extractors: {
    accounts: {
      readySelector: '.accounts-list',
      fields: [
        {
          fieldName: 'accountName',
          selector: '.account-name',
          strategy: { type: 'textContent' },
          required: true,
        },
        {
          fieldName: 'balance',
          selector: '.account-balance',
          strategy: { type: 'textContent' },
          transform: 'parseAmount',
          required: true,
        },
      ],
    },
  },
  mfaDetector: {
    rules: [
      { selector: '#mfa-code', challengeType: 'sms_code' },
    ],
    successIndicator: '.dashboard-welcome',
    failureIndicator: '.login-error',
  },
};

// Validate before registering
const result = validateBankAdapterConfig(myBankAdapter);
if (!result.valid) {
  console.error('Validation errors:', result.errors);
}

// Register
const registry = new BankAdapterRegistry();
registry.register(myBankAdapter);
```

## Architecture

The SDK follows a **port/adapter pattern**:

- **Browser Engine** (`src/core/`) — Embedded WebView engine with MessageBridge communication layer
- **Auth Module** (`src/auth/`) — Core authentication logic with state machine
- **Browser Interface** (`src/browser/`) — Abstract `BrowserDriver` interface
- **Bank Adapters** (`src/adapters/`) — Pluggable per-bank scripts with CSS selectors, extractors, and MFA detection
- **Bank Selection UI** (`src/ui/`) — Headless controller for bank search and selection
- **Shared Types** (`src/types/`) — Navigation state machine, message types, WebView ref types

### Navigation State Machine

```
idle → navigating → loaded → extracting → complete → idle
                  ↘ error ↗            ↘ error ↗
```

### Auth State Machine

```
idle → logging_in → mfa_required → mfa_submitting → authenticated
                  ↘ authenticated                  ↗ mfa_required (retry)
                  ↘ auth_failed                    ↘ auth_failed
```

### Design Philosophy

Built with **Correctness by Construction** principles:
- Discriminated unions make illegal states unrepresentable
- State machine enforces valid transitions at runtime
- Precondition assertions catch errors early
- Typed error codes enable precise error handling

## License

MIT
