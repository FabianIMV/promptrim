/**
 * Reads `src/data/pricing.json` — per-model prices verified on each provider's
 * official pricing page, dated in `last_verified`. See that file's `note`
 * for the verification rule: never edit a number here from memory.
 */
import pricingData from './data/pricing.json';

export type Provider = 'anthropic' | 'openai' | 'gemini';

export interface ModelPricing {
  id: string;
  provider: Provider;
  label: string;
  input_per_mtok: number;
  output_per_mtok: number;
  /** OpenAI's name for the cache read (hit) price. */
  cached_input_per_mtok?: number;
  cache_write_5m_per_mtok?: number;
  cache_write_1h_per_mtok?: number;
  /** Anthropic "cache hits and refreshes" / Gemini "context caching" price. */
  cache_read_per_mtok?: number;
  /** Charged on the request that populates the cache, where the provider has one. */
  cache_write_per_mtok?: number;
  cache_storage_per_mtok_hour?: number;
  notes?: string;
  source_url: string;
  last_verified: string;
}

export interface PricingData {
  last_verified: string;
  note: string;
  models: ModelPricing[];
}

export const pricing = pricingData as PricingData;

export function allModels(): ModelPricing[] {
  return pricing.models;
}

export function getModel(id: string): ModelPricing | undefined {
  return pricing.models.find((m) => m.id === id);
}

/**
 * Price of one cached input token (a cache hit), per million tokens.
 *
 * The three providers name this differently — Anthropic "cache hits and
 * refreshes", OpenAI "cached input", Gemini "context caching" — but it is the
 * same thing: what a token already in the cache costs when it is read back.
 * Falls back to the plain input price when a model has no cache pricing.
 */
export function cacheReadPricePerMtok(model: ModelPricing): number {
  return model.cache_read_per_mtok ?? model.cached_input_per_mtok ?? model.input_per_mtok;
}

/**
 * Price of writing the prefix into the cache, per million tokens, for the TTL
 * named by `ttlId` (see `src/data/caching.json`).
 *
 * This is not a surcharge on top of a normal call: it is what those tokens cost
 * on the request that populates the cache. Anthropic charges 1.25x base for the
 * 5-minute TTL and 2x for the 1-hour one; OpenAI charges 1.25x on GPT-5.6 and
 * later and nothing extra before that; Gemini bills cache creation at the
 * standard input rate and charges storage separately.
 */
export function cacheWritePricePerMtok(model: ModelPricing, ttlId?: string): number {
  if (model.provider === 'anthropic') {
    const price =
      ttlId === 'anthropic-1h' ? model.cache_write_1h_per_mtok : model.cache_write_5m_per_mtok;
    return price ?? model.input_per_mtok;
  }
  return model.cache_write_per_mtok ?? model.input_per_mtok;
}

/** Cost, in USD, of `tokens` tokens at `pricePerMtok` dollars per million tokens. */
export function costForTokens(tokens: number, pricePerMtok: number): number {
  return (tokens / 1_000_000) * pricePerMtok;
}

/** Projected monthly cost of running `tokens` input tokens `callsPerDay` times a day. */
export function projectedMonthlyCost(
  tokens: number,
  pricePerMtok: number,
  callsPerDay: number,
): number {
  return costForTokens(tokens, pricePerMtok) * callsPerDay * 30;
}
