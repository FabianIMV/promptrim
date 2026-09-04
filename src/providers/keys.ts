/**
 * Where API keys live.
 *
 * docs/PLAN.md §3 Phase 5, task 3: memory only by default, an explicit
 * "remember in this browser" opt-in, never in the URL, never in logs. This
 * module is the only place in the app allowed to write a key anywhere, which
 * is what makes that promise checkable.
 *
 * Three decisions:
 *
 *  - **`sessionStorage`, never `localStorage`.** Opting in survives a reload
 *    and dies with the tab. `localStorage` would outlive the visit on a shared
 *    machine, and the phase's acceptance criterion is explicitly "no keys in
 *    localStorage".
 *  - **The opt-in flag lives with the keys.** Storing "remember: true" in
 *    `localStorage` would silently re-arm persistence in a later visit that
 *    the user never opted into.
 *  - **Turning the opt-in off wipes what was stored**, including anything an
 *    older build of the app may have left in `localStorage`. Un-checking a box
 *    that says "remember" has to actually forget.
 */

import type { ProviderId } from './types';

const KEY_PREFIX = 'promptrim.key.';
const REMEMBER_FLAG = 'promptrim.rememberKeys';
const PROVIDER_IDS: readonly ProviderId[] = ['anthropic', 'openai', 'gemini'];

/**
 * Storage throws in some privacy modes and is absent under Node (tests), so
 * every access goes through this. A failure means "no stored key", never an
 * error the user sees.
 */
function store(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

function legacyStore(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function isRemembering(): boolean {
  try {
    return store()?.getItem(REMEMBER_FLAG) === 'true';
  } catch {
    return false;
  }
}

export function loadKey(provider: ProviderId): string {
  if (!isRemembering()) return '';
  try {
    return store()?.getItem(KEY_PREFIX + provider) ?? '';
  } catch {
    return '';
  }
}

/** No-op unless the user opted in. Callers do not have to check first. */
export function saveKey(provider: ProviderId, key: string): void {
  if (!isRemembering()) return;
  try {
    const storage = store();
    if (!storage) return;
    if (key) storage.setItem(KEY_PREFIX + provider, key);
    else storage.removeItem(KEY_PREFIX + provider);
  } catch {
    // Nothing to do: the key stays in memory for this session.
  }
}

/** Wipe every stored key, in both storages. */
export function forgetKeys(): void {
  for (const storage of [store(), legacyStore()]) {
    if (!storage) continue;
    try {
      for (const provider of PROVIDER_IDS) storage.removeItem(KEY_PREFIX + provider);
      storage.removeItem(REMEMBER_FLAG);
    } catch {
      // Ignore: unavailable storage holds nothing to forget.
    }
  }
}

/**
 * Turn the opt-in on or off. Turning it off forgets everything; turning it on
 * stores the keys the caller currently holds in memory.
 */
export function setRemembering(on: boolean, keys: Partial<Record<ProviderId, string>> = {}): void {
  if (!on) {
    forgetKeys();
    return;
  }
  try {
    const storage = store();
    if (!storage) return;
    storage.setItem(REMEMBER_FLAG, 'true');
    for (const provider of PROVIDER_IDS) {
      const key = keys[provider];
      if (key) storage.setItem(KEY_PREFIX + provider, key);
    }
  } catch {
    // Opting in is best-effort; the keys still work for this session.
  }
}

/** Every remembered key, for restoring state on load. */
export function loadKeys(): Partial<Record<ProviderId, string>> {
  const keys: Partial<Record<ProviderId, string>> = {};
  if (!isRemembering()) return keys;
  for (const provider of PROVIDER_IDS) {
    const key = loadKey(provider);
    if (key) keys[provider] = key;
  }
  return keys;
}
