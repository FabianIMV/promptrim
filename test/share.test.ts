import { describe, expect, it } from 'vitest';
import { compressToEncodedURIComponent } from 'lz-string';
import { decodeShareState, encodeShareState } from '../packages/core/src/share';

describe('encodeShareState / decodeShareState', () => {
  it('round-trips a prompt and level through the hash', () => {
    const state = { input: 'Please write a very detailed summary.', level: 'aggressive' as const };
    const hash = encodeShareState(state);
    expect(hash.startsWith('#s=')).toBe(true);
    expect(decodeShareState(hash)).toEqual(state);
  });

  it('round-trips unicode and multi-line prompts', () => {
    const state = {
      input: 'Responde en español.\nUsa un tono cálido — sin emojis 🙂.',
      level: 'light' as const,
    };
    expect(decodeShareState(encodeShareState(state))).toEqual(state);
  });

  it('never includes an API key: only input and level are ever encoded', () => {
    const hash = encodeShareState({ input: 'sk-ant-should-not-appear-here', level: 'balanced' });
    // The literal never appears unencoded, and the round trip proves the only
    // channel in is `{ input, level }` — there is no field an API key could
    // travel through even if a caller tried.
    expect(decodeShareState(hash)).toEqual({
      input: 'sk-ant-should-not-appear-here',
      level: 'balanced',
    });
    expect(Object.keys(decodeShareState(hash)!)).toEqual(['input', 'level']);
  });

  it('returns null for a hash without the #s= prefix', () => {
    expect(decodeShareState('#other=1')).toBeNull();
    expect(decodeShareState('')).toBeNull();
  });

  it('returns null for garbage after the prefix', () => {
    expect(decodeShareState('#s=not-valid-lzstring!!!')).toBeNull();
  });

  it('returns null for well-formed JSON missing the version or with an invalid level', () => {
    // A payload missing `v`, or with an invalid level, is rejected instead of
    // silently loading the wrong prompt from a stale/future link.
    const badVersion = `#s=${compressToEncodedURIComponent(JSON.stringify({ input: 'x', level: 'light' }))}`;
    expect(decodeShareState(badVersion)).toBeNull();

    const badLevel = `#s=${compressToEncodedURIComponent(JSON.stringify({ v: 1, input: 'x', level: 'extreme' }))}`;
    expect(decodeShareState(badLevel)).toBeNull();
  });
});
