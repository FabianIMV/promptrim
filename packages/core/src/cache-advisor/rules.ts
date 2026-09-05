/**
 * Reads `src/data/caching.json` — how each provider's cache actually behaves,
 * copied from the official docs on `last_verified` and never from memory.
 *
 * Prices are not here: they live in `src/data/pricing.json`. This file holds the
 * behaviour that decides whether caching can work at all — the minimum
 * cacheable prefix per model, which TTLs exist, whether a hit refreshes the
 * lifetime for free, and whether storage is billed on top.
 */
import cachingData from '../data/caching.json';
import type { ModelPricing, Provider } from '../pricing';

export interface CacheTtl {
  id: string;
  label: string;
  seconds: number;
}

export interface ProviderCacheRules {
  provider: Provider;
  label: string;
  /** `explicit`: you place the breakpoint. `automatic`: the provider matches prefixes for you. */
  control: 'explicit' | 'automatic';
  control_note: string;
  /** True when reading a cached prefix extends its lifetime at no cost. */
  refresh_on_hit: boolean;
  refresh_quote: string;
  /** True when the provider bills for keeping the cache alive (Gemini). */
  storage_billed: boolean;
  break_even_quote: string;
  below_minimum_quote: string;
  breakpoint_hint: string;
  ttls: CacheTtl[];
  docs_url: string;
  pricing_url: string;
  last_verified: string;
}

export interface ModelCacheRules {
  min_cacheable_tokens: number;
  ttl_ids: string[];
}

export interface CachingData {
  last_verified: string;
  note: string;
  providers: ProviderCacheRules[];
  models: Record<string, ModelCacheRules>;
}

export const caching = cachingData as CachingData;

export function providerCacheRules(provider: Provider): ProviderCacheRules {
  const rules = caching.providers.find((p) => p.provider === provider);
  if (!rules) throw new Error(`No caching rules for provider "${provider}"`);
  return rules;
}

/** Minimum prefix, in tokens, below which the provider caches nothing. */
export function minCacheableTokens(model: Pick<ModelPricing, 'id'>): number | undefined {
  return caching.models[model.id]?.min_cacheable_tokens;
}

/** The TTLs available for a model, in the order they appear in `src/data/caching.json`. */
export function ttlsForModel(model: Pick<ModelPricing, 'id' | 'provider'>): CacheTtl[] {
  const rules = providerCacheRules(model.provider);
  const ids = caching.models[model.id]?.ttl_ids;
  if (!ids) return rules.ttls;
  return ids.map((id) => rules.ttls.find((t) => t.id === id)).filter((t): t is CacheTtl => !!t);
}
