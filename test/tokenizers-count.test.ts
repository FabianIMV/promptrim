import { afterEach, describe, expect, it, vi } from 'vitest';
import { countTokensForModel } from '../packages/core/src/tokenizers/count';
import { estimateClaudeTokens } from '../packages/core/src/tokenizers/claude';
import { countOpenAiTokens } from '../packages/core/src/tokenizers/openai';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('countTokensForModel', () => {
  it('routes anthropic models to the calibrated estimate (not exact)', async () => {
    const text = 'A reasonably long system prompt to estimate.';
    const result = await countTokensForModel(text, {
      id: 'claude-sonnet-5',
      provider: 'anthropic',
    });
    expect(result).toEqual({ tokens: estimateClaudeTokens(text), exact: false });
  });

  it('routes openai models to the exact tiktoken count', async () => {
    const text = 'Exact token count please.';
    const result = await countTokensForModel(text, { id: 'gpt-5', provider: 'openai' });
    expect(result).toEqual({ tokens: await countOpenAiTokens(text), exact: true });
  });

  it('routes gemini models without a key to the estimate, marked inexact', async () => {
    const text = 'No API key supplied here.';
    const result = await countTokensForModel(text, { id: 'gemini-2.5-flash', provider: 'gemini' });
    expect(result).toEqual({ tokens: estimateClaudeTokens(text), exact: false });
  });

  it('routes gemini models with a key to the real endpoint, marked exact', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ totalTokens: 7 }),
    }) as never;

    const result = await countTokensForModel(
      'hi',
      { id: 'gemini-2.5-flash', provider: 'gemini' },
      'a-key',
    );
    expect(result).toEqual({ tokens: 7, exact: true });
  });
});

describe('countTokensForModel — Anthropic with a key (Phase 5)', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('routes anthropic models with a key to the real endpoint, marked exact', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ input_tokens: 11 }),
    }) as never;

    const result = await countTokensForModel(
      'hi',
      { id: 'claude-opus-5', provider: 'anthropic' },
      'sk-ant',
    );
    expect(result).toEqual({ tokens: 11, exact: true });
  });

  it('marks the count inexact when the endpoint failed and the estimate answered', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401 }) as never;

    const text = 'Never disclose the key.';
    const result = await countTokensForModel(
      text,
      { id: 'claude-opus-5', provider: 'anthropic' },
      'sk-ant-bad',
    );
    expect(result).toEqual({ tokens: estimateClaudeTokens(text), exact: false });
  });
});
