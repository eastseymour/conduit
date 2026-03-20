/**
 * Chase Login E2E Test Script
 *
 * A standalone script that exercises the full Chase login flow with Puppeteer,
 * applying all stealth patches and taking timestamped screenshots at each step.
 * Reads credentials from environment variables CHASE_USER and CHASE_PASS.
 *
 * Expected flow:
 *   1. Launch stealth browser
 *   2. Navigate to Chase login page
 *   3. Wait for login form to render (SPA boot)
 *   4. Fill username + password
 *   5. Click submit
 *   6. Detect outcome:
 *      a. Device verification ("We don't recognize this device") → MFA method select
 *      b. MFA code entry (OTP input visible)
 *      c. Success (dashboard / account tiles visible)
 *      d. Error (invalid credentials, locked account, etc.)
 *   7. If MFA method selection: report available methods, wait for manual input
 *   8. If MFA code entry: wait for manual input
 *   9. After MFA: detect success or failure
 *  10. Produce summary of which stage was reached
 *
 * Usage:
 *   CHASE_USER=myuser CHASE_PASS=mypass npx tsx test-chase-e2e.ts
 *   CHASE_USER=myuser CHASE_PASS=mypass npm run test:chase
 *
 * All screenshots are saved to ./screenshots/ with timestamps.
 *
 * Environment variables:
 *   CHASE_USER  — Chase username (required)
 *   CHASE_PASS  — Chase password (required)
 *   CHASE_E2E_HEADLESS — Set to "false" to run headed (default: true)
 *   CHASE_E2E_TIMEOUT  — Navigation timeout in ms (default: 45000)
 *   CHASE_E2E_SCREENSHOT_DIR — Screenshot directory (default: ./screenshots)
 */

import puppeteer, { type Browser, type Page, type Frame } from 'puppeteer';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';

// ─── Types ──────────────────────────────────────────────────────────

/**
 * Discriminated union representing the stages of the Chase login flow.
 * Each stage is a distinct phase — no two stages can be active simultaneously.
 */
type ChaseLoginStage =
  | { stage: 'init' }
  | { stage: 'browser_launched' }
  | { stage: 'navigating' }
  | { stage: 'login_page_loaded'; formFound: boolean }
  | { stage: 'credentials_filled' }
  | { stage: 'submitted' }
  | { stage: 'device_verification'; methods: string[] }
  | { stage: 'mfa_code_entry' }
  | { stage: 'mfa_submitted' }
  | { stage: 'success' }
  | { stage: 'error'; message: string }
  | { stage: 'timeout'; message: string };

/** All possible stage names for exhaustive switch checking. */
type StageName = ChaseLoginStage['stage'];

/** Ordered list of stages for progress tracking. */
const STAGE_ORDER: readonly StageName[] = [
  'init',
  'browser_launched',
  'navigating',
  'login_page_loaded',
  'credentials_filled',
  'submitted',
  'device_verification',
  'mfa_code_entry',
  'mfa_submitted',
  'success',
] as const;

/**
 * Result of the E2E test run.
 *
 * Invariants:
 * - screenshots.length >= 1 (at least init screenshot)
 * - finalStage is always set when the run completes
 * - durationMs > 0
 */
interface E2ETestResult {
  finalStage: ChaseLoginStage;
  screenshots: string[];
  durationMs: number;
  stageLog: Array<{ stage: StageName; timestamp: number; detail?: string }>;
}

// ─── Chase Selectors (mirrored from server.ts BANK_CONFIGS.chase) ───

const CHASE_SELECTORS = {
  usernameInput:
    '#userId-input-field-input, #userId-text-input-field, input[id*="userId"], input[name="userId"]',
  passwordInput:
    '#password-input-field-input, #password-text-input-field, input[id*="password"][type="password"], input[name="password"]',
  submitButton:
    '#signin-button, #submitButton, button[id*="signin"], button[type="submit"]',
  errorMessage:
    '.error-message, .alert-error, [data-testid="error-message"], .logon-error, .generic-error',
  mfaCodeInput:
    '#otpcode_input-input-field, #otpcode-input-field, input[id*="otpcode"], input[name="otpcode"]',
  mfaSubmitButton:
    '#log_on_to_landing_page-next, button[id*="next"], button[type="submit"]',
  mfaChallengePage:
    '#header-simplerAuth-702, [class*="verify"], [class*="challenge"], select[id*="otpMethod"], select[id*="delivery"], [data-testid*="verify"]',
  mfaMethodSelect:
    '#otpMethod, #selectbox-container select, select[id*="delivery"], select[name*="delivery"]',
  mfaMethodNextButton:
    '#requestIdentificationCode-sm, button[id*="next"], #Next',
  successIndicator:
    '.accounts-container, #accountTileList, .dashboard-container, .account-tile, [data-testid="account-tile"]',
} as const;

const CHASE_LOGIN_URL =
  'https://secure.chase.com/web/auth/dashboard#/logon/existing';

const TYPE_DELAY = 50;
const POST_SUBMIT_WAIT = 5000;

// ─── Configuration ──────────────────────────────────────────────────

interface E2EConfig {
  /** Chase username — required */
  username: string;
  /** Chase password — required */
  password: string;
  /** Run headless (default: true) */
  headless: boolean;
  /** Navigation timeout in ms (default: 45000) */
  navigationTimeout: number;
  /** Directory for screenshots (default: ./screenshots) */
  screenshotDir: string;
}

/**
 * Validates and builds config from env vars.
 * Precondition: CHASE_USER and CHASE_PASS must be non-empty.
 */
function buildConfig(): E2EConfig {
  const username = process.env.CHASE_USER ?? '';
  const password = process.env.CHASE_PASS ?? '';

  if (!username) {
    console.error('ERROR: CHASE_USER environment variable is required');
    process.exit(1);
  }
  if (!password) {
    console.error('ERROR: CHASE_PASS environment variable is required');
    process.exit(1);
  }

  const headless = process.env.CHASE_E2E_HEADLESS !== 'false';
  const navigationTimeout = parseInt(
    process.env.CHASE_E2E_TIMEOUT ?? '45000',
    10,
  );
  const screenshotDir =
    process.env.CHASE_E2E_SCREENSHOT_DIR ??
    path.resolve(__dirname, 'screenshots');

  // Invariant: navigationTimeout must be positive
  if (navigationTimeout <= 0 || isNaN(navigationTimeout)) {
    console.error('ERROR: CHASE_E2E_TIMEOUT must be a positive integer');
    process.exit(1);
  }

  return { username, password, headless, navigationTimeout, screenshotDir };
}

// ─── Screenshot Helper ──────────────────────────────────────────────

/**
 * Takes a timestamped screenshot and saves it to the configured directory.
 * Returns the file path of the saved screenshot.
 *
 * Postcondition: returned path exists on disk and is a valid PNG file.
 */
async function takeScreenshot(
  page: Page,
  screenshotDir: string,
  label: string,
): Promise<string> {
  const timestamp = new Date()
    .toISOString()
    .replace(/[:.]/g, '-')
    .replace('T', '_')
    .replace('Z', '');
  const sanitizedLabel = label.replace(/[^a-zA-Z0-9_-]/g, '_');
  const filename = `${timestamp}_${sanitizedLabel}.png`;
  const filepath = path.join(screenshotDir, filename);

  await page.screenshot({ path: filepath, fullPage: true });

  const stat = fs.statSync(filepath);
  console.log(`  [screenshot] ${filename} (${stat.size} bytes)`);
  return filepath;
}

// ─── Stealth Patches ────────────────────────────────────────────────

/**
 * Applies all anti-detection stealth patches to the page.
 * These are mirrored from server.ts to ensure identical behavior.
 *
 * Patches applied:
 * 1. navigator.webdriver → false
 * 2. navigator.plugins → non-empty array
 * 3. navigator.languages → ['en-US', 'en']
 * 4. window.chrome runtime object
 * 5. permissions.query override
 */
async function applyStealthPatches(page: Page): Promise<void> {
  await page.evaluateOnNewDocument(() => {
    // 1. Remove webdriver flag
    Object.defineProperty(navigator, 'webdriver', { get: () => false });

    // 2. Spoof plugins (headless Chrome reports none)
    Object.defineProperty(navigator, 'plugins', {
      get: () => [1, 2, 3, 4, 5],
    });

    // 3. Spoof languages
    Object.defineProperty(navigator, 'languages', {
      get: () => ['en-US', 'en'],
    });

    // 4. Patch Chrome runtime
    // @ts-ignore
    window.chrome = {
      runtime: {},
      loadTimes: function () {},
      csi: function () {},
    };

    // 5. Permissions query override
    const originalQuery = window.navigator.permissions.query;
    // @ts-ignore
    window.navigator.permissions.query = (parameters: any) =>
      parameters.name === 'notifications'
        ? Promise.resolve({
            state: Notification.permission,
          } as PermissionStatus)
        : originalQuery(parameters);
  });
}

// ─── DOM Probing ────────────────────────────────────────────────────

/**
 * Probes the page DOM for login form elements using heuristics.
 * Traverses shadow DOM roots and checks iframes.
 *
 * Returns the selectors that matched, or null if no login form found.
 */
async function probeForLoginForm(
  page: Page,
): Promise<{
  username: string;
  password: string;
  submit: string;
  target: Page | Frame;
} | null> {
  // Try known selectors on main page first
  const knownSelectors = CHASE_SELECTORS.usernameInput.split(',').map((s) =>
    s.trim(),
  );

  for (const sel of knownSelectors) {
    try {
      const el = await page.$(sel);
      if (el) {
        // Found username — now find password and submit
        const passSelectors = CHASE_SELECTORS.passwordInput.split(',').map(
          (s) => s.trim(),
        );
        const submitSelectors = CHASE_SELECTORS.submitButton.split(',').map(
          (s) => s.trim(),
        );

        let passSel: string | null = null;
        let submitSel: string | null = null;

        for (const ps of passSelectors) {
          const pe = await page.$(ps);
          if (pe) {
            passSel = ps;
            break;
          }
        }
        for (const ss of submitSelectors) {
          const se = await page.$(ss);
          if (se) {
            submitSel = ss;
            break;
          }
        }

        if (passSel) {
          return {
            username: sel,
            password: passSel,
            submit: submitSel ?? 'button[type="submit"]',
            target: page,
          };
        }
      }
    } catch {
      // selector didn't match, try next
    }
  }

  // Check iframes
  const frames = page.frames();
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
          foundUser: userInput.id
            ? `#${userInput.id}`
            : 'input[type="text"], input[type="email"]',
          foundPass: passInput.id
            ? `#${passInput.id}`
            : 'input[type="password"]',
          foundSubmit: submitBtn?.id
            ? `#${submitBtn.id}`
            : 'button[type="submit"]',
        };
      });

      if (result) {
        return {
          username: result.foundUser,
          password: result.foundPass,
          submit: result.foundSubmit,
          target: frame,
        };
      }
    } catch {
      // Cross-origin or not ready
    }
  }

  // Deep DOM probe with shadow DOM traversal
  const probeResult = await page.evaluate(() => {
    const deepQueryAll = (
      root: Document | ShadowRoot | Element,
      selector: string,
    ): Element[] => {
      const results: Element[] = [];
      try {
        results.push(...Array.from(root.querySelectorAll(selector)));
      } catch {}
      const allEls = root.querySelectorAll('*');
      for (const el of allEls) {
        if (el.shadowRoot) {
          try {
            results.push(...deepQueryAll(el.shadowRoot, selector));
          } catch {}
        }
      }
      return results;
    };

    const isVisible = (el: Element): boolean => {
      if (!el) return false;
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden')
        return false;
      if (parseFloat(style.opacity) === 0) return false;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return false;
      return true;
    };

    const inputs = deepQueryAll(document, 'input') as HTMLInputElement[];
    const passInput = inputs.find(
      (el) => isVisible(el) && el.type === 'password',
    );
    const userInput = inputs.find(
      (el) =>
        isVisible(el) &&
        (el.type === 'text' ||
          el.type === 'email' ||
          el.type === 'tel' ||
          el.type === '') &&
        (el.id.toLowerCase().includes('user') ||
          el.name.toLowerCase().includes('user') ||
          el.id.toLowerCase().includes('login') ||
          el.getAttribute('autocomplete')?.includes('username')),
    );
    // Fallback: any visible text-like input
    const userInputFallback =
      userInput ||
      inputs.find(
        (el) =>
          isVisible(el) &&
          (el.type === 'text' ||
            el.type === 'email' ||
            el.type === 'tel' ||
            el.type === ''),
      );

    if (!userInputFallback || !passInput) return null;

    const selectorFor = (el: Element): string => {
      if (el.id) return `#${el.id}`;
      if ((el as HTMLInputElement).name)
        return `input[name="${(el as HTMLInputElement).name}"]`;
      return `input[type="${(el as HTMLInputElement).type || 'text'}"]`;
    };

    const buttons = deepQueryAll(
      document,
      'button, input[type="submit"], a[role="button"]',
    ) as HTMLElement[];
    const submitBtn = buttons.find(
      (el) =>
        isVisible(el) &&
        (el.id.toLowerCase().includes('sign') ||
          el.id.toLowerCase().includes('submit') ||
          el.textContent?.toLowerCase().includes('sign in') ||
          el.textContent?.toLowerCase().includes('log in')),
    );

    return {
      foundUser: selectorFor(userInputFallback),
      foundPass: selectorFor(passInput),
      foundSubmit: submitBtn
        ? selectorFor(submitBtn)
        : 'button[type="submit"]',
    };
  });

  if (probeResult) {
    return {
      username: probeResult.foundUser,
      password: probeResult.foundPass,
      submit: probeResult.foundSubmit,
      target: page,
    };
  }

  return null;
}

// ─── Outcome Detection ──────────────────────────────────────────────

/**
 * Detects the current outcome after login submission.
 *
 * Checks (in priority order):
 * 1. Success indicators (dashboard elements)
 * 2. MFA code input visible → mfa_code_entry
 * 3. MFA challenge page / device verification text → device_verification
 * 4. Error messages → error
 * 5. Default → unknown (still loading)
 */
async function detectOutcome(
  page: Page,
): Promise<
  | { outcome: 'success' }
  | { outcome: 'mfa_code_entry' }
  | { outcome: 'device_verification'; methods: string[] }
  | { outcome: 'error'; message: string }
  | { outcome: 'unknown' }
> {
  // Helper: check if any selector from a comma-separated list matches
  const hasSelector = async (
    selectorList: string,
    target: Page | Frame = page,
  ): Promise<boolean> => {
    const selectors = selectorList.split(',').map((s) => s.trim());
    for (const sel of selectors) {
      try {
        const el = await target.$(sel);
        if (el) return true;
      } catch {}
    }
    return false;
  };

  // Also check all frames
  const allTargets: Array<Page | Frame> = [
    page,
    ...page.frames().filter((f) => f !== page.mainFrame()),
  ];

  // 1. Success
  for (const t of allTargets) {
    if (await hasSelector(CHASE_SELECTORS.successIndicator, t)) {
      return { outcome: 'success' };
    }
  }

  // 2. MFA code input
  for (const t of allTargets) {
    if (await hasSelector(CHASE_SELECTORS.mfaCodeInput, t)) {
      return { outcome: 'mfa_code_entry' };
    }
  }

  // 3. Device verification — check both selectors AND text
  for (const t of allTargets) {
    if (await hasSelector(CHASE_SELECTORS.mfaChallengePage, t)) {
      const methods = await extractMfaMethods(page);
      return { outcome: 'device_verification', methods };
    }
  }

  // Text-based MFA detection across all frames
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

  for (const t of allTargets) {
    try {
      const bodyText = await t.evaluate(
        () => document.body?.innerText || '',
      );
      if (mfaPatterns.some((p) => p.test(bodyText))) {
        const methods = await extractMfaMethods(page);
        return { outcome: 'device_verification', methods };
      }
    } catch {}
  }

  // 4. Error detection
  for (const t of allTargets) {
    if (await hasSelector(CHASE_SELECTORS.errorMessage, t)) {
      const errorText = await extractErrorText(page);
      return { outcome: 'error', message: errorText };
    }
  }

  // Text-based error detection
  const errorPatterns = [
    /can.?t find that username/i,
    /invalid.*username.*password/i,
    /incorrect.*password/i,
    /account.*locked/i,
    /too many.*attempts/i,
    /temporarily.*locked/i,
    /sign.?in.*failed/i,
  ];

  for (const t of allTargets) {
    try {
      const bodyText = await t.evaluate(
        () => document.body?.innerText || '',
      );
      for (const pattern of errorPatterns) {
        const match = bodyText.match(pattern);
        if (match) {
          return { outcome: 'error', message: match[0] };
        }
      }
    } catch {}
  }

  return { outcome: 'unknown' };
}

/** Extract available MFA methods from the page (from selects or dropdowns). */
async function extractMfaMethods(page: Page): Promise<string[]> {
  const allTargets: Array<Page | Frame> = [
    page,
    ...page.frames().filter((f) => f !== page.mainFrame()),
  ];

  for (const t of allTargets) {
    try {
      const methods = await t.evaluate(() => {
        const selects = document.querySelectorAll(
          'select',
        ) as NodeListOf<HTMLSelectElement>;
        for (const sel of selects) {
          const opts = Array.from(sel.options)
            .filter((o) => o.value && o.value !== '' && !o.disabled)
            .map((o) => o.textContent?.trim() || o.value);
          if (opts.length > 0) return opts;
        }
        return [] as string[];
      });
      if (methods.length > 0) return methods;
    } catch {}
  }

  return [];
}

/** Extract error text from error message elements. */
async function extractErrorText(page: Page): Promise<string> {
  const allTargets: Array<Page | Frame> = [
    page,
    ...page.frames().filter((f) => f !== page.mainFrame()),
  ];

  const selectors = CHASE_SELECTORS.errorMessage.split(',').map((s) =>
    s.trim(),
  );

  for (const t of allTargets) {
    for (const sel of selectors) {
      try {
        const el = await t.$(sel);
        if (el) {
          const text = await t.evaluate((e) => e.textContent, el);
          if (text?.trim()) return text.trim();
        }
      } catch {}
    }
  }

  return 'Unknown error';
}

// ─── Interactive Input ──────────────────────────────────────────────

/** Prompt the user for input on the command line. */
function promptUser(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// ─── Main E2E Flow ──────────────────────────────────────────────────

/**
 * Run the Chase login E2E test.
 *
 * Invariants:
 * - Browser is always cleaned up on exit (finally block)
 * - At least one screenshot is taken per stage transition
 * - stageLog is append-only and chronologically ordered
 *
 * Postcondition: returns a complete E2ETestResult with finalStage set.
 */
async function runChaseE2E(config: E2EConfig): Promise<E2ETestResult> {
  const startTime = Date.now();
  const screenshots: string[] = [];
  const stageLog: E2ETestResult['stageLog'] = [];
  let currentStage: ChaseLoginStage = { stage: 'init' };
  let browser: Browser | null = null;

  function logStage(stage: ChaseLoginStage, detail?: string): void {
    currentStage = stage;
    stageLog.push({
      stage: stage.stage,
      timestamp: Date.now(),
      detail,
    });
    const prefix = `[${new Date().toISOString()}]`;
    const detailStr = detail ? ` — ${detail}` : '';
    console.log(`${prefix} STAGE: ${stage.stage}${detailStr}`);
  }

  try {
    // ── Stage: init ──
    logStage({ stage: 'init' });

    // Ensure screenshot directory exists
    if (!fs.existsSync(config.screenshotDir)) {
      fs.mkdirSync(config.screenshotDir, { recursive: true });
    }

    // ── Stage: browser_launched ──
    console.log('\nLaunching browser...');
    browser = await puppeteer.launch({
      headless: config.headless,
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
    logStage({ stage: 'browser_launched' });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    // Clean UA string — remove HeadlessChrome, spoof macOS
    const realUA = await browser.userAgent();
    const cleanUA = realUA
      .replace('HeadlessChrome/', 'Chrome/')
      .replace(/X11; Linux x86_64/, 'Macintosh; Intel Mac OS X 10_15_7');
    await page.setUserAgent(cleanUA);
    console.log(`  UA: ${cleanUA.substring(0, 80)}...`);

    // Apply stealth patches
    await applyStealthPatches(page);
    console.log('  Stealth patches applied');

    screenshots.push(
      await takeScreenshot(page, config.screenshotDir, '01_browser_launched'),
    );

    // ── Stage: navigating ──
    logStage({ stage: 'navigating' }, CHASE_LOGIN_URL);
    console.log(`\nNavigating to Chase login...`);

    try {
      await page.goto(CHASE_LOGIN_URL, {
        waitUntil: 'networkidle2',
        timeout: config.navigationTimeout,
      });
    } catch (navErr: unknown) {
      const msg = navErr instanceof Error ? navErr.message : String(navErr);
      if (msg.includes('frame was detached') || msg.includes('ERR_ABORTED')) {
        console.log(`  Navigation recovered from: ${msg}`);
        await new Promise((r) => setTimeout(r, 5000));
        try {
          await page.waitForNetworkIdle({ timeout: 15000 });
        } catch {
          // Network may not fully settle
        }
      } else {
        throw navErr;
      }
    }

    screenshots.push(
      await takeScreenshot(page, config.screenshotDir, '02_page_loaded'),
    );

    // ── Stage: login_page_loaded ──
    console.log('\nWaiting for login form to render...');

    // Wait for the SPA to boot — use waitForFunction with shadow DOM traversal
    let formFound = false;
    let loginForm: Awaited<ReturnType<typeof probeForLoginForm>> = null;

    // Attempt 1: Wait for known selectors (25s timeout for SPA boot)
    try {
      await page.waitForFunction(
        (selectorList: string) => {
          const selectors = selectorList.split(',').map((s) => s.trim());
          if (selectors.some((s) => document.querySelector(s) !== null))
            return true;
          // Traverse shadow roots
          const deepFind = (
            root: Document | ShadowRoot | Element,
            sel: string,
          ): boolean => {
            try {
              if (root.querySelector(sel)) return true;
            } catch {
              return false;
            }
            const els = root.querySelectorAll('*');
            for (const el of els) {
              if (el.shadowRoot && deepFind(el.shadowRoot, sel)) return true;
            }
            return false;
          };
          return selectors.some((s) => deepFind(document, s));
        },
        { timeout: 25000 },
        CHASE_SELECTORS.usernameInput,
      );
      formFound = true;
    } catch {
      console.log('  Known selectors timed out, probing DOM...');
    }

    // Attempt 2: Probe DOM (includes iframes, shadow DOM)
    if (!formFound) {
      loginForm = await probeForLoginForm(page);
      formFound = loginForm !== null;
    }

    // Attempt 3: Wait longer and retry
    if (!formFound) {
      console.log('  Waiting 10s more for SPA to finish loading...');
      await new Promise((r) => setTimeout(r, 10000));
      screenshots.push(
        await takeScreenshot(
          page,
          config.screenshotDir,
          '02b_after_extra_wait',
        ),
      );
      loginForm = await probeForLoginForm(page);
      formFound = loginForm !== null;
    }

    logStage({ stage: 'login_page_loaded', formFound });
    screenshots.push(
      await takeScreenshot(page, config.screenshotDir, '03_login_form'),
    );

    if (!formFound) {
      // Capture diagnostic info
      const pageInfo = await page.evaluate(() => ({
        title: document.title,
        url: window.location.href,
        inputCount: document.querySelectorAll('input').length,
        iframeCount: document.querySelectorAll('iframe').length,
        bodyTextSnippet: document.body?.innerText?.substring(0, 500) || '',
      }));
      const errorMsg = `Login form not found. Page: "${pageInfo.title}", URL: ${pageInfo.url}, inputs: ${pageInfo.inputCount}, iframes: ${pageInfo.iframeCount}`;
      console.log(`\n  DIAGNOSTIC: ${errorMsg}`);
      console.log(
        `  Body text: ${pageInfo.bodyTextSnippet.substring(0, 200)}`,
      );
      logStage({ stage: 'error', message: errorMsg });
      return {
        finalStage: currentStage,
        screenshots,
        durationMs: Date.now() - startTime,
        stageLog,
      };
    }

    // Resolve the form if we used waitForFunction (known selectors matched)
    if (!loginForm) {
      loginForm = await probeForLoginForm(page);
    }

    // Invariant: loginForm must be non-null if formFound is true
    if (!loginForm) {
      logStage({
        stage: 'error',
        message: 'Form found flag set but probe returned null — race condition',
      });
      return {
        finalStage: currentStage,
        screenshots,
        durationMs: Date.now() - startTime,
        stageLog,
      };
    }

    console.log(`  Username selector: ${loginForm.username}`);
    console.log(`  Password selector: ${loginForm.password}`);
    console.log(`  Submit selector: ${loginForm.submit}`);
    console.log(
      `  Target: ${loginForm.target === page ? 'main page' : 'iframe'}`,
    );

    // ── Stage: credentials_filled ──
    console.log('\nFilling credentials...');
    const target = loginForm.target;

    // Type username
    try {
      const userEl = await target.$(loginForm.username);
      if (userEl) {
        await userEl.click({ clickCount: 3 });
        await userEl.type(config.username, { delay: TYPE_DELAY });
      } else {
        await target.click(loginForm.username, { clickCount: 3 });
        await target.type(loginForm.username, config.username, {
          delay: TYPE_DELAY,
        });
      }
    } catch (err) {
      console.log(
        `  Warning: username fill error: ${err instanceof Error ? err.message : err}`,
      );
    }

    // Type password
    try {
      const passEl = await target.$(loginForm.password);
      if (passEl) {
        await passEl.click({ clickCount: 3 });
        await passEl.type(config.password, { delay: TYPE_DELAY });
      } else {
        await target.click(loginForm.password, { clickCount: 3 });
        await target.type(loginForm.password, config.password, {
          delay: TYPE_DELAY,
        });
      }
    } catch (err) {
      console.log(
        `  Warning: password fill error: ${err instanceof Error ? err.message : err}`,
      );
    }

    logStage({ stage: 'credentials_filled' });
    screenshots.push(
      await takeScreenshot(
        page,
        config.screenshotDir,
        '04_credentials_filled',
      ),
    );

    // ── Stage: submitted ──
    console.log('\nSubmitting login...');
    try {
      const submitEl = await target.$(loginForm.submit);
      if (submitEl) {
        await submitEl.click();
      } else {
        await target.click(loginForm.submit);
      }
    } catch (err) {
      console.log(
        `  Warning: submit click error: ${err instanceof Error ? err.message : err}`,
      );
    }

    logStage({ stage: 'submitted' });

    // Wait for page to respond
    console.log(`  Waiting ${POST_SUBMIT_WAIT}ms for response...`);
    await new Promise((r) => setTimeout(r, POST_SUBMIT_WAIT));

    screenshots.push(
      await takeScreenshot(
        page,
        config.screenshotDir,
        '05_after_submit',
      ),
    );

    // ── Outcome Detection Loop ──
    console.log('\nDetecting outcome...');
    const pollStartTime = Date.now();
    const pollTimeoutMs = 30000;
    const pollIntervalMs = 2000;
    let lastOutcome = await detectOutcome(page);

    while (
      lastOutcome.outcome === 'unknown' &&
      Date.now() - pollStartTime < pollTimeoutMs
    ) {
      console.log(
        `  Polling... (${Math.round((Date.now() - pollStartTime) / 1000)}s)`,
      );
      await new Promise((r) => setTimeout(r, pollIntervalMs));
      lastOutcome = await detectOutcome(page);
    }

    screenshots.push(
      await takeScreenshot(
        page,
        config.screenshotDir,
        '06_outcome_detected',
      ),
    );

    console.log(`  Outcome: ${lastOutcome.outcome}`);

    // ── Handle Outcome ──
    switch (lastOutcome.outcome) {
      case 'success': {
        logStage({ stage: 'success' });
        screenshots.push(
          await takeScreenshot(page, config.screenshotDir, '07_success'),
        );
        break;
      }

      case 'device_verification': {
        logStage(
          {
            stage: 'device_verification',
            methods: lastOutcome.methods,
          },
          `Methods: ${lastOutcome.methods.join(', ') || 'none detected'}`,
        );
        screenshots.push(
          await takeScreenshot(
            page,
            config.screenshotDir,
            '07_device_verification',
          ),
        );

        // Interactive: ask user if they want to continue
        if (process.stdin.isTTY) {
          console.log('\n  Device verification required.');
          if (lastOutcome.methods.length > 0) {
            console.log('  Available methods:');
            lastOutcome.methods.forEach((m, i) =>
              console.log(`    ${i + 1}. ${m}`),
            );
          }
          const choice = await promptUser(
            '  Enter method number (or press Enter to skip): ',
          );
          if (choice) {
            console.log(`  Selected method: ${choice}`);
            // Would select method here in a full interactive flow
          }

          const code = await promptUser(
            '  Enter verification code (or press Enter to skip): ',
          );
          if (code) {
            logStage({ stage: 'mfa_code_entry' });

            // Try to enter the code
            const mfaInputSelectors = CHASE_SELECTORS.mfaCodeInput
              .split(',')
              .map((s) => s.trim());
            const allTargets: Array<Page | Frame> = [
              page,
              ...page.frames().filter((f) => f !== page.mainFrame()),
            ];
            let codeEntered = false;

            for (const t of allTargets) {
              for (const sel of mfaInputSelectors) {
                try {
                  await t.click(sel, { clickCount: 3 });
                  await t.type(sel, code, { delay: TYPE_DELAY });
                  codeEntered = true;
                  break;
                } catch {}
              }
              if (codeEntered) break;
            }

            if (codeEntered) {
              // Click submit
              const submitSelectors = CHASE_SELECTORS.mfaSubmitButton
                .split(',')
                .map((s) => s.trim());
              for (const t of allTargets) {
                for (const sel of submitSelectors) {
                  try {
                    await t.click(sel);
                    break;
                  } catch {}
                }
              }

              logStage({ stage: 'mfa_submitted' });
              await new Promise((r) => setTimeout(r, POST_SUBMIT_WAIT));
              screenshots.push(
                await takeScreenshot(
                  page,
                  config.screenshotDir,
                  '08_mfa_submitted',
                ),
              );

              const postMfaOutcome = await detectOutcome(page);
              if (postMfaOutcome.outcome === 'success') {
                logStage({ stage: 'success' });
                screenshots.push(
                  await takeScreenshot(
                    page,
                    config.screenshotDir,
                    '09_success_after_mfa',
                  ),
                );
              } else {
                logStage({
                  stage: 'error',
                  message: `Post-MFA outcome: ${postMfaOutcome.outcome}`,
                });
              }
            } else {
              logStage({
                stage: 'error',
                message: 'Could not find MFA code input',
              });
            }
          }
        } else {
          console.log(
            '  Non-interactive mode — cannot proceed past device verification',
          );
        }
        break;
      }

      case 'mfa_code_entry': {
        logStage({ stage: 'mfa_code_entry' });
        screenshots.push(
          await takeScreenshot(
            page,
            config.screenshotDir,
            '07_mfa_code_entry',
          ),
        );

        if (process.stdin.isTTY) {
          const code = await promptUser(
            '  Enter MFA code (or press Enter to skip): ',
          );
          if (code) {
            const mfaInputSelectors = CHASE_SELECTORS.mfaCodeInput
              .split(',')
              .map((s) => s.trim());
            const allTargets: Array<Page | Frame> = [
              page,
              ...page.frames().filter((f) => f !== page.mainFrame()),
            ];
            let codeEntered = false;

            for (const t of allTargets) {
              for (const sel of mfaInputSelectors) {
                try {
                  await t.click(sel, { clickCount: 3 });
                  await t.type(sel, code, { delay: TYPE_DELAY });
                  codeEntered = true;
                  break;
                } catch {}
              }
              if (codeEntered) break;
            }

            if (codeEntered) {
              const submitSelectors = CHASE_SELECTORS.mfaSubmitButton
                .split(',')
                .map((s) => s.trim());
              for (const t of allTargets) {
                for (const sel of submitSelectors) {
                  try {
                    await t.click(sel);
                    break;
                  } catch {}
                }
              }

              logStage({ stage: 'mfa_submitted' });
              await new Promise((r) => setTimeout(r, POST_SUBMIT_WAIT));
              screenshots.push(
                await takeScreenshot(
                  page,
                  config.screenshotDir,
                  '08_mfa_submitted',
                ),
              );

              const postMfaOutcome = await detectOutcome(page);
              if (postMfaOutcome.outcome === 'success') {
                logStage({ stage: 'success' });
                screenshots.push(
                  await takeScreenshot(
                    page,
                    config.screenshotDir,
                    '09_success_after_mfa',
                  ),
                );
              } else {
                logStage({
                  stage: 'error',
                  message: `Post-MFA outcome: ${postMfaOutcome.outcome}`,
                });
              }
            }
          }
        } else {
          console.log(
            '  Non-interactive mode — cannot proceed past MFA code entry',
          );
        }
        break;
      }

      case 'error': {
        logStage(
          { stage: 'error', message: lastOutcome.message },
          lastOutcome.message,
        );
        screenshots.push(
          await takeScreenshot(page, config.screenshotDir, '07_error'),
        );
        break;
      }

      case 'unknown': {
        logStage(
          { stage: 'timeout', message: 'Could not determine outcome within polling timeout' },
          `Polled for ${Math.round((Date.now() - pollStartTime) / 1000)}s`,
        );
        screenshots.push(
          await takeScreenshot(page, config.screenshotDir, '07_timeout'),
        );
        break;
      }
    }

    return {
      finalStage: currentStage,
      screenshots,
      durationMs: Date.now() - startTime,
      stageLog,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logStage({ stage: 'error', message });
    console.error(`\nFATAL ERROR: ${message}`);
    if (err instanceof Error && err.stack) {
      console.error(err.stack);
    }
    return {
      finalStage: currentStage,
      screenshots,
      durationMs: Date.now() - startTime,
      stageLog,
    };
  } finally {
    // Invariant: browser is always cleaned up
    if (browser) {
      console.log('\nClosing browser...');
      await browser.close().catch(() => {});
    }
  }
}

// ─── Report ─────────────────────────────────────────────────────────

function printReport(result: E2ETestResult): void {
  console.log('\n' + '='.repeat(60));
  console.log('  CHASE LOGIN E2E TEST REPORT');
  console.log('='.repeat(60));

  console.log(`\n  Final stage:    ${result.finalStage.stage}`);
  if ('message' in result.finalStage) {
    console.log(`  Detail:         ${result.finalStage.message}`);
  }
  if ('methods' in result.finalStage && result.finalStage.methods.length > 0) {
    console.log(
      `  MFA methods:    ${result.finalStage.methods.join(', ')}`,
    );
  }
  console.log(
    `  Duration:       ${(result.durationMs / 1000).toFixed(1)}s`,
  );
  console.log(`  Screenshots:    ${result.screenshots.length}`);

  console.log('\n  Stage log:');
  for (const entry of result.stageLog) {
    const ts = new Date(entry.timestamp).toISOString();
    const detail = entry.detail ? ` — ${entry.detail}` : '';
    console.log(`    ${ts}  ${entry.stage}${detail}`);
  }

  console.log('\n  Screenshots:');
  for (const s of result.screenshots) {
    console.log(`    ${path.basename(s)}`);
  }

  // Summary
  const stageIdx = STAGE_ORDER.indexOf(result.finalStage.stage);
  const totalStages = STAGE_ORDER.length;
  const progress =
    stageIdx >= 0
      ? `${stageIdx + 1}/${totalStages}`
      : `?/${totalStages}`;
  console.log(`\n  Progress:       ${progress} stages reached`);

  const isSuccess = result.finalStage.stage === 'success';
  const emoji = isSuccess ? 'PASS' : 'STOPPED';
  console.log(`  Result:         ${emoji}`);
  console.log('\n' + '='.repeat(60));
}

// ─── Entry Point ────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('Chase Login E2E Test Script');
  console.log('==========================\n');

  console.log('Expected flow:');
  console.log('  1. Launch stealth browser');
  console.log('  2. Navigate to Chase login page');
  console.log('  3. Wait for login form (SPA boot)');
  console.log('  4. Fill username + password');
  console.log('  5. Click submit');
  console.log('  6. Detect outcome:');
  console.log('     a. Device verification → MFA method select');
  console.log('     b. MFA code entry');
  console.log('     c. Success (dashboard)');
  console.log('     d. Error (invalid credentials, etc.)');
  console.log('');

  const config = buildConfig();
  console.log(`Username:     ${config.username.substring(0, 3)}...`);
  console.log(`Headless:     ${config.headless}`);
  console.log(`Timeout:      ${config.navigationTimeout}ms`);
  console.log(`Screenshots:  ${config.screenshotDir}`);

  const result = await runChaseE2E(config);
  printReport(result);

  // Exit with non-zero if not success and not an MFA stop
  const terminalOk = ['success', 'device_verification', 'mfa_code_entry', 'mfa_submitted'];
  if (!terminalOk.includes(result.finalStage.stage)) {
    process.exit(1);
  }
}

// ─── Exports for Testing ────────────────────────────────────────────

export {
  type ChaseLoginStage,
  type StageName,
  type E2ETestResult,
  type E2EConfig,
  CHASE_SELECTORS,
  CHASE_LOGIN_URL,
  STAGE_ORDER,
  buildConfig,
  applyStealthPatches,
  probeForLoginForm,
  detectOutcome,
  extractMfaMethods,
  extractErrorText,
  takeScreenshot,
  runChaseE2E,
  printReport,
};

// Run if executed directly (not when imported by tests).
// When tsx runs this file directly, require.main === module.
// When jest imports it, require.main !== module.
if (require.main === module) {
  main().catch((err) => {
    console.error('Unhandled error:', err);
    process.exit(1);
  });
}
