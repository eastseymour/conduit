/**
 * Conduit Live Testing Server
 *
 * A local Express server that wraps Puppeteer to provide real browser
 * automation for bank login testing. The web demo calls this server's
 * REST + SSE endpoints to drive live bank sessions.
 *
 * ⚠️  FOR LOCAL DEVELOPMENT/TESTING ONLY — never deploy to production.
 *     Credentials are passed transiently and never stored.
 *
 * Endpoints:
 *   POST /api/sessions          — Start a new bank login session
 *   POST /api/sessions/:id/mfa  — Submit MFA response
 *   POST /api/sessions/:id/cancel — Cancel a session
 *   GET  /api/sessions/:id/events — SSE stream of session events
 *   GET  /api/sessions/:id/screenshot — Current page screenshot
 *   GET  /api/health             — Health check
 */

import express from 'express';
import cors from 'cors';
import path from 'path';
import { randomUUID } from 'crypto';
import puppeteer, { type Browser, type Page, type Frame } from 'puppeteer';

// ─── Types ──────────────────────────────────────────────────────────

interface SessionEvent {
  type: string;
  timestamp: number;
  [key: string]: unknown;
}

interface BankSession {
  id: string;
  bankId: string;
  status: 'navigating' | 'login_page' | 'submitting' | 'mfa_required' | 'success' | 'failed' | 'cancelled';
  page: Page | null;
  events: SessionEvent[];
  listeners: Set<express.Response>;
  mfaResolver: ((value: { code?: string; answer?: string } | null) => void) | null;
  screenshot: Buffer | null;
  caption: string;
  error: string | null;
}

// ─── Bank Configs (CSS selectors for real bank pages) ───────────────

interface BankConfig {
  bankId: string;
  name: string;
  loginUrl: string;
  /** If the login form is inside an iframe, CSS selector to find it. */
  loginIframeSelector?: string;
  selectors: {
    usernameInput: string;
    passwordInput: string;
    submitButton: string;
    errorMessage: string;
    mfaCodeInput?: string;
    mfaSubmitButton?: string;
    successIndicator: string;
    accountsList?: string;
  };
  /** Delay ms after typing each character (some banks need it slow). */
  typeDelay?: number;
  /** Wait ms after clicking submit before checking outcome. */
  postSubmitWait?: number;
}

const BANK_CONFIGS: Record<string, BankConfig> = {
  chase: {
    bankId: 'chase',
    name: 'Chase',
    loginUrl: 'https://secure.chase.com/web/auth/dashboard#/logon/existing',
    /** Chase renders the login form inside an iframe — automation must target that frame. */
    loginIframeSelector: 'iframe[src*="/web/auth/"]',
    selectors: {
      usernameInput: '#userId-input-field-input',
      passwordInput: '#password-input-field-input',
      submitButton: '#signin-button',
      errorMessage: '.error-message, .alert-error, [data-testid="error-message"]',
      mfaCodeInput: '#otpcode_input-input-field',
      mfaSubmitButton: '#log_on_to_landing_page-next',
      successIndicator: '.accounts-container, #accountTileList, .dashboard-container',
      accountsList: '#accountTileList',
    },
    typeDelay: 50,
    postSubmitWait: 3000,
  },
  bofa: {
    bankId: 'bofa',
    name: 'Bank of America',
    loginUrl: 'https://www.bankofamerica.com/login/sign-in/signOnV2Screen.go',
    selectors: {
      usernameInput: '#enterID-input',
      passwordInput: '#tlpvt-passcode-input',
      submitButton: '#enterID-submitButton, #signIn',
      errorMessage: '.error-message, .alert-error',
      mfaCodeInput: '#tlpvt-challenge-answer',
      mfaSubmitButton: '#verify-cq-submit',
      successIndicator: '.AccountItemTotal, .balances-overview',
      accountsList: '.AccountItemTotal',
    },
    typeDelay: 30,
    postSubmitWait: 4000,
  },
  wellsfargo: {
    bankId: 'wellsfargo',
    name: 'Wells Fargo',
    loginUrl: 'https://connect.secure.wellsfargo.com/auth/login/present',
    selectors: {
      usernameInput: '#j_username',
      passwordInput: '#j_password',
      submitButton: '#btnSignon',
      errorMessage: '.error-message, .alert-error',
      mfaCodeInput: '#challengeAnswer, input[name="answer"]',
      mfaSubmitButton: '#btnContinue',
      successIndicator: '.account-summary, .balances-container',
      accountsList: '.account-summary',
    },
    typeDelay: 30,
    postSubmitWait: 3000,
  },
};

// ─── Session Store ──────────────────────────────────────────────────

const sessions = new Map<string, BankSession>();

// ─── Puppeteer Browser ──────────────────────────────────────────────

let browser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browser || !browser.connected) {
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--window-size=1280,800',
        '--disable-blink-features=AutomationControlled',
      ],
    });
  }
  return browser;
}

// ─── Session Helpers ────────────────────────────────────────────────

function emitEvent(session: BankSession, event: SessionEvent): void {
  session.events.push(event);
  const data = JSON.stringify(event);
  for (const res of session.listeners) {
    try {
      res.write(`data: ${data}\n\n`);
    } catch {
      session.listeners.delete(res);
    }
  }
}

function updateCaption(session: BankSession, caption: string): void {
  session.caption = caption;
  emitEvent(session, { type: 'caption', timestamp: Date.now(), caption });
}

async function takeScreenshot(session: BankSession): Promise<void> {
  if (!session.page || session.page.isClosed()) return;
  try {
    session.screenshot = Buffer.from(await session.page.screenshot({ type: 'jpeg', quality: 60 }));
    emitEvent(session, { type: 'screenshot_ready', timestamp: Date.now() });
  } catch {
    // Page may have been closed
  }
}

// ─── Core Automation ────────────────────────────────────────────────

async function runBankSession(
  session: BankSession,
  credentials: { username: string; password: string },
): Promise<void> {
  const config = BANK_CONFIGS[session.bankId];
  if (!config) {
    session.status = 'failed';
    session.error = `No configuration for bank "${session.bankId}"`;
    emitEvent(session, { type: 'error', timestamp: Date.now(), error: session.error });
    return;
  }

  try {
    const b = await getBrowser();
    const page = await b.newPage();
    session.page = page;

    await page.setViewport({ width: 1280, height: 800 });

    // The default UA contains "HeadlessChrome/146..." which banks detect and block.
    // Replace it with a normal-looking Chrome UA that keeps the real version number
    // so it passes both UA-string checks and JS API version checks.
    const realUA = await b.userAgent();
    const cleanUA = realUA
      .replace('HeadlessChrome/', 'Chrome/')
      .replace(/X11; Linux x86_64/, 'Macintosh; Intel Mac OS X 10_15_7');
    await page.setUserAgent(cleanUA);

    // Anti-detection: remove webdriver flag and patch navigator
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      // Spoof plugins (headless Chrome reports none)
      Object.defineProperty(navigator, 'plugins', {
        get: () => [1, 2, 3, 4, 5],
      });
      // Spoof languages
      Object.defineProperty(navigator, 'languages', {
        get: () => ['en-US', 'en'],
      });
      // Patch the Chrome runtime to look like a normal browser
      // @ts-ignore
      window.chrome = { runtime: {}, loadTimes: function() {}, csi: function() {} };
    });

    // ── Navigate to login page ──
    session.status = 'navigating';
    updateCaption(session, `Connecting to ${config.name}...`);
    emitEvent(session, { type: 'status', timestamp: Date.now(), status: 'navigating' });

    await page.goto(config.loginUrl, { waitUntil: 'networkidle2', timeout: 30000 });
    await takeScreenshot(session);

    // ── Wait for login form (may be in an iframe) ──
    session.status = 'login_page';
    updateCaption(session, 'Login page loaded, looking for login form...');
    emitEvent(session, { type: 'status', timestamp: Date.now(), status: 'login_page' });

    // If the bank uses an iframe for the login form, find it
    let loginFrame: Page | Frame = page;
    if (config.loginIframeSelector) {
      updateCaption(session, 'Waiting for login iframe...');
      try {
        await page.waitForSelector(config.loginIframeSelector, { timeout: 15000 });
        const iframeHandle = await page.$(config.loginIframeSelector);
        if (iframeHandle) {
          const frame = await iframeHandle.contentFrame();
          if (frame) {
            loginFrame = frame as any;
            // Wait for iframe content to load
            await new Promise((r) => setTimeout(r, 3000));
          }
        }
      } catch {
        // Fall through to try the main page
      }
    }

    try {
      await loginFrame.waitForSelector(config.selectors.usernameInput, { timeout: 15000 });
    } catch {
      session.status = 'failed';
      session.error = 'Login form did not appear — page may have changed or be blocked';
      updateCaption(session, session.error);
      emitEvent(session, { type: 'error', timestamp: Date.now(), error: session.error });
      await takeScreenshot(session);
      return;
    }

    await takeScreenshot(session);

    // ── Fill credentials ──
    session.status = 'submitting';
    updateCaption(session, 'Entering username...');

    // Clear and type username
    await loginFrame.click(config.selectors.usernameInput, { clickCount: 3 });
    await loginFrame.type(config.selectors.usernameInput, credentials.username, {
      delay: config.typeDelay ?? 50,
    });

    updateCaption(session, 'Entering password...');
    await loginFrame.click(config.selectors.passwordInput, { clickCount: 3 });
    await loginFrame.type(config.selectors.passwordInput, credentials.password, {
      delay: config.typeDelay ?? 50,
    });

    await takeScreenshot(session);
    updateCaption(session, 'Submitting credentials...');

    // ── Click submit ──
    await loginFrame.click(config.selectors.submitButton);
    emitEvent(session, { type: 'status', timestamp: Date.now(), status: 'submitting' });

    // Wait for page to respond
    await new Promise((r) => setTimeout(r, config.postSubmitWait ?? 3000));
    await takeScreenshot(session);

    // ── Detect outcome ──
    // After login, the page may navigate away from the iframe — check both
    // the main page and the login frame for outcome indicators.
    const outcomeResult = await detectOutcome(session, config, page, loginFrame);

    if (outcomeResult === 'mfa') {
      session.status = 'mfa_required';
      updateCaption(session, 'Multi-factor authentication required...');
      emitEvent(session, {
        type: 'mfa_required',
        timestamp: Date.now(),
        challengeType: 'code',
      });

      // Wait for MFA response from the client
      const mfaResponse = await new Promise<{ code?: string; answer?: string } | null>(
        (resolve) => {
          session.mfaResolver = resolve;
          // Auto-timeout after 5 minutes
          setTimeout(() => resolve(null), 5 * 60 * 1000);
        },
      );

      if (!mfaResponse) {
        session.status = 'cancelled';
        updateCaption(session, 'MFA cancelled or timed out');
        emitEvent(session, { type: 'status', timestamp: Date.now(), status: 'cancelled' });
        return;
      }

      // Submit MFA — try loginFrame first, fall back to page
      session.status = 'submitting';
      updateCaption(session, 'Submitting verification code...');

      const mfaInput = config.selectors.mfaCodeInput;
      const mfaTarget = loginFrame;
      if (mfaInput) {
        await mfaTarget.click(mfaInput, { clickCount: 3 });
        await mfaTarget.type(mfaInput, mfaResponse.code ?? mfaResponse.answer ?? '', {
          delay: config.typeDelay ?? 50,
        });
      }
      if (config.selectors.mfaSubmitButton) {
        await mfaTarget.click(config.selectors.mfaSubmitButton);
      }

      await new Promise((r) => setTimeout(r, config.postSubmitWait ?? 3000));
      await takeScreenshot(session);

      const postMfaResult = await detectOutcome(session, config, page, loginFrame);
      if (postMfaResult === 'success') {
        session.status = 'success';
        updateCaption(session, 'Successfully connected!');
        emitEvent(session, { type: 'status', timestamp: Date.now(), status: 'success' });
      } else {
        session.status = 'failed';
        session.error = 'Authentication failed after MFA';
        updateCaption(session, session.error);
        emitEvent(session, { type: 'error', timestamp: Date.now(), error: session.error });
      }
    } else if (outcomeResult === 'success') {
      session.status = 'success';
      updateCaption(session, 'Successfully connected!');
      emitEvent(session, { type: 'status', timestamp: Date.now(), status: 'success' });
    } else {
      // Failed
      session.status = 'failed';
      const errorText = await extractErrorText(page, config);
      session.error = errorText || 'Authentication failed';
      updateCaption(session, session.error);
      emitEvent(session, { type: 'error', timestamp: Date.now(), error: session.error });
    }

    await takeScreenshot(session);
    emitEvent(session, { type: 'complete', timestamp: Date.now(), status: session.status });
  } catch (err) {
    session.status = 'failed';
    session.error = err instanceof Error ? err.message : String(err);
    updateCaption(session, `Error: ${session.error}`);
    emitEvent(session, { type: 'error', timestamp: Date.now(), error: session.error });
    await takeScreenshot(session);
  }
}

async function detectOutcome(
  session: BankSession,
  config: BankConfig,
  page: Page,
  loginFrame?: Page | Frame,
): Promise<'success' | 'mfa' | 'failed'> {
  // Check both the main page and login frame (if different) for selectors
  const targets: Array<Page | Frame> = [page];
  if (loginFrame && loginFrame !== page) targets.push(loginFrame);

  function checkSelector(selector: string, label: string) {
    return Promise.any(
      targets.map((t) =>
        t.waitForSelector(selector, { timeout: 3000 }).then(() => label),
      ),
    ).catch(() => null);
  }

  const checks = [
    checkSelector(config.selectors.successIndicator, 'success'),
    config.selectors.mfaCodeInput
      ? checkSelector(config.selectors.mfaCodeInput, 'mfa')
      : Promise.resolve(null),
    checkSelector(config.selectors.errorMessage, 'failed'),
  ];

  const results = await Promise.all(checks);
  // Priority: success > mfa > failed > default failed
  if (results[0] === 'success') return 'success';
  if (results[1] === 'mfa') return 'mfa';
  if (results[2] === 'failed') return 'failed';
  return 'failed';
}

async function extractErrorText(page: Page, config: BankConfig): Promise<string> {
  try {
    const el = await page.$(config.selectors.errorMessage);
    if (el) {
      const text = await page.evaluate((e) => e.textContent, el);
      return text?.trim() || 'Login failed';
    }
  } catch {
    // best-effort
  }
  return 'Login failed';
}

// ─── Express App ────────────────────────────────────────────────────

const app = express();
app.use(cors());
app.use(express.json());

// ── Serve the built demo (same-origin avoids HTTPS mixed-content issues) ──
// The Vite build uses base: '/conduit/' for GitHub Pages, so we mount at both
// '/' and '/conduit/' to support both environments.
const DEMO_DIR = path.resolve(__dirname, '..', 'example', 'dist');
app.use('/conduit', express.static(DEMO_DIR));
app.use(express.static(DEMO_DIR));

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', sessions: sessions.size, banks: Object.keys(BANK_CONFIGS) });
});

// List available banks
app.get('/api/banks', (_req, res) => {
  const banks = Object.values(BANK_CONFIGS).map((c) => ({
    bankId: c.bankId,
    name: c.name,
    loginUrl: c.loginUrl,
  }));
  res.json({ banks });
});

// Start a new session
app.post('/api/sessions', (req, res) => {
  const { bankId, username, password } = req.body as {
    bankId: string;
    username: string;
    password: string;
  };

  if (!bankId || !username || !password) {
    return res.status(400).json({ error: 'bankId, username, and password are required' });
  }

  if (!BANK_CONFIGS[bankId]) {
    return res.status(400).json({ error: `Unknown bank: ${bankId}`, availableBanks: Object.keys(BANK_CONFIGS) });
  }

  const session: BankSession = {
    id: randomUUID(),
    bankId,
    status: 'navigating',
    page: null,
    events: [],
    listeners: new Set(),
    mfaResolver: null,
    screenshot: null,
    caption: 'Starting...',
    error: null,
  };

  sessions.set(session.id, session);

  // Start automation in background
  runBankSession(session, { username, password }).finally(async () => {
    // Clean up page after session ends (keep session data for 5 min)
    if (session.page && !session.page.isClosed()) {
      await session.page.close().catch(() => {});
      session.page = null;
    }
    setTimeout(() => sessions.delete(session.id), 5 * 60 * 1000);
  });

  return res.status(201).json({ sessionId: session.id, bankId, status: session.status });
});

// SSE event stream
app.get('/api/sessions/:id/events', (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  // Send all historical events first
  for (const event of session.events) {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  }

  session.listeners.add(res);

  req.on('close', () => {
    session.listeners.delete(res);
  });
});

// Submit MFA response
app.post('/api/sessions/:id/mfa', (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  if (!session.mfaResolver) {
    return res.status(400).json({ error: 'No MFA challenge pending for this session' });
  }

  const { code, answer } = req.body as { code?: string; answer?: string };
  session.mfaResolver({ code, answer });
  session.mfaResolver = null;

  return res.json({ status: 'submitted' });
});

// Cancel session
app.post('/api/sessions/:id/cancel', async (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  session.status = 'cancelled';
  if (session.mfaResolver) {
    session.mfaResolver(null);
    session.mfaResolver = null;
  }
  if (session.page && !session.page.isClosed()) {
    await session.page.close().catch(() => {});
    session.page = null;
  }

  emitEvent(session, { type: 'status', timestamp: Date.now(), status: 'cancelled' });
  return res.json({ status: 'cancelled' });
});

// Get current screenshot
app.get('/api/sessions/:id/screenshot', (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  if (!session.screenshot) {
    return res.status(204).send();
  }

  res.writeHead(200, {
    'Content-Type': 'image/jpeg',
    'Content-Length': session.screenshot.length,
    'Cache-Control': 'no-cache',
  });
  return res.end(session.screenshot);
});

// Get session status
app.get('/api/sessions/:id', (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  res.json({
    id: session.id,
    bankId: session.bankId,
    status: session.status,
    caption: session.caption,
    error: session.error,
    eventCount: session.events.length,
  });
});

// ── Root redirect to /conduit/ (matches Vite base path) ──
app.get('/', (_req, res) => {
  res.redirect('/conduit/');
});

// ── SPA fallback — serve index.html for any non-API GET ──
app.get('*', (_req, res) => {
  res.sendFile(path.join(DEMO_DIR, 'index.html'));
});

// ─── Start ──────────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT ?? '3001', 10);

app.listen(PORT, () => {
  console.log(`\n🏦 Conduit Live Testing Server`);
  console.log(`   http://localhost:${PORT}`);
  console.log(`\n   Available banks: ${Object.values(BANK_CONFIGS).map((b) => b.name).join(', ')}`);
  console.log(`\n   Endpoints:`);
  console.log(`     POST /api/sessions          — Start bank login session`);
  console.log(`     GET  /api/sessions/:id/events — SSE event stream`);
  console.log(`     POST /api/sessions/:id/mfa  — Submit MFA code`);
  console.log(`     GET  /api/sessions/:id/screenshot — Current page screenshot`);
  console.log(`     GET  /api/health             — Health check`);
  console.log(`\n   ⚠️  LOCAL DEVELOPMENT ONLY — never expose to the internet\n`);
});

// Cleanup on exit
process.on('SIGINT', async () => {
  console.log('\nShutting down...');
  if (browser) await browser.close();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  if (browser) await browser.close();
  process.exit(0);
});
