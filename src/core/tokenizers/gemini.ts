/**
 * Gemini token counting.
 *
 * With an API key, calls the real `models/{model}:countTokens` endpoint for
 * an exact count — the same key the UI already collects for AI mode
 * (`src/providers/gemini.ts`). Without one, falls back to the calibrated
 * word/char blend from `./claude`: Gemini's SentencePiece tokenizer has no
 * published error figure to calibrate against, but is close enough in
 * granularity to other BPE-style tokenizers that the same heuristic is a
 * reasonable stand-in rather than inventing a second, uncalibrated formula.
 */
import { estimateClaudeTokens } from './claude';

const API_ROOT = 'https://generativelanguage.googleapis.com/v1beta';

interface CountTokensResponse {
  totalTokens?: number;
}

export async function countGeminiTokens(
  text: string,
  model: string,
  apiKey?: string,
): Promise<number> {
  if (!text) return 0;
  if (!apiKey) return estimateClaudeTokens(text);

  try {
    const resp = await fetch(`${API_ROOT}/models/${model}:countTokens`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text }] }] }),
    });
    if (!resp.ok) return estimateClaudeTokens(text);
    const data = (await resp.json()) as CountTokensResponse;
    return typeof data.totalTokens === 'number' ? data.totalTokens : estimateClaudeTokens(text);
  } catch {
    return estimateClaudeTokens(text);
  }
}
