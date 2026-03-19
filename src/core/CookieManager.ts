/**
 * CookieManager — Persists cookies across navigation steps.
 *
 * In-memory cookie storage with optional persistence callbacks.
 * The persistence mechanism (AsyncStorage, SecureStore, etc.)
 * is injected via callbacks to keep this module platform-agnostic.
 *
 * Invariants:
 * - Cookie names are non-empty strings
 * - Cookies are keyed by domain+path+name to avoid duplicates
 * - Expired cookies are pruned on access
 */

import type { CookieData } from '../types';

function cookieKey(cookie: CookieData): string {
  return `${cookie.domain ?? ''}|${cookie.path ?? '/'}|${cookie.name}`;
}

export interface CookiePersistenceCallbacks {
  save: (data: string) => Promise<void>;
  load: () => Promise<string | null>;
  clear: () => Promise<void>;
}

export class CookieManager {
  private cookies: Map<string, CookieData> = new Map();
  private persistence: CookiePersistenceCallbacks | null = null;

  setPersistence(callbacks: CookiePersistenceCallbacks): void {
    this.persistence = callbacks;
  }

  async getCookies(domain?: string): Promise<readonly CookieData[]> {
    this.pruneExpired();
    const all = Array.from(this.cookies.values());
    if (domain) {
      return all.filter((c) => !c.domain || c.domain === domain || domain.endsWith(`.${c.domain}`));
    }
    return all;
  }

  async setCookies(cookies: readonly CookieData[]): Promise<void> {
    for (const cookie of cookies) {
      if (!cookie.name) continue;
      this.cookies.set(cookieKey(cookie), cookie);
    }
  }

  async clearCookies(domain?: string): Promise<void> {
    if (domain) {
      for (const [key, cookie] of this.cookies) {
        if (!cookie.domain || cookie.domain === domain || domain.endsWith(`.${cookie.domain}`)) {
          this.cookies.delete(key);
        }
      }
    } else {
      this.cookies.clear();
    }
  }

  async persistCookies(): Promise<void> {
    if (!this.persistence) return;
    this.pruneExpired();
    await this.persistence.save(JSON.stringify(Array.from(this.cookies.values())));
  }

  async loadCookies(): Promise<void> {
    if (!this.persistence) return;
    const data = await this.persistence.load();
    if (!data) return;
    try {
      const cookies = JSON.parse(data) as CookieData[];
      if (Array.isArray(cookies)) {
        await this.setCookies(cookies);
        this.pruneExpired();
      }
    } catch {
      /* invalid data */
    }
  }

  getCookieCount(): number {
    return this.cookies.size;
  }

  private pruneExpired(): void {
    const now = Date.now();
    for (const [key, cookie] of this.cookies) {
      if (cookie.expires && cookie.expires < now) {
        this.cookies.delete(key);
      }
    }
  }
}
