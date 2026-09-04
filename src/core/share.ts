/**
 * Phase 6 — share a prompt by URL.
 *
 * The whole editor state that matters for reproducing a paste — the prompt
 * text and the compression level — is compressed with `lz-string` and put in
 * the URL *hash*, never the query string or path: a hash never leaves the
 * browser in an HTTP request, so a shared link cannot leak a prompt to
 * GitHub Pages' own server logs or any analytics that only sees the path.
 *
 * The API key is never part of this state. `App.tsx` only ever calls
 * `encodeShareState` with `{ input, level }` — there is no code path that can
 * reach a key from here, which is the property that matters more than any
 * comment saying so.
 */
import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string';
import type { Level } from './rules';

const SHARE_VERSION = 1;
const HASH_PREFIX = '#s=';

export interface ShareState {
  input: string;
  level: Level;
}

interface SharePayload extends ShareState {
  v: number;
}

/** Builds the `#s=...` hash fragment for the current prompt and level. */
export function encodeShareState(state: ShareState): string {
  const payload: SharePayload = { v: SHARE_VERSION, input: state.input, level: state.level };
  return HASH_PREFIX + compressToEncodedURIComponent(JSON.stringify(payload));
}

/**
 * Reads a `#s=...` hash fragment back into `{ input, level }`. Returns `null`
 * for anything that isn't a well-formed payload of this shape — a stale link
 * from a future version, a hand-edited hash, or no hash at all — so the
 * caller can fall back to an empty editor instead of showing broken state.
 */
export function decodeShareState(hash: string): ShareState | null {
  if (!hash.startsWith(HASH_PREFIX)) return null;
  const encoded = hash.slice(HASH_PREFIX.length);
  if (!encoded) return null;
  let json: string | null;
  try {
    json = decompressFromEncodedURIComponent(encoded);
  } catch {
    return null;
  }
  if (!json) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (!isSharePayload(parsed)) return null;
  return { input: parsed.input, level: parsed.level };
}

const VALID_LEVELS = new Set<string>(['light', 'balanced', 'aggressive']);

function isSharePayload(value: unknown): value is SharePayload {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    record.v === SHARE_VERSION &&
    typeof record.input === 'string' &&
    typeof record.level === 'string' &&
    VALID_LEVELS.has(record.level)
  );
}
