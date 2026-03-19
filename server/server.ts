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
    // Chase is an SPA (single-spa micro-frontend) — NO iframe.
    // The login form is rendered client-side after the JS bundle boots.
    selectors: {
      // Multiple fallback selectors — Chase changes IDs across deploys
      usernameInput: '#userId-input-field-input, #userId-text-input-field, input[id*="userId"], input[name="userId"]',
      passwordInput: '#password-input-field-input, #password-text-input-field, input[id*="password"][type="password"], input[name="password"]',
      submitButton: '#signin-button, #submitButton, button[id*="signin"], button[type="submit"]',
      errorMessage: '.error-message, .alert-error, [data-testid="error-message"], .logon-error, .generic-error',
      mfaCodeInput: '#otpcode_input-input-field, #otpcode-input-field, input[id*="otpcode"], input[name="otpcode"]',
      mfaSubmitButton: '#log_on_to_landing_page-next, button[id*="next"], button[type="submit"]',
      successIndicator: '.accounts-container, #accountTileList, .dashboard-container, .account-tile, [data-testid="account-tile"]',
      accountsList: '#accountTileList',
    },
    typeDelay: 50,
    postSubmitWait: 5000,
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
      headless: 'shell',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--window-size=1280,800',
        '--disable-blink-features=AutomationControlled',
        '--disable-features=IsolateOrigins,site-per-process',
        '--disable-web-security',
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

// ─── DOM Probing (find login inputs dynamically) ────────────────────

/**
 * When known selectors don't match, probe the live DOM for likely login
 * inputs and return the selectors that actually exist on the page.
 */
async function probeForLoginInputs(
  page: Page,
  session: BankSession,
): Promise<{ username: string; password: string; submit: string } | null> {
  updateCaption(session, 'Probing page for login inputs...');
  try {
    const result = await page.evaluate(() => {
      // Gather info about all inputs on the page
      const inputs = Array.from(document.querySelectorAll('input'));
      const inputInfo = inputs.map((el) => ({
        id: el.id,
        name: el.name,
        type: el.type,
        placeholder: el.placeholder,
        ariaLabel: el.getAttribute('aria-label') || '',
        classes: el.className,
        visible: el.offsetParent !== null,
      }));

      // Look for username-like input (text/email, visible)
      const userInput = inputs.find(
        (el) =>
          el.offsetParent !== null &&
          (el.type === 'text' || el.type === 'email' || el.type === '') &&
          (el.id.toLowerCase().includes('user') ||
            el.name.toLowerCase().includes('user') ||
            el.placeholder.toLowerCase().includes('user') ||
            el.getAttribute('aria-label')?.toLowerCase().includes('user') ||
            el.id.toLowerCase().includes('login') ||
            el.name.toLowerCase().includes('login')),
      );

      // Look for password input (visible)
      const passInput = inputs.find(
        (el) => el.offsetParent !== null && el.type === 'password',
      );

      // Look for submit button
      const buttons = Array.from(document.querySelectorAll('button, input[type="submit"]'));
      const submitBtn = buttons.find(
        (el) =>
          el.offsetParent !== null &&
          (el.id.toLowerCase().includes('sign') ||
            el.id.toLowerCase().includes('submit') ||
            el.id.toLowerCase().includes('login') ||
            el.textContent?.toLowerCase().includes('sign in') ||
            el.textContent?.toLowerCase().includes('log in') ||
            el.textContent?.toLowerCase().includes('submit')),
      );

      return {
        inputInfo,
        buttonInfo: buttons.map((el) => ({
          id: el.id,
          text: el.textContent?.trim().substring(0, 50),
          type: (el as HTMLButtonElement).type,
          visible: el.offsetParent !== null,
        })),
        foundUser: userInput
          ? userInput.id
            ? `#${userInput.id}`
            : `input[name="${userInput.name}"]`
          : null,
        foundPass: passInput
          ? passInput.id
            ? `#${passInput.id}`
            : `input[type="password"]`
          : null,
        foundSubmit: submitBtn
          ? submitBtn.id
            ? `#${submitBtn.id}`
            : null
          : null,
        title: document.title,
        url: window.location.href,
      };
    });

    // Emit diagnostic info so we can see it in SSE events
    emitEvent(session, {
      type: 'dom_probe',
      timestamp: Date.now(),
      title: result.title,
      url: result.url,
      inputCount: result.inputInfo.length,
      inputs: result.inputInfo.slice(0, 10),
      buttons: result.buttonInfo.slice(0, 10),
      foundUser: result.foundUser,
      foundPass: result.foundPass,
      foundSubmit: result.foundSubmit,
    });

    if (result.foundUser && result.foundPass) {
      return {
        username: result.foundUser,
        password: result.foundPass,
        submit: result.foundSubmit || 'button[type="submit"]',
      };
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Also check iframes on the page — some banks DO use them.
 * Returns the Frame + selectors if found inside an iframe.
 */
async function probeFramesForLoginInputs(
  page: Page,
  session: BankSession,
): Promise<{ frame: Frame; username: string; password: string; submit: string } | null> {
  const frames = page.frames();
  updateCaption(session, `Checking ${frames.length} frames for login form...`);

  for (const frame of frames) {
    if (frame === page.mainFrame()) continue;
    try {
      const result = await frame.evaluate(() => {
        const userInput = document.querySelector(
          'input[type="text"], input[type="email"], input[id*="user"], input[name*="user"]',
        ) as HTMLInputElement | null;
        const passInput = document.querySelector(
          'input[type="password"]',
        ) as HTMLInputElement | null;
        if (!userInput || !passInput) return null;

        const submitBtn = document.querySelector(
          'button[type="submit"], button[id*="sign"], button[id*="submit"], input[type="submit"]',
        ) as HTMLElement | null;

        return {
          foundUser: userInput.id ? `#${userInput.id}` : 'input[type="text"], input[type="email"]',
          foundPass: passInput.id ? `#${passInput.id}` : 'input[type="password"]',
          foundSubmit: submitBtn?.id ? `#${submitBtn.id}` : 'button[type="submit"]',
        };
      });

      if (result) {
        emitEvent(session, {
          type: 'dom_probe_frame',
          timestamp: Date.now(),
          frameUrl: frame.url(),
          foundUser: result.foundUser,
          foundPass: result.foundPass,
          foundSubmit: result.foundSubmit,
        });
        return {
          frame,
          username: result.foundUser,
          password: result.foundPass,
          submit: result.foundSubmit,
        };
      }
    } catch {
      // Frame may be cross-origin or not ready
    }
  }
  return null;
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
      window.chrome = { runtime: {}, loadTimes: function () {}, csi: function () {} };
      // Hide automation-related properties
      const originalQuery = window.navigator.permissions.query;
      // @ts-ignore
      window.navigator.permissions.query = (parameters: any) =>
        parameters.name === 'notifications'
          ? Promise.resolve({ state: Notification.permission } as PermissionStatus)
          : originalQuery(parameters);
    });

    // ── Navigate to login page ──
    session.status = 'navigating';
    updateCaption(session, `Connecting to ${config.name}...`);
    emitEvent(session, { type: 'status', timestamp: Date.now(), status: 'navigating' });

    await page.goto(config.loginUrl, { waitUntil: 'networkidle2', timeout: 45000 });
    await takeScreenshot(session);

    // ── Wait for login form ──
    // Banks using SPA frameworks (Chase uses single-spa) render the login form
    // asynchronously after the JS bundle boots. We need to wait longer and be
    // smarter about finding the form.
    session.status = 'login_page';
    updateCaption(session, 'Waiting for login form to render...');
    emitEvent(session, { type: 'status', timestamp: Date.now(), status: 'login_page' });

    // Strategy: try known selectors first, then probe DOM, then check iframes
    let loginTarget: Page | Frame = page;
    let usernameSelector = config.selectors.usernameInput;
    let passwordSelector = config.selectors.passwordInput;
    let submitSelector = config.selectors.submitButton;
    let formFound = false;

    // Attempt 1: Wait for known selectors (with generous timeout for SPA boot)
    updateCaption(session, 'Looking for login form with known selectors...');
    try {
      // Use a function that tries each selector in the comma-separated list
      await page.waitForFunction(
        (selectorList: string) => {
          const selectors = selectorList.split(',').map((s) => s.trim());
          return selectors.some((s) => document.querySelector(s) !== null);
        },
        { timeout: 25000 },
        config.selectors.usernameInput,
      );
      formFound = true;

      // Figure out which specific selector matched
      const matchedSelector = await page.evaluate((selectorList: string) => {
        const selectors = selectorList.split(',').map((s) => s.trim());
        return selectors.find((s) => document.querySelector(s) !== null) || null;
      }, config.selectors.usernameInput);

      if (matchedSelector) {
        usernameSelector = matchedSelector;
        emitEvent(session, {
          type: 'selector_matched',
          timestamp: Date.now(),
          field: 'username',
          selector: matchedSelector,
        });
      }

      // Also resolve the password selector
      const matchedPassSelector = await page.evaluate((selectorList: string) => {
        const selectors = selectorList.split(',').map((s) => s.trim());
        return selectors.find((s) => document.querySelector(s) !== null) || null;
      }, config.selectors.passwordInput);

      if (matchedPassSelector) {
        passwordSelector = matchedPassSelector;
      }

      // And the submit button
      const matchedSubmitSelector = await page.evaluate((selectorList: string) => {
        const selectors = selectorList.split(',').map((s) => s.trim());
        return selectors.find((s) => document.querySelector(s) !== null) || null;
      }, config.selectors.submitButton);

      if (matchedSubmitSelector) {
        submitSelector = matchedSubmitSelector;
      }
    } catch {
      // Known selectors didn't match — try probing
    }

    // Attempt 2: Probe the DOM for any login-like inputs
    if (!formFound) {
      updateCaption(session, 'Known selectors missed — probing DOM for login inputs...');
      await takeScreenshot(session);

      const probeResult = await probeForLoginInputs(page, session);
      if (probeResult) {
        usernameSelector = probeResult.username;
        passwordSelector = probeResult.password;
        submitSelector = probeResult.submit;
        formFound = true;
        updateCaption(session, `Found login form via DOM probe: ${usernameSelector}`);
      }
    }

    // Attempt 3: Check iframes (some banks DO use them)
    if (!formFound) {
      updateCaption(session, 'Checking iframes for login form...');
      const frameResult = await probeFramesForLoginInputs(page, session);
      if (frameResult) {
        loginTarget = frameResult.frame;
        usernameSelector = frameResult.username;
        passwordSelector = frameResult.password;
        submitSelector = frameResult.submit;
        formFound = true;
        updateCaption(session, `Found login form in iframe: ${usernameSelector}`);
      }
    }

    // Attempt 4: One more wait — maybe the SPA is still booting
    if (!formFound) {
      updateCaption(session, 'Waiting longer for SPA to finish loading...');
      await new Promise((r) => setTimeout(r, 10000));
      await takeScreenshot(session);

      const probeResult2 = await probeForLoginInputs(page, session);
      if (probeResult2) {
        usernameSelector = probeResult2.username;
        passwordSelector = probeResult2.password;
        submitSelector = probeResult2.submit;
        formFound = true;
      }
    }

    if (!formFound) {
      // Capture diagnostic info before failing
      const pageInfo = await page.evaluate(() => ({
        title: document.title,
        url: window.location.href,
        bodyText: document.body?.innerText?.substring(0, 500) || '',
        inputCount: document.querySelectorAll('input').length,
        iframeCount: document.querySelectorAll('iframe').length,
      }));

      session.status = 'failed';
      session.error = `Login form not found — page title: "${pageInfo.title}", URL: ${pageInfo.url}, inputs: ${pageInfo.inputCount}, iframes: ${pageInfo.iframeCount}`;
      updateCaption(session, session.error);
      emitEvent(session, {
        type: 'error',
        timestamp: Date.now(),
        error: session.error,
        diagnostics: pageInfo,
      });
      await takeScreenshot(session);
      return;
    }

    await takeScreenshot(session);
    emitEvent(session, {
      type: 'form_found',
      timestamp: Date.now(),
      usernameSelector,
      passwordSelector,
      submitSelector,
      inIframe: loginTarget !== page,
    });

    // ── Fill credentials ──
    session.status = 'submitting';
    updateCaption(session, 'Entering username...');

    // Clear and type username — use evaluate to clear first for robustness
    const userEl = await loginTarget.$(usernameSelector);
    if (userEl) {
      await userEl.click({ clickCount: 3 });
      await userEl.type(credentials.username, { delay: config.typeDelay ?? 50 });
    } else {
      await loginTarget.click(usernameSelector, { clickCount: 3 });
      await loginTarget.type(usernameSelector, credentials.username, {
        delay: config.typeDelay ?? 50,
      });
    }

    updateCaption(session, 'Entering password...');
    const passEl = await loginTarget.$(passwordSelector);
    if (passEl) {
      await passEl.click({ clickCount: 3 });
      await passEl.type(credentials.password, { delay: config.typeDelay ?? 50 });
    } else {
      await loginTarget.click(passwordSelector, { clickCount: 3 });
      await loginTarget.type(passwordSelector, credentials.password, {
        delay: config.typeDelay ?? 50,
      });
    }

    await takeScreenshot(session);
    updateCaption(session, 'Submitting credentials...');

    // ── Click submit ──
    const submitEl = await loginTarget.$(submitSelector);
    if (submitEl) {
      await submitEl.click();
    } else {
      await loginTarget.click(submitSelector);
    }
    emitEvent(session, { type: 'status', timestamp: Date.now(), status: 'submitting' });

    // Wait for page to respond
    await new Promise((r) => setTimeout(r, config.postSubmitWait ?? 3000));
    await takeScreenshot(session);

    // ── Detect outcome ──
    // After login, the page may navigate — check both
    // the main page and the login target (if in an iframe) for outcome indicators.
    const outcomeResult = await detectOutcome(session, config, page, loginTarget);

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

      // Submit MFA
      session.status = 'submitting';
      updateCaption(session, 'Submitting verification code...');

      const mfaInput = config.selectors.mfaCodeInput;
      // Try the main page first for MFA (post-login often switches away from iframes)
      const mfaTarget = page;
      if (mfaInput) {
        try {
          await mfaTarget.waitForSelector(mfaInput.split(',')[0].trim(), { timeout: 5000 });
        } catch {
          // MFA input might be in loginTarget if different
        }
        await mfaTarget.click(mfaInput, { clickCount: 3 }).catch(() => {});
        await mfaTarget.type(mfaInput, mfaResponse.code ?? mfaResponse.answer ?? '', {
          delay: config.typeDelay ?? 50,
        });
      }
      if (config.selectors.mfaSubmitButton) {
        await mfaTarget.click(config.selectors.mfaSubmitButton).catch(() => {});
      }

      await new Promise((r) => setTimeout(r, config.postSubmitWait ?? 3000));
      await takeScreenshot(session);

      const postMfaResult = await detectOutcome(session, config, page, loginTarget);
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
  loginTarget?: Page | Frame,
): Promise<'success' | 'mfa' | 'failed'> {
  // Check both the main page and login target (if different) for selectors
  const targets: Array<Page | Frame> = [page];
  if (loginTarget && loginTarget !== page) targets.push(loginTarget);

  // For comma-separated selectors, try each individual selector
  function checkSelector(selectorList: string, label: string) {
    const selectors = selectorList.split(',').map((s) => s.trim());
    const attempts = targets.flatMap((t) =>
      selectors.map((s) =>
        t.waitForSelector(s, { timeout: 5000 }).then(() => label),
      ),
    );
    return Promise.any(attempts).catch(() => null);
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
