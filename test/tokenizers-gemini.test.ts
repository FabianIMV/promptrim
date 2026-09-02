import { afterEach, describe, expect, it, vi } from 'vitest';
import { countGeminiTokens } from '../src/core/tokenizers/gemini';
import { estimateClaudeTokens } from '../src/core/tokenizers/claude';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('countGeminiTokens', () => {
  it('returns 0 for empty input without calling fetch', async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    expect(await countGeminiTokens('', 'gemini-2.5-flash')).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('falls back to the calibrated estimate when no API key is given', async () => {
    const text = 'Summarize this document in three bullet points.';
    const result = await countGeminiTokens(text, 'gemini-2.5-flash');
    expect(result).toBe(estimateClaudeTokens(text));
  });

  it('uses the exact countTokens response when a key is given', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ totalTokens: 42 }),
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const result = await countGeminiTokens('hello', 'gemini-2.5-flash', 'test-key');

    expect(result).toBe(42);
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('gemini-2.5-flash:countTokens'),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('falls back to the estimate when the API call fails', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }) as never;
    const text = 'Retry this request please.';
    expect(await countGeminiTokens(text, 'gemini-2.5-flash', 'bad-key')).toBe(
      estimateClaudeTokens(text),
    );
  });

  it('falls back to the estimate on a network error', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('offline')) as never;
    const text = 'Retry this request please.';
    expect(await countGeminiTokens(text, 'gemini-2.5-flash', 'a-key')).toBe(
      estimateClaudeTokens(text),
    );
  });

  it('falls back to the estimate when the response has no totalTokens', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }) as never;
    const text = 'Retry this request please.';
    expect(await countGeminiTokens(text, 'gemini-2.5-flash', 'a-key')).toBe(
      estimateClaudeTokens(text),
    );
  });
});
