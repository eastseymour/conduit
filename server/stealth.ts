/**
 * Browser Anti-Detection Stealth Module (CDT-10)
 *
 * Comprehensive fingerprint evasion for headless Puppeteer browsers.
 * Banks like Chase perform deep client-side fingerprinting that goes
 * beyond the UA string. This module patches every detectable surface:
 *
 * 1. User-Agent string (strip HeadlessChrome, match real Chrome version)
 * 2. navigator.webdriver → false
 * 3. navigator.plugins → realistic Chrome plugin array
 * 4. navigator.languages → ['en-US', 'en']
 * 5. navigator.platform → matches spoofed OS in UA
 * 6. navigator.vendor → 'Google Inc.'
 * 7. navigator.hardwareConcurrency → realistic core count
 * 8. navigator.deviceMemory → realistic memory
 * 9. window.chrome runtime object
 * 10. navigator.permissions.query (notifications)
 * 11. WebGL renderer/vendor strings → realistic GPU
 * 12. Canvas fingerprint noise injection
 * 13. Window outer dimensions → match viewport
 * 14. CDP (Chrome DevTools Protocol) runtime artifact removal
 * 15. Notification.permission default
 * 16. screen dimensions matching viewport
 *
 * Invariants:
 * - The UA version MUST match Puppeteer's actual Chrome version (extracted at runtime)
 * - navigator.platform MUST be consistent with the OS in the UA string
 * - WebGL strings MUST correspond to a real GPU that exists on the spoofed platform
 * - All patches are applied via evaluateOnNewDocument (before any bank JS runs)
 */

import type { Browser, Page } from 'puppeteer';

// ─── Types ──────────────────────────────────────────────────────────

/**
 * Configuration for the stealth patches.
 * All fields have sensible defaults for a macOS Chrome profile.
 */
export interface StealthConfig {
  /** The OS platform string for navigator.platform. Default: 'MacIntel' */
  readonly platform: string;
  /** The OS description for the UA string. Default: 'Macintosh; Intel Mac OS X 10_15_7' */
  readonly osPlatformUA: string;
  /** Original headless OS pattern to replace in UA. Default: /X11; Linux x86_64/ */
  readonly headlessOSPattern: RegExp;
  /** navigator.vendor string. Default: 'Google Inc.' */
  readonly vendor: string;
  /** navigator.hardwareConcurrency. Default: 8 */
  readonly hardwareConcurrency: number;
  /** navigator.deviceMemory (GB). Default: 8 */
  readonly deviceMemory: number;
  /** Viewport width. Default: 1280 */
  readonly viewportWidth: number;
  /** Viewport height. Default: 800 */
  readonly viewportHeight: number;
  /** WebGL vendor string. Default: 'Google Inc. (Apple)' */
  readonly webglVendor: string;
  /** WebGL renderer string. Default matches Apple GPU on macOS */
  readonly webglRenderer: string;
  /** Screen width. Default: 1440 */
  readonly screenWidth: number;
  /** Screen height. Default: 900 */
  readonly screenHeight: number;
  /** Screen color depth. Default: 24 */
  readonly screenColorDepth: number;
  /** Screen pixel depth. Default: 24 */
  readonly screenPixelDepth: number;
  /** Device pixel ratio. Default: 2 (Retina) */
  readonly devicePixelRatio: number;
}

/** The default stealth config: a convincing macOS Chrome profile */
export const DEFAULT_STEALTH_CONFIG: StealthConfig = {
  platform: 'MacIntel',
  osPlatformUA: 'Macintosh; Intel Mac OS X 10_15_7',
  headlessOSPattern: /X11; Linux x86_64/,
  vendor: 'Google Inc.',
  hardwareConcurrency: 8,
  deviceMemory: 8,
  viewportWidth: 1280,
  viewportHeight: 800,
  webglVendor: 'Google Inc. (Apple)',
  webglRenderer: 'ANGLE (Apple, Apple M1 Pro, OpenGL 4.1)',
  screenWidth: 1440,
  screenHeight: 900,
  screenColorDepth: 24,
  screenPixelDepth: 24,
  devicePixelRatio: 2,
};

// ─── UA Helpers ─────────────────────────────────────────────────────

/**
 * Extract the Chrome major version from Puppeteer's browser UA string.
 *
 * Postcondition: returns the version string (e.g. "146.0.7680.153")
 * or null if parsing fails.
 */
export function extractChromeVersion(ua: string): string | null {
  // Match HeadlessChrome/X.Y.Z.W or Chrome/X.Y.Z.W
  const match = ua.match(/(?:Headless)?Chrome\/(\d+\.\d+\.\d+\.\d+)/);
  return match?.[1] ?? null;
}

/**
 * Build a clean, non-detectable UA string from the headless one.
 *
 * Invariant: The Chrome version number is preserved from the real browser
 * so that `navigator.userAgent` version matches JS API version checks.
 *
 * @param headlessUA - The raw UA from Puppeteer's browser instance
 * @param config - Stealth configuration
 * @returns A cleaned UA string that looks like a normal desktop Chrome
 */
export function buildCleanUserAgent(
  headlessUA: string,
  config: StealthConfig = DEFAULT_STEALTH_CONFIG,
): string {
  return headlessUA
    .replace('HeadlessChrome/', 'Chrome/')
    .replace(config.headlessOSPattern, config.osPlatformUA);
}

// ─── Stealth Script (runs in browser context) ───────────────────────

/**
 * Generate the JavaScript source that runs in the browser context via
 * page.evaluateOnNewDocument(). This is a pure string so it can be
 * tested without a real browser.
 *
 * IMPORTANT: This function returns a string, not a function reference,
 * because evaluateOnNewDocument serializes functions and we need to
 * embed config values as literals.
 */
export function buildStealthScript(config: StealthConfig = DEFAULT_STEALTH_CONFIG): string {
  return `
    // ── CDT-10: Comprehensive browser anti-detection stealth ──
    // Applied via evaluateOnNewDocument — runs before any page JS.
    (function() {
      'use strict';

      // 1. navigator.webdriver → false
      Object.defineProperty(navigator, 'webdriver', {
        get: () => false,
        configurable: true,
      });

      // 2. navigator.platform → match spoofed OS
      Object.defineProperty(navigator, 'platform', {
        get: () => ${JSON.stringify(config.platform)},
        configurable: true,
      });

      // 3. navigator.vendor → 'Google Inc.' for Chrome
      Object.defineProperty(navigator, 'vendor', {
        get: () => ${JSON.stringify(config.vendor)},
        configurable: true,
      });

      // 4. navigator.plugins → realistic Chrome plugin array
      // Headless Chrome reports empty plugins; real Chrome has these.
      Object.defineProperty(navigator, 'plugins', {
        get: () => {
          var makePlugin = function(name, description, filename, mimeType) {
            var plugin = {
              name: name,
              description: description,
              filename: filename,
              length: 1,
              0: { type: mimeType, suffixes: '', description: description, enabledPlugin: null },
              item: function(i) { return i === 0 ? this[0] : null; },
              namedItem: function(n) { return n === mimeType ? this[0] : null; },
            };
            plugin[0].enabledPlugin = plugin;
            return plugin;
          };
          var plugins = [
            makePlugin('Chrome PDF Plugin', 'Portable Document Format', 'internal-pdf-viewer', 'application/x-google-chrome-pdf'),
            makePlugin('Chrome PDF Viewer', '', 'mhjfbmdgcfjbbpaeojofohoefgiehjai', 'application/pdf'),
            makePlugin('Native Client', '', 'internal-nacl-plugin', 'application/x-nacl'),
          ];
          plugins.refresh = function() {};
          plugins.item = function(i) { return plugins[i] || null; };
          plugins.namedItem = function(n) { for (var j = 0; j < plugins.length; j++) { if (plugins[j].name === n) return plugins[j]; } return null; };
          return plugins;
        },
        configurable: true,
      });

      // 5. navigator.mimeTypes → match plugins
      Object.defineProperty(navigator, 'mimeTypes', {
        get: () => {
          var mimeTypes = [
            { type: 'application/x-google-chrome-pdf', suffixes: 'pdf', description: 'Portable Document Format' },
            { type: 'application/pdf', suffixes: 'pdf', description: '' },
            { type: 'application/x-nacl', suffixes: '', description: 'Native Client Executable' },
          ];
          mimeTypes.item = function(i) { return mimeTypes[i] || null; };
          mimeTypes.namedItem = function(n) { for (var j = 0; j < mimeTypes.length; j++) { if (mimeTypes[j].type === n) return mimeTypes[j]; } return null; };
          mimeTypes.refresh = function() {};
          return mimeTypes;
        },
        configurable: true,
      });

      // 6. navigator.languages
      Object.defineProperty(navigator, 'languages', {
        get: () => ['en-US', 'en'],
        configurable: true,
      });

      // 7. navigator.hardwareConcurrency → realistic core count
      Object.defineProperty(navigator, 'hardwareConcurrency', {
        get: () => ${config.hardwareConcurrency},
        configurable: true,
      });

      // 8. navigator.deviceMemory → realistic memory (GB)
      Object.defineProperty(navigator, 'deviceMemory', {
        get: () => ${config.deviceMemory},
        configurable: true,
      });

      // 9. navigator.maxTouchPoints → 0 for desktop
      Object.defineProperty(navigator, 'maxTouchPoints', {
        get: () => 0,
        configurable: true,
      });

      // 10. window.chrome runtime — comprehensive fake
      window.chrome = {
        app: {
          isInstalled: false,
          InstallState: { INSTALLED: 'installed', NOT_INSTALLED: 'not_installed', DISABLED: 'disabled' },
          RunningState: { RUNNING: 'running', CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run' },
          getDetails: function() { return null; },
          getIsInstalled: function() { return false; },
        },
        runtime: {
          OnInstalledReason: {
            CHROME_UPDATE: 'chrome_update',
            INSTALL: 'install',
            SHARED_MODULE_UPDATE: 'shared_module_update',
            UPDATE: 'update',
          },
          OnRestartRequiredReason: { APP_UPDATE: 'app_update', OS_UPDATE: 'os_update', PERIODIC: 'periodic' },
          PlatformArch: { ARM: 'arm', MIPS: 'mips', MIPS64: 'mips64', X86_32: 'x86-32', X86_64: 'x86-64' },
          PlatformNaclArch: { ARM: 'arm', MIPS: 'mips', MIPS64: 'mips64', X86_32: 'x86-32', X86_64: 'x86-64' },
          PlatformOs: { ANDROID: 'android', CROS: 'cros', LINUX: 'linux', MAC: 'mac', OPENBSD: 'openbsd', WIN: 'win' },
          RequestUpdateCheckStatus: { NO_UPDATE: 'no_update', THROTTLED: 'throttled', UPDATE_AVAILABLE: 'update_available' },
          connect: function() { return { onDisconnect: { addListener: function() {} }, onMessage: { addListener: function() {} }, postMessage: function() {} }; },
          sendMessage: function() {},
          id: undefined,
        },
        csi: function() { return {}; },
        loadTimes: function() { return {}; },
      };

      // 11. navigator.permissions.query — patch notifications
      var origPermQuery = navigator.permissions.query.bind(navigator.permissions);
      navigator.permissions.query = function(desc) {
        if (desc.name === 'notifications') {
          return Promise.resolve({ state: Notification.permission, onchange: null });
        }
        return origPermQuery(desc);
      };

      // 12. Notification.permission default
      if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
        // Many fingerprinters check this — real browsers usually have 'denied' or 'default'
        // Leave as default (which is correct for a fresh browser profile)
      }

      // 13. WebGL vendor/renderer spoofing
      var getParameterProxyHandler = {
        apply: function(target, thisArg, argumentsList) {
          var param = argumentsList[0];
          var ctx = thisArg;
          // UNMASKED_VENDOR_WEBGL = 0x9245
          if (param === 0x9245) {
            return ${JSON.stringify(config.webglVendor)};
          }
          // UNMASKED_RENDERER_WEBGL = 0x9246
          if (param === 0x9246) {
            return ${JSON.stringify(config.webglRenderer)};
          }
          return Reflect.apply(target, thisArg, argumentsList);
        },
      };

      // Patch both WebGL and WebGL2 contexts
      var origGetContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function() {
        var ctx = origGetContext.apply(this, arguments);
        if (ctx && (arguments[0] === 'webgl' || arguments[0] === 'experimental-webgl' || arguments[0] === 'webgl2')) {
          // Only patch if not already patched
          if (!ctx.__stealthPatched) {
            var origGetParam = ctx.getParameter.bind(ctx);
            ctx.getParameter = new Proxy(origGetParam, getParameterProxyHandler);

            // Also patch the WEBGL_debug_renderer_info extension
            var origGetExtension = ctx.getExtension.bind(ctx);
            ctx.getExtension = function(name) {
              var ext = origGetExtension(name);
              if (name === 'WEBGL_debug_renderer_info' && ext) {
                // Return the extension — our getParameter proxy handles the values
                return ext;
              }
              return ext;
            };
            ctx.__stealthPatched = true;
          }
        }
        return ctx;
      };

      // 14. Canvas fingerprint noise — add subtle pixel noise to toDataURL/toBlob
      var origToDataURL = HTMLCanvasElement.prototype.toDataURL;
      HTMLCanvasElement.prototype.toDataURL = function() {
        var ctx = this.getContext('2d');
        if (ctx && this.width > 0 && this.height > 0) {
          // Add a single nearly-invisible pixel modification
          var imgData = ctx.getImageData(0, 0, 1, 1);
          // XOR the alpha channel of the first pixel with a small value
          // This is invisible but changes the fingerprint hash
          imgData.data[3] = imgData.data[3] ^ 1;
          ctx.putImageData(imgData, 0, 0);
        }
        return origToDataURL.apply(this, arguments);
      };

      var origToBlob = HTMLCanvasElement.prototype.toBlob;
      HTMLCanvasElement.prototype.toBlob = function() {
        var ctx = this.getContext('2d');
        if (ctx && this.width > 0 && this.height > 0) {
          var imgData = ctx.getImageData(0, 0, 1, 1);
          imgData.data[3] = imgData.data[3] ^ 1;
          ctx.putImageData(imgData, 0, 0);
        }
        return origToBlob.apply(this, arguments);
      };

      // 15. Window dimensions — outer must be >= inner (headless often has 0)
      Object.defineProperty(window, 'outerWidth', {
        get: () => ${config.screenWidth},
        configurable: true,
      });
      Object.defineProperty(window, 'outerHeight', {
        get: () => ${config.screenHeight},
        configurable: true,
      });

      // 16. Screen dimensions
      var screenProps = {
        width: ${config.screenWidth},
        height: ${config.screenHeight},
        availWidth: ${config.screenWidth},
        availHeight: ${config.screenHeight - 25}, // minus macOS menu bar
        colorDepth: ${config.screenColorDepth},
        pixelDepth: ${config.screenPixelDepth},
        availLeft: 0,
        availTop: 25,
      };
      for (var prop in screenProps) {
        if (screenProps.hasOwnProperty(prop)) {
          Object.defineProperty(screen, prop, {
            get: (function(val) { return function() { return val; }; })(screenProps[prop]),
            configurable: true,
          });
        }
      }

      // 17. Device pixel ratio
      Object.defineProperty(window, 'devicePixelRatio', {
        get: () => ${config.devicePixelRatio},
        configurable: true,
      });

      // 18. Remove CDP artifacts (Chrome DevTools Protocol)
      // Banks scan for these well-known automation artifacts
      delete window.cdc_adoQpoasnfa76pfcZLmcfl_Array;
      delete window.cdc_adoQpoasnfa76pfcZLmcfl_Promise;
      delete window.cdc_adoQpoasnfa76pfcZLmcfl_Symbol;
      // Clean up all cdc_ prefixed properties
      for (var key in window) {
        if (key.match && key.match(/^cdc_/)) {
          try { delete window[key]; } catch(e) {}
        }
      }

      // 19. Patch iframe contentWindow access to propagate stealth
      // Some fingerprinters create iframes and check properties inside them
      var origCreateElement = document.createElement.bind(document);
      document.createElement = function() {
        var el = origCreateElement.apply(document, arguments);
        if (arguments[0] && arguments[0].toLowerCase() === 'iframe') {
          el.addEventListener('load', function() {
            try {
              if (el.contentWindow) {
                Object.defineProperty(el.contentWindow.navigator, 'webdriver', { get: () => false });
                Object.defineProperty(el.contentWindow.navigator, 'platform', { get: () => ${JSON.stringify(config.platform)} });
                Object.defineProperty(el.contentWindow.navigator, 'vendor', { get: () => ${JSON.stringify(config.vendor)} });
              }
            } catch(e) { /* cross-origin iframes will throw */ }
          });
        }
        return el;
      };

      // 20. Connection API (navigator.connection)
      if (!navigator.connection) {
        Object.defineProperty(navigator, 'connection', {
          get: () => ({
            effectiveType: '4g',
            rtt: 50,
            downlink: 10,
            saveData: false,
            onchange: null,
            addEventListener: function() {},
            removeEventListener: function() {},
          }),
          configurable: true,
        });
      }

    })();
  `;
}

// ─── Apply Stealth ──────────────────────────────────────────────────

/**
 * Apply all stealth patches to a Puppeteer page.
 *
 * Precondition: page must be a valid Puppeteer Page instance (not closed)
 * Postcondition: all fingerprint surfaces are patched before any navigation
 *
 * @param page - The Puppeteer page to patch
 * @param browser - The browser instance (used to extract real UA)
 * @param config - Optional stealth configuration overrides
 * @returns The cleaned user agent string that was set
 */
export async function applyStealthToPage(
  page: Page,
  browser: Browser,
  config: StealthConfig = DEFAULT_STEALTH_CONFIG,
): Promise<string> {
  // Get the real UA to extract the actual Chrome version
  const realUA = await browser.userAgent();
  const cleanUA = buildCleanUserAgent(realUA, config);

  // Set the cleaned UA
  await page.setUserAgent(cleanUA);

  // Set viewport with device scale factor
  await page.setViewport({
    width: config.viewportWidth,
    height: config.viewportHeight,
    deviceScaleFactor: config.devicePixelRatio,
  });

  // Inject all stealth patches before any page JS runs
  await page.evaluateOnNewDocument(buildStealthScript(config));

  // Also set extra HTTP headers to be consistent
  await page.setExtraHTTPHeaders({
    'Accept-Language': 'en-US,en;q=0.9',
    'sec-ch-ua-platform': `"macOS"`,
  });

  return cleanUA;
}

// ─── Puppeteer Launch Args ──────────────────────────────────────────

/**
 * Chrome launch arguments optimized for stealth.
 * Use these when calling puppeteer.launch({ args: STEALTH_LAUNCH_ARGS }).
 */
export const STEALTH_LAUNCH_ARGS: readonly string[] = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--window-size=1280,800',
  // Core anti-detection flags
  '--disable-blink-features=AutomationControlled',
  // Don't show automation infobar
  '--disable-infobars',
  // Disable extensions that might leak automation
  '--disable-extensions',
  // Use a more realistic window size
  '--start-maximized',
  // Disable features that reveal headless mode
  '--disable-features=IsolateOrigins,site-per-process,TranslateUI',
  // Disable web security only for cross-origin iframe access
  '--disable-web-security',
  // Pretend to have a GPU
  '--use-gl=swiftshader',
  // Disable automation-related switches
  '--disable-component-extensions-with-background-pages',
];
