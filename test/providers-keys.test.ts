/**
 * The acceptance criterion of docs/PLAN.md §3 Phase 5 is literal: "no keys in
 * localStorage unless the user opts in". These tests hold the module to it,
 * including the case where storage itself throws (private browsing).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  forgetKeys,
  isRemembering,
  loadKey,
  loadKeys,
  saveKey,
  setRemembering,
} from '../src/providers/keys';

class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  get length() {
    return this.data.size;
  }
  clear() {
    this.data.clear();
  }
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  key(index: number) {
    return [...this.data.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
  setItem(key: string, value: string) {
    this.data.set(key, value);
  }
  /** Test-only view of everything stored. */
  dump() {
    return Object.fromEntries(this.data);
  }
}

let session: MemoryStorage;
let local: MemoryStorage;

beforeEach(() => {
  session = new MemoryStorage();
  local = new MemoryStorage();
  Object.defineProperty(globalThis, 'sessionStorage', { value: session, configurable: true });
  Object.defineProperty(globalThis, 'localStorage', { value: local, configurable: true });
});

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'sessionStorage');
  Reflect.deleteProperty(globalThis, 'localStorage');
});

describe('API key storage', () => {
  it('stores nothing at all by default', () => {
    expect(isRemembering()).toBe(false);
    saveKey('anthropic', 'sk-ant-secret');
    expect(session.dump()).toEqual({});
    expect(local.dump()).toEqual({});
    expect(loadKey('anthropic')).toBe('');
  });

  it('stores in sessionStorage — never localStorage — once opted in', () => {
    setRemembering(true, { anthropic: 'sk-ant-secret', openai: 'sk-openai' });

    expect(isRemembering()).toBe(true);
    expect(loadKey('anthropic')).toBe('sk-ant-secret');
    expect(loadKeys()).toEqual({ anthropic: 'sk-ant-secret', openai: 'sk-openai' });
    expect(JSON.stringify(local.dump())).not.toContain('sk-');
    expect(local.dump()).toEqual({});
  });

  it('keeps saving keys entered after the opt-in', () => {
    setRemembering(true);
    saveKey('gemini', 'AIza-secret');
    expect(loadKey('gemini')).toBe('AIza-secret');
  });

  it('forgets everything when the opt-in is turned off', () => {
    setRemembering(true, { anthropic: 'sk-ant-secret' });
    setRemembering(false);

    expect(isRemembering()).toBe(false);
    expect(session.dump()).toEqual({});
    expect(loadKey('anthropic')).toBe('');
  });

  it('also wipes a key an older build may have left in localStorage', () => {
    local.setItem('promptrim.key.openai', 'sk-legacy');
    forgetKeys();
    expect(local.dump()).toEqual({});
  });

  it('clears a provider’s key when it is emptied', () => {
    setRemembering(true, { openai: 'sk-openai' });
    saveKey('openai', '');
    expect(loadKey('openai')).toBe('');
    expect(JSON.stringify(session.dump())).not.toContain('sk-openai');
  });

  it('never reads a key back while the opt-in is off, even if one is present', () => {
    // Simulates a stale value from a previous opt-in within the same tab.
    session.setItem('promptrim.key.anthropic', 'sk-stale');
    expect(isRemembering()).toBe(false);
    expect(loadKey('anthropic')).toBe('');
    expect(loadKeys()).toEqual({});
  });

  it('degrades quietly when storage throws (private mode)', () => {
    const throwing = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
      removeItem: () => {
        throw new Error('denied');
      },
    };
    Object.defineProperty(globalThis, 'sessionStorage', { value: throwing, configurable: true });

    expect(() => setRemembering(true, { anthropic: 'sk' })).not.toThrow();
    expect(isRemembering()).toBe(false);
    expect(loadKey('anthropic')).toBe('');
    expect(() => forgetKeys()).not.toThrow();
  });

  it('works with no storage at all (server-side rendering, tests)', () => {
    Reflect.deleteProperty(globalThis, 'sessionStorage');
    Reflect.deleteProperty(globalThis, 'localStorage');
    expect(isRemembering()).toBe(false);
    expect(() => saveKey('anthropic', 'sk')).not.toThrow();
    expect(loadKeys()).toEqual({});
  });
});
