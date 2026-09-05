/**
 * Picks the right counting strategy for a target model: exact `js-tiktoken`
 * for OpenAI, the real Gemini `models/{model}:countTokens` endpoint and the
 * real Anthropic `POST /v1/messages/count_tokens` endpoint when a key for that
 * provider is available, and the calibrated estimate otherwise.
 *
 * `apiKey` is the key for **this model's** provider — the caller is the one
 * that knows which of the (up to three) keys in play belongs to it. Passing
 * the wrong provider's key would only make the count fall back to the
 * estimate, never leak: each counter sends the key to its own endpoint only.
 */
import type { ModelPricing } from '../pricing';
import { countOpenAiTokens } from './openai';
import { countClaudeTokens, estimateClaudeTokens } from './claude';
import { countGeminiTokens } from './gemini';

export interface TokenCountResult {
  tokens: number;
  /** False when the count is a calibrated estimate rather than an exact count. */
  exact: boolean;
}

export async function countTokensForModel(
  text: string,
  model: Pick<ModelPricing, 'id' | 'provider'>,
  apiKey?: string,
): Promise<TokenCountResult> {
  if (model.provider === 'openai') {
    return { tokens: await countOpenAiTokens(text), exact: true };
  }
  if (model.provider === 'gemini') {
    const tokens = await countGeminiTokens(text, model.id, apiKey);
    return { tokens, exact: Boolean(apiKey) && Boolean(text) };
  }
  if (apiKey) {
    const tokens = await countClaudeTokens(text, model.id, apiKey);
    // The endpoint can fail and fall back; the estimate agreeing exactly with
    // the API is possible but rare, so treating a match as "estimated" only
    // ever understates confidence.
    return { tokens, exact: Boolean(text) && tokens !== estimateClaudeTokens(text) };
  }
  return { tokens: estimateClaudeTokens(text), exact: false };
}
