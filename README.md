# Conduit SDK

Plaid competitor — an Expo SDK that runs an embedded browser to log into banking sites, extract account data (accounts, routing/account numbers, transactions), and shows a live minimized visual preview of the browser with status captions explaining each step.

## Features

### Bank Authentication (CDT-3)
- **Credential submission** — Accept username/password via SDK API, navigate to bank login, fill & submit
- **MFA handling** — Detect and handle SMS codes, email codes, security questions, and push notifications
- **Host app integration** — Surface MFA prompts via callbacks/events, accept MFA input from host app
- **Login outcome detection** — Distinguish between successful login, failed login, and account locked
- **Session persistence** — Handle "remember this device" prompts
- **State events** — Emit typed events throughout: `logging_in`, `mfa_required`, `mfa_submitting`, `authenticated`, `auth_failed`
- **Safety** — Timeout protection, max MFA retry limits, automatic browser cleanup

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

## Architecture

The SDK follows a **port/adapter pattern**:

- **Auth Module** (`src/auth/`) — Core authentication logic with state machine
- **Browser Interface** (`src/browser/`) — Abstract `BrowserDriver` interface
- **Concrete Drivers** — Platform-specific implementations (Puppeteer, Playwright, Expo WebView)

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
