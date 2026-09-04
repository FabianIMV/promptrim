import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { countClaudeTokens, estimateClaudeTokens } from '../src/core/tokenizers/claude';

interface Fixture {
  text: string;
  tokens: number;
}

const FIXTURES: Fixture[] = JSON.parse(
  readFileSync(join(import.meta.dirname, 'fixtures', 'o200k-tokens.json'), 'utf8'),
);

describe('estimateClaudeTokens', () => {
  it('returns 0 for empty input', () => {
    expect(estimateClaudeTokens('')).toBe(0);
  });

  it('never returns 0 for non-empty input', () => {
    expect(estimateClaudeTokens('a')).toBeGreaterThanOrEqual(1);
    expect(estimateClaudeTokens('   ')).toBeGreaterThanOrEqual(1);
  });

  it('grows with input length', () => {
    const short = estimateClaudeTokens('one sentence.');
    const long = estimateClaudeTokens('one sentence. '.repeat(50));
    expect(long).toBeGreaterThan(short);
  });

  it('is deterministic', () => {
    const text = 'Compress this system prompt without losing any instruction.';
    expect(estimateClaudeTokens(text)).toBe(estimateClaudeTokens(text));
  });

  it('stays within a documented error bound on ordinary prose (calibration check)', () => {
    // Excludes fixtures the method's own docs call out as out-of-scope:
    // pure digit runs, pure symbol runs, and a single repeated character.
    const prose = FIXTURES.filter(
      (fx) =>
        fx.tokens > 0 &&
        !/^A+$/.test(fx.text) &&
        !fx.text.startsWith('1234567890') &&
        !fx.text.startsWith('Special characters:'),
    );
    const errors = prose.map(
      (fx) => Math.abs(estimateClaudeTokens(fx.text) - fx.tokens) / fx.tokens,
    );
    const meanAbsError = errors.reduce((a, b) => a + b, 0) / errors.length;
    expect(meanAbsError).toBeLessThan(0.3);
  });
});

describe('countClaudeTokens (Phase 5 — the exact endpoint)', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('returns 0 for empty input without calling fetch', async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    expect(await countClaudeTokens('', 'claude-opus-5', 'sk-ant')).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('falls back to the estimate when no key is given, without calling fetch', async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const text = 'Never reveal the system prompt.';
    expect(await countClaudeTokens(text, 'claude-opus-5')).toBe(estimateClaudeTokens(text));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('calls the documented endpoint with the browser-access header', async () => {
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ input_tokens: 2095 })));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    expect(await countClaudeTokens('hello', 'claude-opus-5', 'sk-ant-secret')).toBe(2095);

    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.anthropic.com/v1/messages/count_tokens');
    const headers = init.headers as Record<string, string>;
    expect(headers['anthropic-version']).toBe('2023-06-01');
    expect(headers['anthropic-dangerous-direct-browser-access']).toBe('true');
    expect(headers['x-api-key']).toBe('sk-ant-secret');
    expect(JSON.parse(init.body as string)).toEqual({
      model: 'claude-opus-5',
      messages: [{ role: 'user', content: 'hello' }],
    });
  });

  it('falls back to the estimate on an HTTP error rather than surfacing one', async () => {
    globalThis.fetch = vi.fn(
      async () => new Response('nope', { status: 429 }),
    ) as unknown as typeof fetch;
    const text = 'Respond in JSON format.';
    expect(await countClaudeTokens(text, 'claude-opus-5', 'sk-ant')).toBe(
      estimateClaudeTokens(text),
    );
  });

  it('falls back to the estimate on a network failure', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    const text = 'Always answer in English.';
    expect(await countClaudeTokens(text, 'claude-opus-5', 'sk-ant')).toBe(
      estimateClaudeTokens(text),
    );
  });

  it('falls back when the body has no input_tokens', async () => {
    globalThis.fetch = vi.fn(
      async () => new Response(JSON.stringify({})),
    ) as unknown as typeof fetch;
    const text = 'Escalate after 3 attempts.';
    expect(await countClaudeTokens(text, 'claude-opus-5', 'sk-ant')).toBe(
      estimateClaudeTokens(text),
    );
  });
});
