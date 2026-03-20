/**
 * Chrome Binary Validator
 *
 * Verifies that the Puppeteer-managed Chrome binary is available before
 * the server accepts connections. If Chrome is missing, attempts automatic
 * installation via `npx puppeteer browsers install chrome`.
 *
 * Invariant: After ensureChromeBinary() resolves, a valid Chrome binary
 * exists at the path returned by puppeteer.executablePath().
 */

import { existsSync } from 'fs';
import { execSync } from 'child_process';

// ─── Types ──────────────────────────────────────────────────────────

export interface ChromeValidationResult {
  readonly available: true;
  readonly chromePath: string;
  readonly chromeVersion: string;
  readonly wasInstalled: boolean;
}

// ─── Pure helpers ───────────────────────────────────────────────────

/** Returns the Chrome executable path that Puppeteer expects. */
export function getChromePath(): string {
  // Dynamic require so the module can be mocked in tests
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const puppeteer = require('puppeteer');
  return puppeteer.executablePath();
}

/** Returns true when a file exists at `chromePath`. */
export function chromeBinaryExists(chromePath: string): boolean {
  return existsSync(chromePath);
}

/** Runs `chrome --version` and returns the output, or 'unknown' on failure. */
export function getChromeVersion(chromePath: string): string {
  try {
    return execSync(`"${chromePath}" --version 2>/dev/null`, {
      timeout: 10_000,
    })
      .toString()
      .trim();
  } catch {
    return 'unknown';
  }
}

// ─── Side-effectful helpers ─────────────────────────────────────────

/** Runs `npx puppeteer browsers install chrome`. Throws on failure. */
export function installChromeBrowser(): void {
  console.log('⏳ Chrome not found — installing via Puppeteer…');
  try {
    execSync('npx puppeteer browsers install chrome', {
      stdio: 'inherit',
      timeout: 300_000,
      cwd: __dirname,
    });
    console.log('✅ Chrome installation complete.');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Failed to install Chrome via Puppeteer: ${message}\n` +
        'Try running manually: npx puppeteer browsers install chrome',
    );
  }
}

// ─── Main entry point ───────────────────────────────────────────────

/**
 * Ensures a Chrome binary is available for Puppeteer.
 *
 * 1. Checks the path returned by `puppeteer.executablePath()`.
 * 2. If the binary exists → logs path + version and returns.
 * 3. If missing → runs automatic installation, then re-checks.
 * 4. If still missing after install → throws with an actionable message.
 */
export async function ensureChromeBinary(): Promise<ChromeValidationResult> {
  const chromePath = getChromePath();

  // Happy path: Chrome already installed
  if (chromeBinaryExists(chromePath)) {
    const chromeVersion = getChromeVersion(chromePath);
    console.log(`✅ Chrome binary found: ${chromePath}`);
    console.log(`   Version: ${chromeVersion}`);
    return { available: true, chromePath, chromeVersion, wasInstalled: false };
  }

  // Attempt automatic installation
  console.warn(`⚠️  Chrome binary not found at: ${chromePath}`);
  installChromeBrowser();

  // Re-resolve path (may change after install)
  const newChromePath = getChromePath();
  if (!chromeBinaryExists(newChromePath)) {
    throw new Error(
      `Chrome binary still not found after installation.\n` +
        `  Expected path: ${newChromePath}\n` +
        `  Try running manually: npx puppeteer browsers install chrome\n` +
        `  Or set PUPPETEER_EXECUTABLE_PATH to a custom Chrome installation.`,
    );
  }

  const chromeVersion = getChromeVersion(newChromePath);
  console.log(`✅ Chrome binary installed: ${newChromePath}`);
  console.log(`   Version: ${chromeVersion}`);
  return { available: true, chromePath: newChromePath, chromeVersion, wasInstalled: true };
}
