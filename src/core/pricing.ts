/**
 * Reads `data/pricing.json` — per-model prices verified on each provider's
 * official pricing page, dated in `last_verified`. See that file's `note`
 * for the verification rule: never edit a number here from memory.
 */
import pricingData from '../../data/pricing.json';

export type Provider = 'anthropic' | 'openai' | 'gemini';

export interface ModelPricing {
  id: string;
  provider: Provider;
  label: string;
  input_per_mtok: number;
  output_per_mtok: number;
  cached_input_per_mtok?: number;
  cache_write_5m_per_mtok?: number;
  cache_write_1h_per_mtok?: number;
  cache_read_per_mtok?: number;
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
