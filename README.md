# Conduit SDK

Plaid competitor — an Expo SDK that runs an embedded browser to log into banking sites, extract account data (accounts, routing/account numbers, transactions), and shows a live minimized visual preview of the browser with status captions explaining each step.

## Features

### Core SDK Types
- **Account** — bank account model with balance, type classification, masked account/routing numbers
- **Transaction** — financial transaction with signed amounts, categories, pending/posted status
- **BankAdapter** — interface for per-bank automation (authenticate, extract accounts & transactions)
- **ConduitConfig** — SDK configuration with runtime validation
- **LinkSession** — discriminated union tracking user-facing link flow lifecycle

### Embedded Browser Engine (CDT-2)
- **WebView integration** — `BrowserEngine` wraps react-native-webview for headless-like browser automation
- **Navigation state machine** — Type-safe state flow: `idle → navigating → loaded → extracting → complete`
- **MessageBridge** — Bidirectional RN ↔ WebView communication via injected JavaScript bridge
- **DOM extraction** — Extract full page HTML or targeted elements via CSS selectors
- **JavaScript injection** — Execute arbitrary scripts and eval expressions in the WebView context
- **Wait utilities** — `waitForElement()`, `waitForNavigation()`, `waitForPageReady()` with configurable timeouts
- **Cookie management** — In-memory cookie store with domain filtering, expiration pruning, and pluggable persistence

### Bank Authentication (CDT-3)
- **Credential submission** — Accept username/password via SDK API, navigate to bank login, fill & submit
- **MFA handling** — Detect and handle SMS codes, email codes, security questions, and push notifications
- **Host app integration** — Surface MFA prompts via callbacks/events, accept MFA input from host app
- **Login outcome detection** — Distinguish between successful login, failed login, and account locked

### Bank Adapter Framework (CDT-7)
- **Pluggable adapters** — Declare CSS selectors, extractors, and MFA rules per bank
- **Adapter registry** — Register, search, and look up bank adapters with duplicate/conflict detection
- **Config validation** — Detailed validation of adapter configs with field-level error messages
- **Built-in adapters** — Chase, Bank of America, Wells Fargo pre-configured
- **MFA detection** — URL patterns and CSS selectors to identify MFA challenge types
- **Bank selector UI** — Headless, searchable bank list controller (framework-agnostic)

### Transaction Extraction Engine (CDT-14)
- **Generic extraction engine** — Configurable DOM extraction using adapter-defined selectors and strategies
- **Transform pipeline** — `parseAmount` (currency, signs, thousands), `parseDate` (US, ISO, named months), `trim`, `maskAccountNumber`
- **Pagination handling** — Clicks "load more" buttons with configurable max pages
- **Pending/posted detection** — Distinguishes pending from posted transactions
- **Date range filtering** — Filters transactions by start/end date (inclusive)
- **DomContext interface** — Abstraction for DOM queries, works with Puppeteer, JSDOM, or WebView

### Browser Anti-Detection Stealth (CDT-10)
- **Comprehensive fingerprint evasion** — 20 fingerprint surfaces patched to evade bank client-side detection
- **UA version consistency** — Chrome version extracted from real browser, never hardcoded
- **Navigator spoofing** — platform, vendor, plugins, mimeTypes, languages, hardwareConcurrency, deviceMemory
- **WebGL spoofing** — vendor and renderer strings match a real Apple GPU
- **Canvas noise** — Subtle pixel noise injection to defeat canvas fingerprinting
- **Screen/window dimensions** — Consistent macOS Retina display profile
- **CDP artifact removal** — Removes Chrome DevTools Protocol runtime artifacts (`cdc_*` properties)
- **Iframe propagation** — Stealth patches propagate to dynamically created iframes

### Visual Browser Preview (CDT-4)
- **Live browser preview** — Minimized real-time view of the bank browser as navigation happens
- **Configurable container** — Pixel-based (e.g., 300x200) or percentage-based sizing
- **Expand/collapse toggle** — Switch between thumbnail and full view
- **Page transition animations** — Smooth fade or slide animations between pages, with configurable duration
- **Sensitive field masking** — Automatically blurs password inputs, credit card fields, SSN fields, and PINs
- **Configurable position** — Render as bottom sheet, inline component, or modal overlay
- **Scale factor** — Smooth thumbnail scaling of the full page into the mini view
- **Headless controller** — Framework-agnostic controller with pure render logic

## Setup

```bash
npm install           # Install dependencies
npm run build         # Build TypeScript to dist/
npm test              # Run all tests
npm run typecheck     # Type-check without emitting
npm run lint          # Lint with ESLint
npm run format        # Format with Prettier
```

## SDK Installation (for consumers)

```bash
npm install @conduit/sdk
```

### Peer Dependencies

- `react` >= 18.0.0
- `react-native` >= 0.72.0
- `react-native-webview` >= 13.0.0
- `expo` >= 49.0.0 (optional)

## Usage

### SDK Configuration

```typescript
import { assertValidConfig, type ConduitConfig } from '@conduit/sdk';

const config: ConduitConfig = {
  clientId: 'your_client_id',
  environment: 'sandbox',
  logLevel: 'info',
  navigationTimeoutMs: 30_000,
  mfaTimeoutMs: 300_000,
  showPreview: true,
};

assertValidConfig(config); // Throws if invalid
```

### Working with Accounts & Transactions

```typescript
import type { Account, Transaction, BankAdapter } from '@conduit/sdk';
import { AccountType, TransactionStatus } from '@conduit/sdk';

const adapter: BankAdapter = getBankAdapter('chase');
const authenticated = await adapter.authenticate();
if (authenticated) {
  const accounts = await adapter.getAccounts();
  for (const account of accounts) {
    if (account.type === AccountType.Checking) {
      const txns = await adapter.getTransactions(account.id, '2024-01-01', '2024-01-31');
      const pending = txns.filter(t => t.status === TransactionStatus.Pending);
    }
  }
  await adapter.cleanup();
}
```

### Transaction Extraction (CDT-14)

```typescript
import { extractTransactions, chaseAdapter, type TransactionDomContext } from '@conduit/sdk';

const ctx: TransactionDomContext = createPuppeteerDomContext(page);
const transactions = await extractTransactions(ctx, chaseAdapter, {
  accountId: 'chase-checking-001',
  currency: 'USD',
  startDate: '2024-01-01',
  endDate: '2024-01-31',
  maxPages: 5,
});

for (const txn of transactions) {
  console.log(`${txn.date} ${txn.description} ${txn.amount} (${txn.status})`);
}
```

### Link Session Flow

```typescript
import { LinkSessionPhase, type LinkSession } from '@conduit/sdk';

function handleSessionUpdate(session: LinkSession) {
  switch (session.phase) {
    case 'created':       showInstitutionPicker(); break;
    case 'authenticating': showLoadingSpinner(); break;
    case 'mfa_required':  showMfaPrompt(session.mfaChallengeType); break;
    case 'extracting':    showProgress(session.progress); break;
    case 'succeeded':     showAccounts(session.accounts); break;
    case 'failed':        showError(session.error.message); break;
    case 'cancelled':     navigateBack(); break;
  }
}
```

### Bank Adapter Registry

```typescript
import {
  BankAdapterRegistry,
  createDefaultRegistry,
  BankSelectorController,
} from '@conduit/sdk';

// 1. Create a registry with built-in adapters
const registry = createDefaultRegistry();

// 2. Search for banks
const results = registry.search({ query: 'chase' });

// 3. Use the bank selector UI controller
const selector = new BankSelectorController(registry);
selector.subscribe((state) => {
  // state.filteredBanks — banks matching current query
  // state.selectedBank — currently selected bank, or null
  renderBankList(state);
});
selector.setQuery('wells');
selector.select(results[0]!.id);

// 4. Clean up
selector.dispose();
```

### Browser Preview

```typescript
import {
  BrowserPreviewController,
  computeBrowserPreviewRenderInfo,
  PreviewPosition,
  TransitionType,
} from '@conduit/sdk';

// 1. Create the preview controller
const preview = new BrowserPreviewController({
  position: PreviewPosition.BottomSheet,
  transitionType: TransitionType.Fade,
  transitionDurationMs: 300,
  scaleFactor: 0.5,
});

// 2. Attach the BrowserEngine for real-time navigation events
preview.attachEngine(browserEngine);

// 3. Subscribe to state changes for your UI
preview.on((event) => {
  if (event.type === 'state_change') {
    const renderInfo = computeBrowserPreviewRenderInfo(event.state);
    // renderInfo has: showWebView, containerWidth, containerHeight,
    //                 opacity, webViewScale, showLoadingOverlay, etc.
    updateUI(renderInfo);
  }
});

// 4. Toggle expand/collapse
preview.toggle();

// 5. Cleanup
preview.dispose();
```

## Architecture

```
src/
├── adapters/    # Bank adapter framework — pluggable per-bank configs
│   ├── banks/   # Built-in adapters (Chase, BofA, Wells Fargo)
│   ├── registry.ts    # Plugin registry with conflict detection
│   ├── types.ts       # Selectors, extractors, MFA detection rules
│   ├── validation.ts  # Config validation with field-level errors
│   ├── transforms.ts  # Value transforms: parseAmount, parseDate (CDT-14)
│   ├── extraction.ts  # Generic DOM extraction engine (CDT-14)
│   └── transaction-extractor.ts  # Transaction extraction with pagination (CDT-14)
├── auth/        # Authentication logic with state machine
├── browser/     # Abstract BrowserDriver interface
├── core/        # Embedded WebView engine + MessageBridge
├── sdk/         # High-level SDK types for host app integration
├── types/       # Core domain types (Account, Transaction, BankAdapter, Config, LinkSession)
└── ui/          # UI components
    ├── BankSelector.ts  # Searchable bank list controller
    ├── ConduitPreview.ts # React component factory for preview
    └── preview/  # Visual browser preview (CDT-4): controller, transitions, masking

server/
├── server.ts              # Express server with Puppeteer bank automation
├── test-chase-e2e.ts      # Chase login E2E test (CDT-11)
├── test-chase-e2e.test.ts # Unit tests for E2E script
└── jest.config.js         # Server Jest config
```

### Chase E2E Login Test (CDT-11)

A manual E2E test script that validates the full Chase login flow end-to-end using Puppeteer with stealth patches. It takes timestamped screenshots at every stage and identifies which stage it reached.

```bash
cd server
CHASE_USER=myuser CHASE_PASS=mypass npm run test:chase
```

**Expected flow:**
```
init → browser_launched → navigating → login_page_loaded → credentials_filled
  → submitted → device_verification → mfa_code_entry → mfa_submitted → success
```

The script runs in headless mode by default. Set `CHASE_E2E_HEADLESS=false` for a visible browser with interactive MFA code entry via terminal prompt.

### State Machines

- **Navigation:** `idle → navigating → loaded → extracting → complete`
- **Auth:** `idle → logging_in → [mfa_required → mfa_submitting →] authenticated | auth_failed`
- **Link Session:** `created → institution_selected → authenticating → extracting → succeeded | failed | cancelled`
- **Page Transition:** `idle → transitioning → complete → idle`

### Design Philosophy

Built with **Correctness by Construction** principles:
- Discriminated unions make illegal states unrepresentable
- State machines enforce valid transitions at runtime
- Precondition assertions catch errors early
- `as const` enum patterns provide both runtime values and type safety

## License

MIT
