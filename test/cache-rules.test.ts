/**
 * `data/caching.json` against `data/pricing.json`.
 *
 * These tests pin the facts the whole Cost Advisor rests on, so that a future
 * re-verification that changes a number has to change a test too.
 * Every figure below was read from the provider's own documentation on
 * 2026-09-03 (see `docs_url` / `source_url` in the data files).
 */
import { describe, expect, it } from 'vitest';
import {
  allModels,
  cacheReadPricePerMtok,
  cacheWritePricePerMtok,
  getModel,
} from '../src/core/pricing';
import {
  caching,
  minCacheableTokens,
  providerCacheRules,
  ttlsForModel,
} from '../src/core/cache-advisor/rules';

describe('caching data', () => {
  it('is dated and covers the three providers', () => {
    expect(caching.last_verified).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    for (const provider of ['anthropic', 'openai', 'gemini'] as const) {
      const rules = providerCacheRules(provider);
      expect(rules.docs_url).toMatch(/^https:\/\//);
      expect(rules.pricing_url).toMatch(/^https:\/\//);
      expect(rules.last_verified).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(rules.ttls.length).toBeGreaterThan(0);
    }
  });

  it('gives every priced model a minimum and at least one resolvable TTL', () => {
    for (const model of allModels()) {
      expect(minCacheableTokens(model)).toBeGreaterThan(0);
      const ttls = ttlsForModel(model);
      expect(ttls.length).toBeGreaterThan(0);
      for (const ttl of ttls) expect(ttl.seconds).toBeGreaterThan(0);
    }
  });

  it('records the per-model minimum cacheable prefix Anthropic publishes', () => {
    // "512 tokens for … Claude Opus 5 … 1,024 tokens for … Claude Sonnet 5 …
    //  4,096 tokens for Claude Haiku 4.5"
    expect(minCacheableTokens({ id: 'claude-opus-5' })).toBe(512);
    expect(minCacheableTokens({ id: 'claude-sonnet-5' })).toBe(1024);
    expect(minCacheableTokens({ id: 'claude-haiku-4-5' })).toBe(4096);
  });

  it('records OpenAI 1,024 tokens from GPT-5.6 on, 2,048 before it', () => {
    expect(minCacheableTokens({ id: 'gpt-5.6-sol' })).toBe(1024);
    expect(minCacheableTokens({ id: 'gpt-5.6-luna' })).toBe(1024);
    expect(minCacheableTokens({ id: 'gpt-5' })).toBe(2048);
    expect(minCacheableTokens({ id: 'gpt-4o' })).toBe(2048);
  });

  it('records Gemini 2.5 at 2,048 tokens with a 1-hour default TTL', () => {
    expect(minCacheableTokens({ id: 'gemini-2.5-pro' })).toBe(2048);
    expect(minCacheableTokens({ id: 'gemini-2.5-flash' })).toBe(2048);
    const oneHour = ttlsForModel({ id: 'gemini-2.5-flash', provider: 'gemini' }).find(
      (t) => t.seconds === 3600,
    );
    expect(oneHour?.label).toContain('default');
  });

  it('models refresh-on-hit only where the provider documents it', () => {
    expect(providerCacheRules('anthropic').refresh_on_hit).toBe(true);
    expect(providerCacheRules('openai').refresh_on_hit).toBe(true);
    expect(providerCacheRules('gemini').refresh_on_hit).toBe(false);
  });

  it('bills storage only for Gemini', () => {
    expect(providerCacheRules('anthropic').storage_billed).toBe(false);
    expect(providerCacheRules('openai').storage_billed).toBe(false);
    expect(providerCacheRules('gemini').storage_billed).toBe(true);
  });
});

describe('cache prices against the published multipliers', () => {
  it('keeps Anthropic at 1.25x (5m), 2x (1h) writes and 0.1x reads', () => {
    for (const id of ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5']) {
      const model = getModel(id)!;
      expect(cacheWritePricePerMtok(model, 'anthropic-5m')).toBeCloseTo(
        model.input_per_mtok * 1.25,
      );
      expect(cacheWritePricePerMtok(model, 'anthropic-1h')).toBeCloseTo(model.input_per_mtok * 2);
      expect(cacheReadPricePerMtok(model)).toBeCloseTo(model.input_per_mtok * 0.1);
    }
  });

  it('keeps GPT-5.6 at 1.25x writes and 0.1x reads', () => {
    for (const id of ['gpt-5.6-sol', 'gpt-5.6-luna']) {
      const model = getModel(id)!;
      expect(cacheWritePricePerMtok(model)).toBeCloseTo(model.input_per_mtok * 1.25);
      expect(cacheReadPricePerMtok(model)).toBeCloseTo(model.input_per_mtok * 0.1);
    }
  });

  it('charges no cache-write premium on models older than GPT-5.6', () => {
    for (const id of ['gpt-5', 'gpt-5-mini', 'gpt-4o']) {
      const model = getModel(id)!;
      expect(model.cache_write_per_mtok).toBeUndefined();
      expect(cacheWritePricePerMtok(model)).toBe(model.input_per_mtok);
    }
    // GPT-5 reads at 0.1x, GPT-4o still at 0.5x.
    expect(cacheReadPricePerMtok(getModel('gpt-5')!)).toBeCloseTo(0.125);
    expect(cacheReadPricePerMtok(getModel('gpt-4o')!)).toBeCloseTo(1.25);
  });

  it('bills Gemini cache creation at the input rate, reads at 0.1x, plus storage', () => {
    for (const id of ['gemini-2.5-pro', 'gemini-2.5-flash']) {
      const model = getModel(id)!;
      expect(cacheWritePricePerMtok(model)).toBe(model.input_per_mtok);
      expect(cacheReadPricePerMtok(model)).toBeCloseTo(model.input_per_mtok * 0.1);
      expect(model.cache_storage_per_mtok_hour).toBeGreaterThan(0);
    }
  });
});
