/**
 * Tests for the CookieManager.
 */

import { CookieManager } from '../src/core/CookieManager';

describe('CookieManager', () => {
  let manager: CookieManager;

  beforeEach(() => {
    manager = new CookieManager();
  });

  describe('basic operations', () => {
    it('starts empty', async () => {
      const cookies = await manager.getCookies();
      expect(cookies).toEqual([]);
      expect(manager.getCookieCount()).toBe(0);
    });

    it('stores and retrieves cookies', async () => {
      await manager.setCookies([
        { name: 'session', value: 'abc123', domain: 'example.com' },
        { name: 'prefs', value: 'dark', domain: 'example.com' },
      ]);
      const cookies = await manager.getCookies();
      expect(cookies).toHaveLength(2);
      expect(manager.getCookieCount()).toBe(2);
    });

    it('skips cookies with empty names', async () => {
      await manager.setCookies([
        { name: '', value: 'empty' },
        { name: 'valid', value: 'yes' },
      ]);
      expect(manager.getCookieCount()).toBe(1);
    });

    it('overwrites cookies with same key', async () => {
      await manager.setCookies([
        { name: 'session', value: 'old', domain: 'example.com' },
      ]);
      await manager.setCookies([
        { name: 'session', value: 'new', domain: 'example.com' },
      ]);
      const cookies = await manager.getCookies();
      expect(cookies).toHaveLength(1);
      expect(cookies[0]!.value).toBe('new');
    });
  });

  describe('domain filtering', () => {
    it('filters by exact domain', async () => {
      await manager.setCookies([
        { name: 'a', value: '1', domain: 'example.com' },
        { name: 'b', value: '2', domain: 'other.com' },
      ]);
      const cookies = await manager.getCookies('example.com');
      expect(cookies).toHaveLength(1);
      expect(cookies[0]!.name).toBe('a');
    });

    it('matches subdomain cookies', async () => {
      await manager.setCookies([
        { name: 'a', value: '1', domain: 'example.com' },
      ]);
      const cookies = await manager.getCookies('sub.example.com');
      expect(cookies).toHaveLength(1);
    });

    it('includes cookies without domain', async () => {
      await manager.setCookies([
        { name: 'a', value: '1' },
      ]);
      const cookies = await manager.getCookies('anything.com');
      expect(cookies).toHaveLength(1);
    });
  });

  describe('expiration', () => {
    it('prunes expired cookies on access', async () => {
      await manager.setCookies([
        { name: 'expired', value: 'x', expires: Date.now() - 1000 },
        { name: 'valid', value: 'y', expires: Date.now() + 60000 },
      ]);
      const cookies = await manager.getCookies();
      expect(cookies).toHaveLength(1);
      expect(cookies[0]!.name).toBe('valid');
    });

    it('keeps cookies without expiry', async () => {
      await manager.setCookies([{ name: 'session', value: 'abc' }]);
      const cookies = await manager.getCookies();
      expect(cookies).toHaveLength(1);
    });
  });

  describe('clearCookies', () => {
    it('clears all cookies', async () => {
      await manager.setCookies([
        { name: 'a', value: '1' },
        { name: 'b', value: '2' },
      ]);
      await manager.clearCookies();
      expect(manager.getCookieCount()).toBe(0);
    });

    it('clears by domain', async () => {
      await manager.setCookies([
        { name: 'a', value: '1', domain: 'example.com' },
        { name: 'b', value: '2', domain: 'other.com' },
      ]);
      await manager.clearCookies('example.com');
      const cookies = await manager.getCookies();
      expect(cookies).toHaveLength(1);
      expect(cookies[0]!.domain).toBe('other.com');
    });
  });

  describe('persistence', () => {
    it('persists and loads cookies', async () => {
      let stored: string | null = null;
      manager.setPersistence({
        save: async (data) => { stored = data; },
        load: async () => stored,
        clear: async () => { stored = null; },
      });

      await manager.setCookies([{ name: 'session', value: 'abc', domain: 'bank.com' }]);
      await manager.persistCookies();
      expect(stored).not.toBeNull();

      // Create new manager, load persisted cookies
      const manager2 = new CookieManager();
      manager2.setPersistence({
        save: async (data) => { stored = data; },
        load: async () => stored,
        clear: async () => { stored = null; },
      });
      await manager2.loadCookies();
      const cookies = await manager2.getCookies();
      expect(cookies).toHaveLength(1);
      expect(cookies[0]!.name).toBe('session');
    });

    it('handles no persistence gracefully', async () => {
      // No persistence set — these should be no-ops
      await manager.persistCookies();
      await manager.loadCookies();
      expect(manager.getCookieCount()).toBe(0);
    });

    it('handles invalid persisted data', async () => {
      manager.setPersistence({
        save: async () => {},
        load: async () => 'not-valid-json{{{',
        clear: async () => {},
      });
      await manager.loadCookies();
      expect(manager.getCookieCount()).toBe(0);
    });
  });
});
