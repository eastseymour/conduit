/**
 * Tests for Chrome Binary Validator (CDT-8)
 *
 * Mocks fs, child_process, and puppeteer so we can exercise every
 * code path without touching the real filesystem or running Chrome.
 */

jest.mock('fs', () => ({ existsSync: jest.fn() }));
jest.mock('child_process', () => ({ execSync: jest.fn() }));
jest.mock('puppeteer', () => ({ executablePath: jest.fn() }));

import { existsSync } from 'fs';
import { execSync } from 'child_process';
import puppeteer from 'puppeteer';
import {
  getChromePath,
  chromeBinaryExists,
  getChromeVersion,
  installChromeBrowser,
  ensureChromeBinary,
} from './chrome-validator';

const mockExistsSync = existsSync as jest.MockedFunction<typeof existsSync>;
const mockExecSync = execSync as jest.MockedFunction<typeof execSync>;
const mockExecPath = (puppeteer as any).executablePath as jest.MockedFunction<() => string>;

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'log').mockImplementation();
  jest.spyOn(console, 'warn').mockImplementation();
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ─── getChromePath ──────────────────────────────────────────────────

describe('getChromePath', () => {
  it('returns the path from puppeteer.executablePath()', () => {
    mockExecPath.mockReturnValue('/usr/bin/chrome');
    expect(getChromePath()).toBe('/usr/bin/chrome');
  });
});

// ─── chromeBinaryExists ─────────────────────────────────────────────

describe('chromeBinaryExists', () => {
  it('returns true when the file exists', () => {
    mockExistsSync.mockReturnValue(true);
    expect(chromeBinaryExists('/usr/bin/chrome')).toBe(true);
    expect(mockExistsSync).toHaveBeenCalledWith('/usr/bin/chrome');
  });

  it('returns false when the file does not exist', () => {
    mockExistsSync.mockReturnValue(false);
    expect(chromeBinaryExists('/usr/bin/chrome')).toBe(false);
  });
});

// ─── getChromeVersion ───────────────────────────────────────────────

describe('getChromeVersion', () => {
  it('returns version string on success', () => {
    mockExecSync.mockReturnValue(Buffer.from('Google Chrome 120.0.6099.109\n'));
    expect(getChromeVersion('/usr/bin/chrome')).toBe('Google Chrome 120.0.6099.109');
  });

  it('returns "unknown" when the command fails', () => {
    mockExecSync.mockImplementation(() => {
      throw new Error('command not found');
    });
    expect(getChromeVersion('/usr/bin/chrome')).toBe('unknown');
  });
});

// ─── installChromeBrowser ───────────────────────────────────────────

describe('installChromeBrowser', () => {
  it('runs npx puppeteer browsers install chrome', () => {
    mockExecSync.mockReturnValue(Buffer.from(''));
    installChromeBrowser();
    expect(mockExecSync).toHaveBeenCalledWith(
      'npx puppeteer browsers install chrome',
      expect.objectContaining({ stdio: 'inherit', timeout: 300_000 }),
    );
  });

  it('throws with actionable message on failure', () => {
    mockExecSync.mockImplementation(() => {
      throw new Error('network error');
    });
    expect(() => installChromeBrowser()).toThrow(/Failed to install Chrome/);
    expect(() => installChromeBrowser()).toThrow(/npx puppeteer browsers install chrome/);
  });
});

// ─── ensureChromeBinary ─────────────────────────────────────────────

describe('ensureChromeBinary', () => {
  it('returns immediately when Chrome binary is found', async () => {
    mockExecPath.mockReturnValue('/usr/bin/chrome');
    mockExistsSync.mockReturnValue(true);
    // First call from getChromeVersion
    mockExecSync.mockReturnValue(Buffer.from('Google Chrome 120.0.6099.109\n'));

    const result = await ensureChromeBinary();

    expect(result).toEqual({
      available: true,
      chromePath: '/usr/bin/chrome',
      chromeVersion: 'Google Chrome 120.0.6099.109',
      wasInstalled: false,
    });
  });

  it('auto-installs Chrome when binary is missing', async () => {
    mockExecPath.mockReturnValue('/usr/bin/chrome');

    // First existsSync call: binary missing → triggers install
    // Second existsSync call (after install): binary present
    mockExistsSync.mockReturnValueOnce(false).mockReturnValueOnce(true);

    // First execSync: installChromeBrowser
    // Second execSync: getChromeVersion
    mockExecSync
      .mockReturnValueOnce(Buffer.from(''))                                // install
      .mockReturnValueOnce(Buffer.from('Google Chrome 120.0.6099.109\n')); // version

    const result = await ensureChromeBinary();

    expect(result).toEqual({
      available: true,
      chromePath: '/usr/bin/chrome',
      chromeVersion: 'Google Chrome 120.0.6099.109',
      wasInstalled: true,
    });
  });

  it('throws when Chrome is still missing after install', async () => {
    mockExecPath.mockReturnValue('/usr/bin/chrome');
    mockExistsSync.mockReturnValue(false);
    // install succeeds but binary still missing
    mockExecSync.mockReturnValue(Buffer.from(''));

    await expect(ensureChromeBinary()).rejects.toThrow(/Chrome binary still not found/);
  });

  it('throws when installation itself fails', async () => {
    mockExecPath.mockReturnValue('/usr/bin/chrome');
    mockExistsSync.mockReturnValue(false);
    mockExecSync.mockImplementation(() => {
      throw new Error('permission denied');
    });

    await expect(ensureChromeBinary()).rejects.toThrow(/Failed to install Chrome/);
  });
});
