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
    /** Selector(s) for MFA method selection / device verification pages
     *  (e.g. "Choose one" dropdown before OTP input appears). */
    mfaChallengePage?: string;
    /** Selector for the MFA method dropdown/select element */
    mfaMethodSelect?: string;
    /** Selector for the "Next" button on the MFA method selection page */
    mfaMethodNextButton?: string;
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
      // Chase shows a "We don't recognize this device" / "Get verified" page
      // with a method selection dropdown BEFORE the OTP code input appears.
      mfaChallengePage: '#header-simplerAuth-702, [class*="verify"], [class*="challenge"], select[id*="otpMethod"], select[id*="delivery"], [data-testid*="verify"]',
      mfaMethodSelect: '#otpMethod, #selectbox-container select, select[id*="delivery"], select[name*="delivery"]',
      mfaMethodNextButton: '#requestIdentificationCode-sm, button[id*="next"], #Next',
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
      // `true` = new headless mode (Chrome for Testing) — less detectable than 'shell'
      headless: true,
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
 * This version:
 * - Traverses shadow DOM roots recursively
 * - Uses robust visibility checks (handles position:fixed)
 * - Broader heuristics for username inputs (tel, any text-like input)
 */
async function probeForLoginInputs(
  page: Page,
  session: BankSession,
): Promise<{ username: string; password: string; submit: string } | null> {
  updateCaption(session, 'Probing page for login inputs (including shadow DOM)...');
  try {
    const result = await page.evaluate(() => {
      // ── Visibility check that handles position:fixed ──
      // NOTE: Use arrow/const functions, NOT named function declarations,
      // because tsx/esbuild adds __name() helpers for named functions and
      // that symbol doesn't exist inside page.evaluate().
      const isVisible = (el: Element): boolean => {
        if (!el) return false;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        if (parseFloat(style.opacity) === 0) return false;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) return false;
        return true;
      };

      // ── Recursive shadow DOM walker ──
      const deepQueryAll = (root: Document | ShadowRoot | Element, selector: string): Element[] => {
        const results: Element[] = [];
        try { results.push(...Array.from(root.querySelectorAll(selector))); } catch {}
        const allEls = root.querySelectorAll('*');
        for (const el of allEls) {
          if (el.shadowRoot) {
            try { results.push(...deepQueryAll(el.shadowRoot, selector)); } catch {}
          }
        }
        return results;
      };

      // Count shadow roots for diagnostics
      const countShadowRoots = (root: Document | ShadowRoot | Element): number => {
        let count = 0;
        const allEls = root.querySelectorAll('*');
        for (const el of allEls) {
          if (el.shadowRoot) {
            count++;
            count += countShadowRoots(el.shadowRoot);
          }
        }
        return count;
      };

      const shadowRootCount = countShadowRoots(document);

      // Gather ALL inputs (including inside shadow DOM)
      const inputs = deepQueryAll(document, 'input') as HTMLInputElement[];
      const inputInfo = inputs.map((el) => ({
        id: el.id,
        name: el.name,
        type: el.type,
        placeholder: el.placeholder,
        ariaLabel: el.getAttribute('aria-label') || '',
        classes: el.className,
        visible: isVisible(el),
        inShadowDOM: el.getRootNode() !== document,
        tagName: el.tagName,
        autocomplete: el.getAttribute('autocomplete') || '',
      }));

      // Look for username-like input — broader heuristics:
      // Types: text, email, tel, '' (some banks use tel for user ID)
      // IDs/names/attrs containing: user, login, username, signin, id
      const userInput = inputs.find(
        (el) =>
          isVisible(el) &&
          (el.type === 'text' || el.type === 'email' || el.type === 'tel' || el.type === '') &&
          (el.id.toLowerCase().includes('user') ||
            el.name.toLowerCase().includes('user') ||
            el.placeholder.toLowerCase().includes('user') ||
            el.getAttribute('aria-label')?.toLowerCase().includes('user') ||
            el.id.toLowerCase().includes('login') ||
            el.name.toLowerCase().includes('login') ||
            el.id.toLowerCase().includes('signin') ||
            el.getAttribute('autocomplete')?.includes('username') ||
            // Catch-all: any text-ish input near a password input
            el.id.toLowerCase().includes('id')),
      );

      // Fallback: if no match by name, just take the first visible text-like input
      // (many login forms have only one text input)
      const userInputFallback =
        userInput ||
        inputs.find(
          (el) =>
            isVisible(el) &&
            (el.type === 'text' || el.type === 'email' || el.type === 'tel' || el.type === ''),
        );

      // Look for password input
      const passInput = inputs.find(
        (el) => isVisible(el) && el.type === 'password',
      );

      // Look for submit button (also check shadow DOM)
      const buttons = deepQueryAll(document, 'button, input[type="submit"], a[role="button"]') as HTMLElement[];
      const submitBtn = buttons.find(
        (el) =>
          isVisible(el) &&
          (el.id.toLowerCase().includes('sign') ||
            el.id.toLowerCase().includes('submit') ||
            el.id.toLowerCase().includes('login') ||
            el.id.toLowerCase().includes('logon') ||
            el.textContent?.toLowerCase().includes('sign in') ||
            el.textContent?.toLowerCase().includes('log in') ||
            el.textContent?.toLowerCase().includes('log on') ||
            el.textContent?.toLowerCase().includes('submit') ||
            el.getAttribute('aria-label')?.toLowerCase().includes('sign in')),
      );

      // Build a CSS selector for an element
      const selectorFor = (el: Element | null, fallback: string): string | null => {
        if (!el) return null;
        if (el.id) return `#${el.id}`;
        if ((el as HTMLInputElement).name) return `input[name="${(el as HTMLInputElement).name}"]`;
        return fallback;
      };

      const foundUser = selectorFor(userInputFallback || null, 'input[type="text"]');
      const foundPass = selectorFor(passInput || null, 'input[type="password"]');
      const foundSubmit = selectorFor(submitBtn || null, 'button[type="submit"]');

      return {
        inputInfo: inputInfo.slice(0, 20),
        buttonInfo: buttons.slice(0, 15).map((el) => ({
          id: el.id,
          text: el.textContent?.trim().substring(0, 50),
          type: (el as HTMLButtonElement).type || '',
          visible: isVisible(el),
          ariaLabel: el.getAttribute('aria-label') || '',
        })),
        foundUser,
        foundPass,
        foundSubmit,
        title: document.title,
        url: window.location.href,
        shadowRootCount,
        totalInputs: inputs.length,
        totalButtons: buttons.length,
        htmlSnippet: document.body?.innerHTML?.substring(0, 1500) || '',
      };
    });

    // Emit diagnostic info so we can see it in SSE events
    emitEvent(session, {
      type: 'dom_probe',
      timestamp: Date.now(),
      title: result.title,
      url: result.url,
      inputCount: result.totalInputs,
      shadowRootCount: result.shadowRootCount,
      inputs: result.inputInfo,
      buttons: result.buttonInfo,
      foundUser: result.foundUser,
      foundPass: result.foundPass,
      foundSubmit: result.foundSubmit,
      htmlSnippet: result.htmlSnippet.substring(0, 500),
    });

    if (result.foundUser && result.foundPass) {
      return {
        username: result.foundUser,
        password: result.foundPass,
        submit: result.foundSubmit || 'button[type="submit"]',
      };
    }

    // If we found inputs but couldn't match heuristics, log it clearly
    if (result.totalInputs > 0) {
      emitEvent(session, {
        type: 'dom_probe_partial',
        timestamp: Date.now(),
        message: `Found ${result.totalInputs} inputs but couldn't identify login fields`,
        inputs: result.inputInfo,
        shadowRootCount: result.shadowRootCount,
      });
    }

    return null;
  } catch (err) {
    emitEvent(session, {
      type: 'dom_probe_error',
      timestamp: Date.now(),
      error: err instanceof Error ? err.message : String(err),
    });
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
    // Uses waitForFunction with shadow DOM traversal so we find elements
    // even inside web components / shadow roots.
    updateCaption(session, 'Looking for login form with known selectors...');
    try {
      // Use a function that tries each selector AND walks shadow roots
      await page.waitForFunction(
        (selectorList: string) => {
          const selectors = selectorList.split(',').map((s) => s.trim());
          // First try normal querySelector
          if (selectors.some((s) => document.querySelector(s) !== null)) return true;
          // Then traverse shadow roots
          const deepFind = (root: Document | ShadowRoot | Element, sel: string): boolean => {
            try { if (root.querySelector(sel)) return true; } catch { return false; }
            const els = root.querySelectorAll('*');
            for (const el of els) {
              if (el.shadowRoot && deepFind(el.shadowRoot, sel)) return true;
            }
            return false;
          }
          return selectors.some((s) => deepFind(document, s));
        },
        { timeout: 25000 },
        config.selectors.usernameInput,
      );
      formFound = true;

      // Figure out which specific selector matched (including shadow DOM)
      const matchedSelector = await page.evaluate((selectorList: string) => {
        const selectors = selectorList.split(',').map((s) => s.trim());
        // Normal querySelector first
        const normalMatch = selectors.find((s) => document.querySelector(s) !== null);
        if (normalMatch) return normalMatch;
        // Shadow DOM traversal
        function deepFind(root: Document | ShadowRoot | Element, sel: string): boolean {
          try { if (root.querySelector(sel)) return true; } catch { return false; }
          const els = root.querySelectorAll('*');
          for (const el of els) {
            if (el.shadowRoot && deepFind(el.shadowRoot, sel)) return true;
          }
          return false;
        }
        return selectors.find((s) => deepFind(document, s)) || null;
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

    // Attempt 1b: Try Puppeteer's built-in shadow-piercing selectors
    // The `pierce/` prefix and `>>>` combinator traverse shadow DOMs natively
    if (!formFound) {
      updateCaption(session, 'Trying shadow-piercing selectors...');
      const pierceSelectors = [
        'pierce/#userId-input-field-input',
        'pierce/#userId-text-input-field',
        'pierce/input[id*="userId"]',
        'pierce/input[name="userId"]',
        'pierce/input[type="password"]',
      ];
      for (const sel of pierceSelectors) {
        try {
          const el = await page.$(sel);
          if (el) {
            emitEvent(session, {
              type: 'pierce_selector_matched',
              timestamp: Date.now(),
              selector: sel,
            });
            // We found an element via pierce — use pierce selectors for all fields
            usernameSelector = sel.includes('password') ? usernameSelector : sel;
            if (sel.includes('password')) {
              passwordSelector = sel;
            }
            formFound = true;
          }
        } catch {
          // pierce selector not supported or didn't match
        }
      }
      // If we found username via pierce, also find password and submit
      if (formFound) {
        try {
          const passEl = await page.$('pierce/input[type="password"]');
          if (passEl) passwordSelector = 'pierce/input[type="password"]';
        } catch {}
        try {
          const submitEl = await page.$('pierce/#signin-button') || await page.$('pierce/button[id*="signin"]');
          if (submitEl) submitSelector = 'pierce/#signin-button';
        } catch {}
      }
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
      // Capture comprehensive diagnostic info before failing
      const pageInfo = await page.evaluate(() => {
        // Count shadow roots (arrow fn to avoid tsx __name helper)
        const countShadowRoots = (root: Document | Element): number => {
          let count = 0;
          const allEls = root.querySelectorAll('*');
          for (const el of allEls) {
            if (el.shadowRoot) {
              count++;
              count += countShadowRoots(el.shadowRoot);
            }
          }
          return count;
        };
        // Deep count inputs (including shadow DOM)
        const deepCount = (root: Document | ShadowRoot | Element, sel: string): number => {
          let count = 0;
          try { count += root.querySelectorAll(sel).length; } catch {}
          const els = root.querySelectorAll('*');
          for (const el of els) {
            if (el.shadowRoot) count += deepCount(el.shadowRoot, sel);
          }
          return count;
        };
        return {
          title: document.title,
          url: window.location.href,
          bodyText: document.body?.innerText?.substring(0, 800) || '',
          inputCount: document.querySelectorAll('input').length,
          deepInputCount: deepCount(document, 'input'),
          iframeCount: document.querySelectorAll('iframe').length,
          shadowRootCount: countShadowRoots(document),
          htmlSnippet: document.body?.innerHTML?.substring(0, 2000) || '',
          customElements: Array.from(document.querySelectorAll('*'))
            .filter(el => el.tagName.includes('-'))
            .slice(0, 10)
            .map(el => el.tagName.toLowerCase()),
        };
      });

      session.status = 'failed';
      session.error = `Login form not found — page: "${pageInfo.title}", URL: ${pageInfo.url}, inputs: ${pageInfo.inputCount} (deep: ${pageInfo.deepInputCount}), iframes: ${pageInfo.iframeCount}, shadowRoots: ${pageInfo.shadowRootCount}`;
      updateCaption(session, session.error);
      emitEvent(session, {
        type: 'error',
        timestamp: Date.now(),
        error: session.error,
        diagnostics: {
          ...pageInfo,
          htmlSnippet: pageInfo.htmlSnippet.substring(0, 1000),
        },
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

    // Helper: resolve element handle — tries loginTarget.$() first, then page.$()
    // for pierce selectors (which only work on Page, not Frame)
    async function resolveElement(selector: string): Promise<Awaited<ReturnType<Page['$']>>> {
      let el = await loginTarget.$(selector);
      if (!el && loginTarget !== page) {
        el = await page.$(selector);
      }
      // If selector starts with 'pierce/', it only works on page.$()
      if (!el && selector.startsWith('pierce/')) {
        el = await page.$(selector);
      }
      return el;
    }

    // Clear and type username — use evaluate to clear first for robustness
    const userEl = await resolveElement(usernameSelector);
    if (userEl) {
      await userEl.click({ clickCount: 3 });
      await userEl.type(credentials.username, { delay: config.typeDelay ?? 50 });
    } else {
      emitEvent(session, {
        type: 'warning',
        timestamp: Date.now(),
        message: `Could not resolve username element with selector: ${usernameSelector}`,
      });
      await loginTarget.click(usernameSelector, { clickCount: 3 });
      await loginTarget.type(usernameSelector, credentials.username, {
        delay: config.typeDelay ?? 50,
      });
    }

    updateCaption(session, 'Entering password...');
    const passEl = await resolveElement(passwordSelector);
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
    const submitEl = await resolveElement(submitSelector);
    if (submitEl) {
      await submitEl.click();
    } else {
      await loginTarget.click(submitSelector);
    }
    emitEvent(session, { type: 'status', timestamp: Date.now(), status: 'submitting' });

    // Wait for page to respond — after submit, banks often do a full page
    // navigation (Chase shows a blue transition screen for ~8-10s).
    // First wait for the initial delay, then wait for the page to settle.
    await new Promise((r) => setTimeout(r, config.postSubmitWait ?? 3000));
    await takeScreenshot(session);

    // Wait for any post-submit navigation to complete
    // (Chase navigates from the login page to the verification/dashboard page)
    try {
      await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 });
    } catch {
      // Navigation may have already completed during postSubmitWait, or may not happen
    }
    await new Promise((r) => setTimeout(r, 2000)); // Extra settle time for SPA rendering
    await takeScreenshot(session);

    // ── Detect outcome ──
    // After login, the page may navigate — check both
    // the main page and the login target (if in an iframe) for outcome indicators.
    let outcomeResult = await detectOutcome(session, config, page, loginTarget);

    // If initial detection returns 'failed', do a second round with a longer wait
    // to handle slow page loads (Chase verification page can take 10-15s)
    if (outcomeResult === 'failed') {
      updateCaption(session, 'Checking for post-login page...');
      await new Promise((r) => setTimeout(r, 5000));
      await takeScreenshot(session);
      outcomeResult = await detectOutcome(session, config, page, loginTarget);
    }

    if (outcomeResult === 'mfa_method_selection') {
      // ── MFA Step 1: Method selection (e.g. Chase "We don't recognize this device") ──
      session.status = 'mfa_required';
      updateCaption(session, 'Device verification required — requesting MFA method...');

      // Gather available MFA methods from the page
      const mfaMethods = await page.evaluate(() => {
        // Look for select/dropdown options
        const selects = document.querySelectorAll('select');
        for (const sel of selects) {
          const opts = Array.from(sel.options)
            .filter((o) => o.value && o.value !== '' && !o.disabled)
            .map((o) => ({ value: o.value, label: o.textContent?.trim() || o.value }));
          if (opts.length > 0) {
            return { selectId: sel.id || null, options: opts };
          }
        }
        // Also check iframes
        return null;
      }).catch(() => null);

      emitEvent(session, {
        type: 'mfa_required',
        timestamp: Date.now(),
        challengeType: 'method_selection',
        methods: mfaMethods?.options || [],
        message: 'Chase requires device verification. Select a delivery method.',
      });

      // Wait for client to provide MFA method selection (or code if they clicked "I already have a code")
      const mfaResponse = await new Promise<{ code?: string; answer?: string; method?: string } | null>(
        (resolve) => {
          session.mfaResolver = resolve as any;
          setTimeout(() => resolve(null), 5 * 60 * 1000);
        },
      );

      if (!mfaResponse) {
        session.status = 'cancelled';
        updateCaption(session, 'MFA cancelled or timed out');
        emitEvent(session, { type: 'status', timestamp: Date.now(), status: 'cancelled' });
        return;
      }

      // If client provided a code directly (e.g. "I already have a code"), skip to code entry
      if (mfaResponse.code) {
        // Look for "I already have a code" link and click it
        try {
          const alreadyHaveCode = await page.$('a[contains="already"], a:has-text("already")');
          if (alreadyHaveCode) await alreadyHaveCode.click();
        } catch {}
        // Try to find OTP input
        await new Promise((r) => setTimeout(r, 2000));
      } else if (mfaResponse.method) {
        // Select the MFA method in the dropdown
        session.status = 'submitting';
        updateCaption(session, `Selecting verification method: ${mfaResponse.method}...`);

        // Try to select from dropdown
        if (mfaMethods?.selectId) {
          await page.select(`#${mfaMethods.selectId}`, mfaResponse.method).catch(() => {});
        } else if (config.selectors.mfaMethodSelect) {
          const selectSelectors = config.selectors.mfaMethodSelect.split(',').map((s) => s.trim());
          for (const sel of selectSelectors) {
            try {
              await page.select(sel, mfaResponse.method);
              break;
            } catch {}
          }
        }

        await new Promise((r) => setTimeout(r, 1000));
        await takeScreenshot(session);

        // Click "Next" button
        if (config.selectors.mfaMethodNextButton) {
          const nextSelectors = config.selectors.mfaMethodNextButton.split(',').map((s) => s.trim());
          for (const sel of nextSelectors) {
            try {
              await page.click(sel);
              break;
            } catch {}
          }
        }

        await new Promise((r) => setTimeout(r, config.postSubmitWait ?? 3000));
        await takeScreenshot(session);

        // Now we should be on the code entry page — check outcome again
        const postMethodResult = await detectOutcome(session, config, page, loginTarget);
        if (postMethodResult === 'mfa') {
          // Good — now on the code entry page. Ask for the code.
          session.status = 'mfa_required';
          updateCaption(session, 'Enter the verification code sent to your device...');
          emitEvent(session, {
            type: 'mfa_required',
            timestamp: Date.now(),
            challengeType: 'code',
            message: 'Enter the verification code Chase sent you.',
          });

          const codeResponse = await new Promise<{ code?: string; answer?: string } | null>(
            (resolve) => {
              session.mfaResolver = resolve;
              setTimeout(() => resolve(null), 5 * 60 * 1000);
            },
          );

          if (!codeResponse?.code) {
            session.status = 'cancelled';
            updateCaption(session, 'MFA cancelled or timed out');
            emitEvent(session, { type: 'status', timestamp: Date.now(), status: 'cancelled' });
            return;
          }

          mfaResponse.code = codeResponse.code;
        } else if (postMethodResult === 'success') {
          session.status = 'success';
          updateCaption(session, 'Successfully connected!');
          emitEvent(session, { type: 'status', timestamp: Date.now(), status: 'success' });
          await takeScreenshot(session);
          emitEvent(session, { type: 'complete', timestamp: Date.now(), status: session.status });
          return;
        } else if (postMethodResult === 'mfa_method_selection') {
          // Still on method selection — might have failed to select
          session.status = 'failed';
          session.error = 'Could not proceed past MFA method selection';
          updateCaption(session, session.error);
          emitEvent(session, { type: 'error', timestamp: Date.now(), error: session.error });
          await takeScreenshot(session);
          emitEvent(session, { type: 'complete', timestamp: Date.now(), status: session.status });
          return;
        }
      }

      // ── MFA Step 2: Submit the verification code ──
      if (mfaResponse.code) {
        session.status = 'submitting';
        updateCaption(session, 'Submitting verification code...');

        const mfaInput = config.selectors.mfaCodeInput;
        const mfaTarget = page;
        if (mfaInput) {
          try {
            await mfaTarget.waitForSelector(mfaInput.split(',')[0].trim(), { timeout: 10000 });
          } catch {
            // Try other selectors
          }
          await mfaTarget.click(mfaInput, { clickCount: 3 }).catch(() => {});
          await mfaTarget.type(mfaInput, mfaResponse.code, {
            delay: config.typeDelay ?? 50,
          });
        }
        if (config.selectors.mfaSubmitButton) {
          await mfaTarget.click(config.selectors.mfaSubmitButton).catch(() => {});
        }

        await new Promise((r) => setTimeout(r, config.postSubmitWait ?? 3000));
        await takeScreenshot(session);

        const postCodeResult = await detectOutcome(session, config, page, loginTarget);
        if (postCodeResult === 'success') {
          session.status = 'success';
          updateCaption(session, 'Successfully connected!');
          emitEvent(session, { type: 'status', timestamp: Date.now(), status: 'success' });
        } else {
          session.status = 'failed';
          session.error = 'Authentication failed after MFA code entry';
          updateCaption(session, session.error);
          emitEvent(session, { type: 'error', timestamp: Date.now(), error: session.error });
        }
      }
    } else if (outcomeResult === 'mfa') {
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
): Promise<'success' | 'mfa' | 'mfa_method_selection' | 'failed'> {
  // Check both the main page and login target (if different) for selectors
  const targets: Array<Page | Frame> = [page];
  if (loginTarget && loginTarget !== page) targets.push(loginTarget);

  // For comma-separated selectors, try each individual selector
  function checkSelector(selectorList: string, label: string, timeoutMs = 8000) {
    const selectors = selectorList.split(',').map((s) => s.trim());
    const attempts = targets.flatMap((t) =>
      selectors.map((s) =>
        t.waitForSelector(s, { timeout: timeoutMs }).then(() => label),
      ),
    );
    return Promise.any(attempts).catch(() => null);
  }

  // Also do a text-based check for MFA/verification pages
  // (Chase says "We don't recognize this device" / "Get verified")
  // Check ALL frames — after login, Chase may render the verification page
  // in a frame or the main page depending on the SPA navigation.
  async function checkPageTextForMfa(): Promise<string | null> {
    const mfaPatterns = [
      /we don.?t recognize this device/i,
      /get verified/i,
      /verify your identity/i,
      /how should we get in touch/i,
      /confirm it.?s you/i,
      /additional verification/i,
      /choose.*delivery method/i,
      /send.*verification code/i,
    ];

    // Check main page
    try {
      const bodyText = await page.evaluate(() => document.body?.innerText || '');
      emitEvent(session, {
        type: 'debug_text_check',
        timestamp: Date.now(),
        target: 'main_page',
        url: page.url(),
        textLength: bodyText.length,
        textSnippet: bodyText.substring(0, 300),
      });
      if (mfaPatterns.some((p) => p.test(bodyText))) {
        return 'mfa_text';
      }
    } catch (err) {
      emitEvent(session, {
        type: 'debug_text_check_error',
        timestamp: Date.now(),
        target: 'main_page',
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // Check all frames too
    try {
      const frames = page.frames();
      for (const frame of frames) {
        try {
          const frameText = await frame.evaluate(() => document.body?.innerText || '');
          if (frameText.length > 10 && mfaPatterns.some((p) => p.test(frameText))) {
            emitEvent(session, {
              type: 'debug_text_check',
              timestamp: Date.now(),
              target: 'frame',
              url: frame.url(),
              textSnippet: frameText.substring(0, 300),
              matched: true,
            });
            return 'mfa_text';
          }
        } catch {
          // Frame might be cross-origin
        }
      }
    } catch {
      // best-effort
    }
    return null;
  }

  const checks = [
    checkSelector(config.selectors.successIndicator, 'success'),
    config.selectors.mfaCodeInput
      ? checkSelector(config.selectors.mfaCodeInput, 'mfa')
      : Promise.resolve(null),
    config.selectors.mfaChallengePage
      ? checkSelector(config.selectors.mfaChallengePage, 'mfa_challenge')
      : Promise.resolve(null),
    checkSelector(config.selectors.errorMessage, 'failed'),
    checkPageTextForMfa(),
  ];

  const results = await Promise.all(checks);
  // Priority: success > mfa_code > mfa_challenge > mfa_text > failed > default failed
  if (results[0] === 'success') return 'success';
  if (results[1] === 'mfa') return 'mfa';
  if (results[2] === 'mfa_challenge') return 'mfa_method_selection';
  if (results[4] === 'mfa_text') return 'mfa_method_selection';
  if (results[3] === 'failed') return 'failed';
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
