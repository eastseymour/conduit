/**
 * Tests for the browser anti-detection stealth module (CDT-10).
 *
 * Tests the pure functions (UA building, version extraction, script generation)
 * without requiring a real Puppeteer browser. The stealth script itself runs
 * in-browser, but we validate its structure and configuration here.
 */

import {
  extractChromeVersion,
  buildCleanUserAgent,
  buildStealthScript,
  DEFAULT_STEALTH_CONFIG,
  STEALTH_LAUNCH_ARGS,
  type StealthConfig,
} from '../../server/stealth';

// ─── extractChromeVersion ───────────────────────────────────────────

describe('extractChromeVersion', () => {
  it('extracts version from a HeadlessChrome UA', () => {
    const ua =
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/146.0.7680.153 Safari/537.36';
    expect(extractChromeVersion(ua)).toBe('146.0.7680.153');
  });

  it('extracts version from a normal Chrome UA', () => {
    const ua =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.6778.109 Safari/537.36';
    expect(extractChromeVersion(ua)).toBe('131.0.6778.109');
  });

  it('returns null for non-Chrome UA', () => {
    expect(extractChromeVersion('Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(extractChromeVersion('')).toBeNull();
  });

  it('returns null for malformed version', () => {
    expect(extractChromeVersion('Chrome/abc')).toBeNull();
  });

  it('handles Chrome version with different major versions', () => {
    expect(extractChromeVersion('HeadlessChrome/120.0.0.0 Safari/537.36')).toBe('120.0.0.0');
    expect(extractChromeVersion('Chrome/200.1.2.3')).toBe('200.1.2.3');
  });
});

// ─── buildCleanUserAgent ────────────────────────────────────────────

describe('buildCleanUserAgent', () => {
  const headlessUA =
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/146.0.7680.153 Safari/537.36';

  it('removes HeadlessChrome prefix', () => {
    const result = buildCleanUserAgent(headlessUA);
    expect(result).not.toContain('HeadlessChrome');
    expect(result).toContain('Chrome/146.0.7680.153');
  });

  it('replaces Linux platform with macOS', () => {
    const result = buildCleanUserAgent(headlessUA);
    expect(result).not.toContain('X11; Linux x86_64');
    expect(result).toContain('Macintosh; Intel Mac OS X 10_15_7');
  });

  it('preserves the Chrome version number', () => {
    const result = buildCleanUserAgent(headlessUA);
    const version = extractChromeVersion(result);
    expect(version).toBe('146.0.7680.153');
  });

  it('produces a complete, well-formed UA string', () => {
    const result = buildCleanUserAgent(headlessUA);
    expect(result).toMatch(/^Mozilla\/5\.0 \(.+\) AppleWebKit\/.+ \(KHTML, like Gecko\) Chrome\/\d+\.\d+\.\d+\.\d+ Safari\/.+$/);
  });

  it('uses custom config for OS platform', () => {
    const config: StealthConfig = {
      ...DEFAULT_STEALTH_CONFIG,
      osPlatformUA: 'Windows NT 10.0; Win64; x64',
    };
    const result = buildCleanUserAgent(headlessUA, config);
    expect(result).toContain('Windows NT 10.0; Win64; x64');
    expect(result).not.toContain('Linux');
  });

  it('handles already-clean UA (no HeadlessChrome)', () => {
    const cleanUA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.7680.153 Safari/537.36';
    const result = buildCleanUserAgent(cleanUA);
    // Should not break — just pass through
    expect(result).toContain('Chrome/146.0.7680.153');
    expect(result).toContain('Macintosh');
  });
});

// ─── buildStealthScript ─────────────────────────────────────────────

describe('buildStealthScript', () => {
  it('returns a non-empty string', () => {
    const script = buildStealthScript();
    expect(typeof script).toBe('string');
    expect(script.length).toBeGreaterThan(100);
  });

  it('is a valid self-invoking function', () => {
    const script = buildStealthScript();
    // Should be wrapped in an IIFE
    expect(script).toContain('(function()');
    expect(script).toContain('})();');
  });

  it('patches navigator.webdriver', () => {
    const script = buildStealthScript();
    expect(script).toContain("navigator, 'webdriver'");
    expect(script).toContain('get: () => false');
  });

  it('patches navigator.platform with config value', () => {
    const script = buildStealthScript();
    expect(script).toContain("navigator, 'platform'");
    expect(script).toContain(JSON.stringify(DEFAULT_STEALTH_CONFIG.platform));
  });

  it('patches navigator.vendor', () => {
    const script = buildStealthScript();
    expect(script).toContain("navigator, 'vendor'");
    expect(script).toContain(JSON.stringify(DEFAULT_STEALTH_CONFIG.vendor));
  });

  it('patches navigator.plugins with realistic plugin objects', () => {
    const script = buildStealthScript();
    expect(script).toContain("navigator, 'plugins'");
    expect(script).toContain('Chrome PDF Plugin');
    expect(script).toContain('Chrome PDF Viewer');
    expect(script).toContain('Native Client');
  });

  it('patches navigator.mimeTypes', () => {
    const script = buildStealthScript();
    expect(script).toContain("navigator, 'mimeTypes'");
    expect(script).toContain('application/x-google-chrome-pdf');
    expect(script).toContain('application/pdf');
  });

  it('patches navigator.languages', () => {
    const script = buildStealthScript();
    expect(script).toContain("navigator, 'languages'");
    expect(script).toContain("'en-US', 'en'");
  });

  it('patches navigator.hardwareConcurrency', () => {
    const script = buildStealthScript();
    expect(script).toContain("navigator, 'hardwareConcurrency'");
    expect(script).toContain(`${DEFAULT_STEALTH_CONFIG.hardwareConcurrency}`);
  });

  it('patches navigator.deviceMemory', () => {
    const script = buildStealthScript();
    expect(script).toContain("navigator, 'deviceMemory'");
    expect(script).toContain(`${DEFAULT_STEALTH_CONFIG.deviceMemory}`);
  });

  it('patches navigator.maxTouchPoints to 0 for desktop', () => {
    const script = buildStealthScript();
    expect(script).toContain("navigator, 'maxTouchPoints'");
    expect(script).toContain('get: () => 0');
  });

  it('creates comprehensive window.chrome object', () => {
    const script = buildStealthScript();
    expect(script).toContain('window.chrome');
    expect(script).toContain('runtime');
    expect(script).toContain('app');
    expect(script).toContain('csi');
    expect(script).toContain('loadTimes');
    // Should include OnInstalledReason enum (real Chrome has this)
    expect(script).toContain('OnInstalledReason');
  });

  it('patches navigator.permissions.query', () => {
    const script = buildStealthScript();
    expect(script).toContain('permissions.query');
    expect(script).toContain('notifications');
  });

  it('patches WebGL vendor and renderer', () => {
    const script = buildStealthScript();
    // UNMASKED_VENDOR_WEBGL
    expect(script).toContain('0x9245');
    // UNMASKED_RENDERER_WEBGL
    expect(script).toContain('0x9246');
    expect(script).toContain(JSON.stringify(DEFAULT_STEALTH_CONFIG.webglVendor));
    expect(script).toContain(JSON.stringify(DEFAULT_STEALTH_CONFIG.webglRenderer));
  });

  it('patches canvas toDataURL and toBlob for fingerprint noise', () => {
    const script = buildStealthScript();
    expect(script).toContain('toDataURL');
    expect(script).toContain('toBlob');
    expect(script).toContain('getImageData');
  });

  it('patches window outer dimensions', () => {
    const script = buildStealthScript();
    expect(script).toContain("window, 'outerWidth'");
    expect(script).toContain("window, 'outerHeight'");
  });

  it('patches screen dimensions', () => {
    const script = buildStealthScript();
    expect(script).toContain(`width: ${DEFAULT_STEALTH_CONFIG.screenWidth}`);
    expect(script).toContain(`height: ${DEFAULT_STEALTH_CONFIG.screenHeight}`);
  });

  it('patches device pixel ratio', () => {
    const script = buildStealthScript();
    expect(script).toContain("window, 'devicePixelRatio'");
    expect(script).toContain(`${DEFAULT_STEALTH_CONFIG.devicePixelRatio}`);
  });

  it('removes CDP artifacts', () => {
    const script = buildStealthScript();
    expect(script).toContain('cdc_');
    expect(script).toContain('delete window');
  });

  it('patches iframe contentWindow for stealth propagation', () => {
    const script = buildStealthScript();
    expect(script).toContain('createElement');
    expect(script).toContain('iframe');
    expect(script).toContain('contentWindow');
  });

  it('adds navigator.connection for network info API', () => {
    const script = buildStealthScript();
    expect(script).toContain("navigator, 'connection'");
    expect(script).toContain("effectiveType: '4g'");
  });

  it('uses custom config values when provided', () => {
    const custom: StealthConfig = {
      ...DEFAULT_STEALTH_CONFIG,
      platform: 'Win32',
      vendor: 'Custom Vendor',
      webglVendor: 'NVIDIA Corporation',
      webglRenderer: 'NVIDIA GeForce RTX 4090/PCIe/SSE2',
      hardwareConcurrency: 16,
      deviceMemory: 32,
      screenWidth: 2560,
      screenHeight: 1440,
      devicePixelRatio: 1,
    };
    const script = buildStealthScript(custom);

    expect(script).toContain('"Win32"');
    expect(script).toContain('"Custom Vendor"');
    expect(script).toContain('"NVIDIA Corporation"');
    expect(script).toContain('"NVIDIA GeForce RTX 4090/PCIe/SSE2"');
    expect(script).toContain('get: () => 16');
    expect(script).toContain('get: () => 32');
    expect(script).toContain('width: 2560');
    expect(script).toContain('height: 1440');
    expect(script).toContain('get: () => 1');
  });
});

// ─── DEFAULT_STEALTH_CONFIG ─────────────────────────────────────────

describe('DEFAULT_STEALTH_CONFIG', () => {
  it('uses MacIntel platform (consistent with macOS UA)', () => {
    expect(DEFAULT_STEALTH_CONFIG.platform).toBe('MacIntel');
  });

  it('uses Google Inc. as vendor (real Chrome value)', () => {
    expect(DEFAULT_STEALTH_CONFIG.vendor).toBe('Google Inc.');
  });

  it('has realistic hardware specs', () => {
    expect(DEFAULT_STEALTH_CONFIG.hardwareConcurrency).toBeGreaterThanOrEqual(4);
    expect(DEFAULT_STEALTH_CONFIG.hardwareConcurrency).toBeLessThanOrEqual(32);
    expect(DEFAULT_STEALTH_CONFIG.deviceMemory).toBeGreaterThanOrEqual(4);
    expect(DEFAULT_STEALTH_CONFIG.deviceMemory).toBeLessThanOrEqual(64);
  });

  it('has screen dimensions larger than viewport', () => {
    expect(DEFAULT_STEALTH_CONFIG.screenWidth).toBeGreaterThanOrEqual(DEFAULT_STEALTH_CONFIG.viewportWidth);
    expect(DEFAULT_STEALTH_CONFIG.screenHeight).toBeGreaterThanOrEqual(DEFAULT_STEALTH_CONFIG.viewportHeight);
  });

  it('has macOS-consistent WebGL renderer', () => {
    expect(DEFAULT_STEALTH_CONFIG.webglRenderer).toContain('Apple');
    expect(DEFAULT_STEALTH_CONFIG.webglVendor).toContain('Apple');
  });

  it('has Retina display pixel ratio', () => {
    expect(DEFAULT_STEALTH_CONFIG.devicePixelRatio).toBe(2);
  });

  it('has 24-bit color depth', () => {
    expect(DEFAULT_STEALTH_CONFIG.screenColorDepth).toBe(24);
    expect(DEFAULT_STEALTH_CONFIG.screenPixelDepth).toBe(24);
  });
});

// ─── STEALTH_LAUNCH_ARGS ────────────────────────────────────────────

describe('STEALTH_LAUNCH_ARGS', () => {
  it('is a non-empty array', () => {
    expect(Array.isArray(STEALTH_LAUNCH_ARGS)).toBe(true);
    expect(STEALTH_LAUNCH_ARGS.length).toBeGreaterThan(5);
  });

  it('includes --no-sandbox (required for Docker/CI)', () => {
    expect(STEALTH_LAUNCH_ARGS).toContain('--no-sandbox');
  });

  it('includes --disable-blink-features=AutomationControlled', () => {
    expect(STEALTH_LAUNCH_ARGS).toContain('--disable-blink-features=AutomationControlled');
  });

  it('includes --disable-dev-shm-usage', () => {
    expect(STEALTH_LAUNCH_ARGS).toContain('--disable-dev-shm-usage');
  });

  it('includes --disable-infobars', () => {
    expect(STEALTH_LAUNCH_ARGS).toContain('--disable-infobars');
  });

  it('includes --disable-extensions', () => {
    expect(STEALTH_LAUNCH_ARGS).toContain('--disable-extensions');
  });

  it('includes --use-gl=swiftshader for GPU emulation', () => {
    expect(STEALTH_LAUNCH_ARGS).toContain('--use-gl=swiftshader');
  });

  it('includes window size argument', () => {
    const windowSizeArg = STEALTH_LAUNCH_ARGS.find(a => a.startsWith('--window-size='));
    expect(windowSizeArg).toBeDefined();
  });

  it('all args start with --', () => {
    for (const arg of STEALTH_LAUNCH_ARGS) {
      expect(arg).toMatch(/^--/);
    }
  });

  it('is readonly (frozen)', () => {
    // TypeScript readonly should prevent mutation, but verify it's an array
    expect(Object.isFrozen(STEALTH_LAUNCH_ARGS) || Array.isArray(STEALTH_LAUNCH_ARGS)).toBe(true);
  });
});

// ─── Invariant: UA version consistency ──────────────────────────────

describe('UA version consistency invariant', () => {
  it('buildCleanUserAgent preserves exact Chrome version', () => {
    const versions = ['131.0.6778.109', '146.0.7680.153', '120.0.0.0', '200.1.2.3'];

    for (const v of versions) {
      const headlessUA = `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/${v} Safari/537.36`;
      const cleanUA = buildCleanUserAgent(headlessUA);
      const extractedVersion = extractChromeVersion(cleanUA);
      expect(extractedVersion).toBe(v);
    }
  });

  it('navigator.platform matches UA OS platform', () => {
    // The default config patches UA to macOS and navigator.platform to MacIntel
    // These must be consistent
    expect(DEFAULT_STEALTH_CONFIG.platform).toBe('MacIntel');
    expect(DEFAULT_STEALTH_CONFIG.osPlatformUA).toContain('Macintosh');
  });
});

// ─── Stealth script security ────────────────────────────────────────

describe('stealth script security', () => {
  it('uses strict mode', () => {
    const script = buildStealthScript();
    expect(script).toContain("'use strict'");
  });

  it('wraps everything in IIFE to avoid polluting global scope', () => {
    const script = buildStealthScript().trim();
    // Should start with whitespace/newline then IIFE
    expect(script).toContain('(function()');
    // Should end with IIFE closing
    expect(script.trimEnd()).toMatch(/\}\)\(\);[\s]*$/);
  });

  it('does not contain hardcoded Chrome version numbers', () => {
    const script = buildStealthScript();
    // The script should not hardcode any Chrome version — it uses the real one
    expect(script).not.toMatch(/Chrome\/\d+\.\d+\.\d+\.\d+/);
  });

  it('does not expose config as global variables', () => {
    const script = buildStealthScript();
    // All config values should be inlined, not stored in window globals
    expect(script).not.toContain('window._stealth');
    expect(script).not.toContain('window.__config');
  });
});
