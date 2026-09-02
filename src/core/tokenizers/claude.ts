/**
 * Calibrated token estimator for Claude models.
 *
 * Anthropic does not publish its tokenizer, and the exact counting endpoint
 * (`POST /v1/messages/count_tokens`) needs an API key — wired up in Phase 5.
 * Until then this blends the two rough ratios Anthropic itself documents for
 * English text ("approximately 4 characters, or 0.75 words, per token" —
 * platform.claude.com/docs/en/about-claude/pricing, FAQ) and averages a
 * word-count estimate with a character-count estimate. That is the same
 * two-signal approach tokensift uses for its Claude estimate.
 *
 * Calibration (measured against the o200k_base fixtures in
 * test/fixtures/o200k-tokens.json, used as a same-family BPE proxy since no
 * public Claude reference corpus exists): mean absolute error is in the
 * 5-15% range for ordinary prose of a sentence or more, and worse — by
 * design, not a bug — on inputs the word/char ratio doesn't hold for: very
 * short strings (a couple of words), long digit runs, and long runs of
 * symbols with no alphabetic content.
 */
export function estimateClaudeTokens(text: string): number {
  if (!text) return 0;
  const wordCount = (text.match(/\S+/g) ?? []).length;
  if (wordCount === 0) return Math.max(1, Math.round(text.length / 4));
  const byWords = wordCount / 0.75;
  const byChars = text.length / 4;
  return Math.max(1, Math.round((byWords + byChars) / 2));
}
