import { describe, expect, it } from 'vitest';
import {
  allModels,
  costForTokens,
  getModel,
  pricing,
  projectedMonthlyCost,
} from '../packages/core/src/pricing';

describe('pricing data', () => {
  it('has a last_verified date and at least one model per provider', () => {
    expect(pricing.last_verified).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    for (const provider of ['anthropic', 'openai', 'gemini'] as const) {
      expect(allModels().some((m) => m.provider === provider)).toBe(true);
    }
  });

  it('gives every model a dated, sourced entry with positive prices', () => {
    for (const model of allModels()) {
      expect(model.last_verified).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(model.source_url).toMatch(/^https:\/\//);
      expect(model.input_per_mtok).toBeGreaterThan(0);
      expect(model.output_per_mtok).toBeGreaterThan(0);
    }
  });

  it('resolves a known model by id', () => {
    expect(getModel('claude-sonnet-5')?.label).toBe('Claude Sonnet 5');
  });

  it('returns undefined for an unknown model id', () => {
    expect(getModel('not-a-real-model')).toBeUndefined();
  });
});

describe('costForTokens', () => {
  it('computes dollars from a per-million-token price', () => {
    expect(costForTokens(1_000_000, 2)).toBeCloseTo(2);
    expect(costForTokens(500_000, 2)).toBeCloseTo(1);
    expect(costForTokens(0, 5)).toBe(0);
  });
});

describe('projectedMonthlyCost', () => {
  it('multiplies per-call cost by calls/day and 30 days', () => {
    // 3,000 saved tokens/call at Opus 5 input price ($5/MTok), 10,000 calls/day.
    const monthly = projectedMonthlyCost(3000, 5, 10_000);
    expect(monthly).toBeCloseTo(3000 * (5 / 1_000_000) * 10_000 * 30);
    expect(monthly).toBeCloseTo(4500);
  });
});
