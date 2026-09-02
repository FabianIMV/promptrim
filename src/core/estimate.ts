/**
 * Token and cost estimation — PLACEHOLDER.
 *
 * Phase 0 keeps the legacy heuristic so the UI has feature parity, but it is
 * knowingly wrong: `chars / 4` drifts badly on code and non-English text, and
 * the GPT-4o price below is the 2024 figure the old app hardcoded.
 *
 * Phase 1 replaces this module with `core/tokenizers/*` (exact o200k counts via
 * js-tiktoken, calibrated Claude estimation, Gemini countTokens) and a
 * `data/pricing.json` carrying a `last_verified` date. Do not build new
 * features on these numbers.
 */

/** @deprecated Replaced in Phase 1 by real per-provider tokenizers. */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

/** Legacy GPT-4o input price ($/1M tokens) carried over from `app.js`. */
export const LEGACY_GPT4O_INPUT_PRICE_PER_MTOK = 2.5;

/** @deprecated Replaced in Phase 1 by verified pricing data. */
export function estimateCostSaved(tokensSaved: number): number {
  return (tokensSaved / 1_000_000) * LEGACY_GPT4O_INPUT_PRICE_PER_MTOK;
}
