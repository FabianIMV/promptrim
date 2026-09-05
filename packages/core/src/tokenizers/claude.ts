/**
 * Calibrated token estimator for Claude models.
 *
 * Anthropic does not publish its tokenizer. With a key, `countClaudeTokens`
 * below calls the exact endpoint (`POST /v1/messages/count_tokens`); without
 * one, this estimator blends the two rough ratios Anthropic itself documents for
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

/**
 * Exact Claude token count, using the same key AI mode already collects.
 *
 * Verified on the official reference on 2026-09-03: `POST /v1/messages/count_tokens`
 * takes `model` + `messages`, returns `{ "input_tokens": number }`, and needs
 * the same headers as the Messages API — plus, from a browser, the direct
 * access header. https://platform.claude.com/docs/en/api/messages-count-tokens
 *
 * Any failure falls back to `estimateClaudeTokens`: a token badge is never
 * worth an error banner.
 *
 * The number counts the whole request, so it includes the few tokens Anthropic
 * adds to wrap a message. That is the honest figure for "what this prompt
 * costs on Claude", which is what the badge claims.
 */
export async function countClaudeTokens(
  text: string,
  model: string,
  apiKey?: string,
): Promise<number> {
  if (!text) return 0;
  if (!apiKey) return estimateClaudeTokens(text);

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages/count_tokens', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: text }] }),
    });
    if (!resp.ok) return estimateClaudeTokens(text);
    const data = (await resp.json()) as { input_tokens?: number };
    return typeof data.input_tokens === 'number' ? data.input_tokens : estimateClaudeTokens(text);
  } catch {
    return estimateClaudeTokens(text);
  }
}
