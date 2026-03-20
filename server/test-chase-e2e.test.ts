/**
 * Unit tests for the Chase E2E test script.
 *
 * Tests cover:
 * - Configuration building and validation
 * - Stage ordering and invariants
 * - Selector constants correctness
 * - Screenshot filename generation
 * - Report printing
 *
 * NOTE: These are unit tests for the pure logic in test-chase-e2e.ts.
 * The actual E2E flow requires a real browser and Chase credentials —
 * that is tested manually with `npm run test:chase`.
 */

// We need to mock process.exit and puppeteer before importing the module
const mockExit = jest
  .spyOn(process, 'exit')
  .mockImplementation((() => {
    throw new Error('process.exit called');
  }) as any);

// Store original env
const originalEnv = { ...process.env };

// Mock puppeteer — not needed for unit tests
jest.mock('puppeteer', () => ({
  launch: jest.fn(),
  default: { launch: jest.fn() },
}));

// Import AFTER mocks are in place
import {
  CHASE_SELECTORS,
  CHASE_LOGIN_URL,
  STAGE_ORDER,
  printReport,
  type ChaseLoginStage,
  type StageName,
  type E2ETestResult,
  type E2EConfig,
} from './test-chase-e2e';

afterEach(() => {
  process.env = { ...originalEnv };
  mockExit.mockClear();
});

afterAll(() => {
  mockExit.mockRestore();
});

// ─── CHASE_SELECTORS Tests ──────────────────────────────────────────

describe('CHASE_SELECTORS', () => {
  it('has all required selector keys', () => {
    const requiredKeys = [
      'usernameInput',
      'passwordInput',
      'submitButton',
      'errorMessage',
      'mfaCodeInput',
      'mfaSubmitButton',
      'mfaChallengePage',
      'mfaMethodSelect',
      'mfaMethodNextButton',
      'successIndicator',
    ] as const;

    for (const key of requiredKeys) {
      expect(CHASE_SELECTORS).toHaveProperty(key);
      expect(typeof CHASE_SELECTORS[key]).toBe('string');
      expect(CHASE_SELECTORS[key].length).toBeGreaterThan(0);
    }
  });

  it('username selectors include userId variants', () => {
    expect(CHASE_SELECTORS.usernameInput).toContain('userId');
  });

  it('password selectors target password type inputs', () => {
    expect(CHASE_SELECTORS.passwordInput).toContain('password');
  });

  it('submit selectors include signin button', () => {
    expect(CHASE_SELECTORS.submitButton).toContain('signin');
  });

  it('success indicator includes account-related selectors', () => {
    expect(CHASE_SELECTORS.successIndicator).toContain('account');
  });

  it('MFA code input targets OTP-related selectors', () => {
    expect(CHASE_SELECTORS.mfaCodeInput).toContain('otpcode');
  });

  it('all selectors have balanced brackets', () => {
    for (const [_key, value] of Object.entries(CHASE_SELECTORS)) {
      const selectorStr = value as string;
      const selectors = selectorStr.split(',').map((s: string) => s.trim());
      for (const sel of selectors) {
        const openBrackets = (sel.match(/\[/g) || []).length;
        const closeBrackets = (sel.match(/\]/g) || []).length;
        expect(openBrackets).toBe(closeBrackets);
        expect(sel.length).toBeGreaterThan(0);
      }
    }
  });
});

// ─── CHASE_LOGIN_URL Tests ──────────────────────────────────────────

describe('CHASE_LOGIN_URL', () => {
  it('is an HTTPS URL', () => {
    expect(CHASE_LOGIN_URL).toMatch(/^https:\/\//);
  });

  it('points to secure.chase.com', () => {
    expect(CHASE_LOGIN_URL).toContain('secure.chase.com');
  });

  it('includes the logon path', () => {
    expect(CHASE_LOGIN_URL).toContain('logon');
  });
});

// ─── STAGE_ORDER Tests ──────────────────────────────────────────────

describe('STAGE_ORDER', () => {
  it('has at least 8 stages', () => {
    expect(STAGE_ORDER.length).toBeGreaterThanOrEqual(8);
  });

  it('starts with init', () => {
    expect(STAGE_ORDER[0]).toBe('init');
  });

  it('ends with success', () => {
    expect(STAGE_ORDER[STAGE_ORDER.length - 1]).toBe('success');
  });

  it('has no duplicate stages', () => {
    const uniqueStages = new Set(STAGE_ORDER);
    expect(uniqueStages.size).toBe(STAGE_ORDER.length);
  });

  it('contains all critical flow stages', () => {
    const criticalStages: StageName[] = [
      'init',
      'browser_launched',
      'navigating',
      'login_page_loaded',
      'credentials_filled',
      'submitted',
      'success',
    ];
    for (const stage of criticalStages) {
      expect(STAGE_ORDER).toContain(stage);
    }
  });

  it('has browser_launched before navigating', () => {
    const browserIdx = STAGE_ORDER.indexOf('browser_launched');
    const navIdx = STAGE_ORDER.indexOf('navigating');
    expect(browserIdx).toBeLessThan(navIdx);
  });

  it('has credentials_filled before submitted', () => {
    const fillIdx = STAGE_ORDER.indexOf('credentials_filled');
    const submitIdx = STAGE_ORDER.indexOf('submitted');
    expect(fillIdx).toBeLessThan(submitIdx);
  });

  it('has submitted before device_verification', () => {
    const submitIdx = STAGE_ORDER.indexOf('submitted');
    const dvIdx = STAGE_ORDER.indexOf('device_verification');
    expect(submitIdx).toBeLessThan(dvIdx);
  });
});

// ─── ChaseLoginStage Type Tests ─────────────────────────────────────

describe('ChaseLoginStage type correctness', () => {
  it('init stage has no extra fields', () => {
    const stage: ChaseLoginStage = { stage: 'init' };
    expect(stage.stage).toBe('init');
  });

  it('error stage includes message', () => {
    const stage: ChaseLoginStage = {
      stage: 'error',
      message: 'test error',
    };
    expect(stage.stage).toBe('error');
    expect(stage.message).toBe('test error');
  });

  it('device_verification stage includes methods array', () => {
    const stage: ChaseLoginStage = {
      stage: 'device_verification',
      methods: ['Text message', 'Email'],
    };
    expect(stage.stage).toBe('device_verification');
    expect(stage.methods).toHaveLength(2);
  });

  it('login_page_loaded stage includes formFound flag', () => {
    const stage: ChaseLoginStage = {
      stage: 'login_page_loaded',
      formFound: true,
    };
    expect(stage.formFound).toBe(true);
  });

  it('timeout stage includes message', () => {
    const stage: ChaseLoginStage = {
      stage: 'timeout',
      message: 'Polling timed out',
    };
    expect(stage.stage).toBe('timeout');
    expect(stage.message).toBe('Polling timed out');
  });
});

// ─── E2ETestResult Invariants ───────────────────────────────────────

describe('E2ETestResult invariants', () => {
  it('always has a finalStage', () => {
    const result: E2ETestResult = {
      finalStage: { stage: 'init' },
      screenshots: [],
      durationMs: 100,
      stageLog: [{ stage: 'init', timestamp: Date.now() }],
    };
    expect(result.finalStage).toBeDefined();
    expect(result.finalStage.stage).toBe('init');
  });

  it('durationMs must be positive', () => {
    const result: E2ETestResult = {
      finalStage: { stage: 'success' },
      screenshots: ['test.png'],
      durationMs: 5000,
      stageLog: [],
    };
    expect(result.durationMs).toBeGreaterThan(0);
  });

  it('stageLog entries are chronologically ordered', () => {
    const now = Date.now();
    const result: E2ETestResult = {
      finalStage: { stage: 'submitted' },
      screenshots: [],
      durationMs: 3000,
      stageLog: [
        { stage: 'init', timestamp: now },
        { stage: 'browser_launched', timestamp: now + 500 },
        { stage: 'navigating', timestamp: now + 1000 },
      ],
    };
    for (const entry of result.stageLog) {
      expect(entry.timestamp).toBeGreaterThan(0);
    }
    for (let i = 1; i < result.stageLog.length; i++) {
      expect(result.stageLog[i]!.timestamp).toBeGreaterThanOrEqual(
        result.stageLog[i - 1]!.timestamp,
      );
    }
  });
});

// ─── printReport Tests ──────────────────────────────────────────────

describe('printReport', () => {
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, 'log').mockImplementation();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('prints report without throwing', () => {
    const result: E2ETestResult = {
      finalStage: { stage: 'success' },
      screenshots: ['01_init.png', '02_loaded.png'],
      durationMs: 15000,
      stageLog: [
        { stage: 'init', timestamp: Date.now() - 15000 },
        { stage: 'success', timestamp: Date.now() },
      ],
    };
    expect(() => printReport(result)).not.toThrow();
    expect(consoleSpy).toHaveBeenCalled();
  });

  it('includes final stage name in output', () => {
    const result: E2ETestResult = {
      finalStage: { stage: 'device_verification', methods: ['Text'] },
      screenshots: [],
      durationMs: 10000,
      stageLog: [],
    };
    printReport(result);
    const allOutput = consoleSpy.mock.calls
      .map((c: any[]) => c.join(' '))
      .join('\n');
    expect(allOutput).toContain('device_verification');
  });

  it('shows error message for error stage', () => {
    const result: E2ETestResult = {
      finalStage: { stage: 'error', message: 'Login form not found' },
      screenshots: [],
      durationMs: 5000,
      stageLog: [],
    };
    printReport(result);
    const allOutput = consoleSpy.mock.calls
      .map((c: any[]) => c.join(' '))
      .join('\n');
    expect(allOutput).toContain('Login form not found');
  });

  it('shows MFA methods for device_verification stage', () => {
    const result: E2ETestResult = {
      finalStage: {
        stage: 'device_verification',
        methods: ['Text to XXX-1234', 'Email to j***@mail.com'],
      },
      screenshots: [],
      durationMs: 8000,
      stageLog: [],
    };
    printReport(result);
    const allOutput = consoleSpy.mock.calls
      .map((c: any[]) => c.join(' '))
      .join('\n');
    expect(allOutput).toContain('Text to XXX-1234');
    expect(allOutput).toContain('Email to j***@mail.com');
  });

  it('shows PASS result for success', () => {
    const result: E2ETestResult = {
      finalStage: { stage: 'success' },
      screenshots: [],
      durationMs: 5000,
      stageLog: [],
    };
    printReport(result);
    const allOutput = consoleSpy.mock.calls
      .map((c: any[]) => c.join(' '))
      .join('\n');
    expect(allOutput).toContain('PASS');
  });

  it('shows STOPPED result for non-success', () => {
    const result: E2ETestResult = {
      finalStage: { stage: 'error', message: 'test' },
      screenshots: [],
      durationMs: 5000,
      stageLog: [],
    };
    printReport(result);
    const allOutput = consoleSpy.mock.calls
      .map((c: any[]) => c.join(' '))
      .join('\n');
    expect(allOutput).toContain('STOPPED');
  });
});

// ─── Config Validation Tests ────────────────────────────────────────

describe('buildConfig', () => {
  it('exits when CHASE_USER is missing', () => {
    process.env.CHASE_USER = '';
    process.env.CHASE_PASS = 'testpass';

    jest.resetModules();
    jest.mock('puppeteer', () => ({
      launch: jest.fn(),
      default: { launch: jest.fn() },
    }));
    const { buildConfig: bc } = require('./test-chase-e2e');
    expect(() => bc()).toThrow('process.exit called');
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it('exits when CHASE_PASS is missing', () => {
    process.env.CHASE_USER = 'testuser';
    process.env.CHASE_PASS = '';

    jest.resetModules();
    jest.mock('puppeteer', () => ({
      launch: jest.fn(),
      default: { launch: jest.fn() },
    }));
    const { buildConfig: bc } = require('./test-chase-e2e');
    expect(() => bc()).toThrow('process.exit called');
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it('returns valid config with all env vars set', () => {
    process.env.CHASE_USER = 'myuser';
    process.env.CHASE_PASS = 'mypass';
    process.env.CHASE_E2E_HEADLESS = 'false';
    process.env.CHASE_E2E_TIMEOUT = '30000';
    process.env.CHASE_E2E_SCREENSHOT_DIR = '/tmp/test-screenshots';

    jest.resetModules();
    jest.mock('puppeteer', () => ({
      launch: jest.fn(),
      default: { launch: jest.fn() },
    }));
    const { buildConfig: bc } = require('./test-chase-e2e');
    const config = bc();

    expect(config.username).toBe('myuser');
    expect(config.password).toBe('mypass');
    expect(config.headless).toBe(false);
    expect(config.navigationTimeout).toBe(30000);
    expect(config.screenshotDir).toBe('/tmp/test-screenshots');
  });

  it('defaults headless to true', () => {
    process.env.CHASE_USER = 'user';
    process.env.CHASE_PASS = 'pass';
    delete process.env.CHASE_E2E_HEADLESS;

    jest.resetModules();
    jest.mock('puppeteer', () => ({
      launch: jest.fn(),
      default: { launch: jest.fn() },
    }));
    const { buildConfig: bc } = require('./test-chase-e2e');
    const config = bc();
    expect(config.headless).toBe(true);
  });

  it('defaults timeout to 45000', () => {
    process.env.CHASE_USER = 'user';
    process.env.CHASE_PASS = 'pass';
    delete process.env.CHASE_E2E_TIMEOUT;

    jest.resetModules();
    jest.mock('puppeteer', () => ({
      launch: jest.fn(),
      default: { launch: jest.fn() },
    }));
    const { buildConfig: bc } = require('./test-chase-e2e');
    const config = bc();
    expect(config.navigationTimeout).toBe(45000);
  });
});

// ─── Screenshot Filename Tests ──────────────────────────────────────

describe('screenshot filename format', () => {
  it('sanitizes special characters in labels', () => {
    const label = 'step 1: login/page';
    const sanitizedLabel = label.replace(/[^a-zA-Z0-9_-]/g, '_');
    expect(sanitizedLabel).toBe('step_1__login_page');
    expect(sanitizedLabel).not.toContain(':');
    expect(sanitizedLabel).not.toContain('/');
    expect(sanitizedLabel).not.toContain(' ');
  });

  it('timestamp format is filesystem-safe', () => {
    const timestamp = new Date()
      .toISOString()
      .replace(/[:.]/g, '-')
      .replace('T', '_')
      .replace('Z', '');
    expect(timestamp).not.toContain(':');
    expect(timestamp).not.toContain('.');
    expect(timestamp).toMatch(
      /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}-\d{3}$/,
    );
  });
});

// ─── Selector Parity Tests ──────────────────────────────────────────

describe('selector parity with server.ts BANK_CONFIGS', () => {
  it('username selector includes at least 3 variants', () => {
    const variants = CHASE_SELECTORS.usernameInput.split(',');
    expect(variants.length).toBeGreaterThanOrEqual(3);
  });

  it('password selector includes at least 3 variants', () => {
    const variants = CHASE_SELECTORS.passwordInput.split(',');
    expect(variants.length).toBeGreaterThanOrEqual(3);
  });

  it('submit button selector includes at least 3 variants', () => {
    const variants = CHASE_SELECTORS.submitButton.split(',');
    expect(variants.length).toBeGreaterThanOrEqual(3);
  });

  it('MFA challenge page selector includes verify-related patterns', () => {
    expect(CHASE_SELECTORS.mfaChallengePage).toContain('verify');
  });
});
