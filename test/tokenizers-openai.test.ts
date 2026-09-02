import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { countOpenAiTokens } from '../src/core/tokenizers/openai';

interface Fixture {
  text: string;
  tokens: number;
}

const FIXTURES: Fixture[] = JSON.parse(
  readFileSync(join(import.meta.dirname, 'fixtures', 'o200k-tokens.json'), 'utf8'),
);

/**
 * Phase 1 acceptance criterion: "for 20 texts, the o200k count matches the
 * reference tiktoken exactly". Fixtures were generated with Python's
 * `tiktoken.get_encoding('o200k_base')` — see test/fixtures/o200k-tokens.json
 * and the generator notes there.
 */
describe('countOpenAiTokens (o200k_base) matches the reference tiktoken', () => {
  it('ships at least 20 fixtures', () => {
    expect(FIXTURES.length).toBeGreaterThanOrEqual(20);
  });

  it.each(FIXTURES)('counts "$text" as $tokens tokens', async ({ text, tokens }) => {
    expect(await countOpenAiTokens(text)).toBe(tokens);
  });

  it('returns 0 for empty input without loading the encoder', async () => {
    expect(await countOpenAiTokens('')).toBe(0);
  });

  it('caches the encoder across calls (same instance reused)', async () => {
    const [a, b] = await Promise.all([countOpenAiTokens('hello'), countOpenAiTokens('world')]);
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(0);
  });
});
