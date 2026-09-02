/**
 * Picks the right counting strategy for a target model: exact `js-tiktoken`
 * for OpenAI, the real Gemini `countTokens` endpoint when a key is available
 * (falling back to the calibrated estimate otherwise), and the calibrated
 * estimate for Claude (no key-less browser endpoint exists yet — Phase 5).
 */
import type { ModelPricing } from '../pricing';
import { countOpenAiTokens } from './openai';
import { estimateClaudeTokens } from './claude';
import { countGeminiTokens } from './gemini';

export interface TokenCountResult {
  tokens: number;
  /** False when the count is a calibrated estimate rather than an exact count. */
  exact: boolean;
}

export async function countTokensForModel(
  text: string,
  model: Pick<ModelPricing, 'id' | 'provider'>,
  geminiApiKey?: string,
): Promise<TokenCountResult> {
  if (model.provider === 'openai') {
    return { tokens: await countOpenAiTokens(text), exact: true };
  }
  if (model.provider === 'gemini') {
    const tokens = await countGeminiTokens(text, model.id, geminiApiKey);
    return { tokens, exact: Boolean(geminiApiKey) && Boolean(text) };
  }
  return { tokens: estimateClaudeTokens(text), exact: false };
}
