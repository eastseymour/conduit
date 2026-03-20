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

### Account Data Extraction (CDT-13)
- **Post-login extraction** — After successful login + MFA, automatically extracts account data from the bank dashboard
- **Account type inference** — Infers checking, savings, credit_card, mortgage, loan, investment, etc. from account names using pattern matching
- **Currency parsing** — Handles $1,234.56, -$500.00, ($1,234.56) accounting notation, and edge cases like $0.00
- **Multiple account support** — Extracts all visible accounts from the dashboard (checking, savings, credit cards, loans, mortgages)
- **Edge case handling** — Zero-balance accounts, missing account numbers, unnamed tiles gracefully handled
- **Declarative selectors** — Chase account page selectors configured in BankConfig (accountsList, accountItem, name, number, balance, type)
- **API endpoint** — `GET /api/sessions/:id/accounts` returns extracted AccountInfo[] after successful login

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
│   └── validation.ts  # Config validation with field-level errors
├── auth/        # Authentication logic with state machine
├── browser/     # Abstract BrowserDriver interface
├── core/        # Embedded WebView engine + MessageBridge
├── extractors/  # Data extraction from bank DOM (accounts, transactions)
├── sdk/         # High-level SDK types for host app integration
├── types/       # Core domain types (Account, Transaction, BankAdapter, Config, LinkSession)
└── ui/          # UI components
    ├── BankSelector.ts  # Searchable bank list controller
    ├── ConduitPreview.ts # React component factory for preview
    └── preview/  # Visual browser preview (CDT-4): controller, transitions, masking
```

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
