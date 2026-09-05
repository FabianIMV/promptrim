/**
 * What the compression call itself costs, shown *before* it runs.
 *
 * docs/PLAN.md §3 Phase 5, task 3: "the app must be coherent with its own
 * discourse". A tool that tells you to watch your token spend should not send
 * five API calls without saying what they cost.
 *
 * The estimate is built from the real prompt strings the pipeline will send —
 * not from a rule of thumb — counted with the same tokenizers the rest of the
 * app uses. Two things are necessarily approximate and are documented as such:
 *
 *  - **Output tokens.** The compressed prompt does not exist yet, so the
 *    original stands in for it. Compression only removes tokens, so this is an
 *    upper bound on the compression and repair calls.
 *  - **The repair calls.** They only happen when a critical constraint is
 *    lost, so the estimate has a floor (2 calls) and a ceiling (5).
 */

import { costForTokens, countTokensForModel, getModel } from '@promptrim/core';
import type { Constraint, Level, ModelPricing } from '@promptrim/core';
import {
  compressSystemPrompt,
  compressUserPrompt,
  repairSystemPrompt,
  repairUserPrompt,
  verifySystemPrompt,
  verifyUserPrompt,
} from './prompts';
import { MAX_CALLS, MAX_REPAIRS, MIN_CALLS } from './pipeline';
import type { ProviderId } from './types';

/** Output tokens the verifier spends per constraint, measured on the corpus. */
const VERIFY_TOKENS_PER_CONSTRAINT = 40;
const VERIFY_TOKENS_FLOOR = 64;

export interface AiCostEstimate {
  /** Cost of the two calls that always happen. */
  minUsd: number;
  /** Cost with both repair attempts and the re-verification. */
  maxUsd: number;
  minCalls: number;
  maxCalls: number;
  inputTokens: number;
  outputTokens: number;
  compressModel: ModelPricing;
  verifyModel: ModelPricing;
  /** False when any of the token counts is a calibrated estimate. */
  exact: boolean;
}

export interface AiCostInput {
  text: string;
  constraints: readonly Constraint[];
  level: Level;
  provider: ProviderId;
  compressModelId: string;
  verifyModelId: string;
  /** The user's key for this provider, when counting can use it. */
  apiKey?: string;
}

export async function estimateAiCost(input: AiCostInput): Promise<AiCostEstimate | null> {
  const compressModel = getModel(input.compressModelId);
  const verifyModel = getModel(input.verifyModelId);
  if (!compressModel || !verifyModel || !input.text.trim()) return null;

  const constraints = [...input.constraints];
  const count = (text: string, model: ModelPricing) =>
    countTokensForModel(text, model, input.apiKey);

  const compressPrompt =
    compressSystemPrompt(input.level, constraints) + '\n' + compressUserPrompt(input.text);
  // The compressed prompt does not exist yet; the original is its upper bound.
  const verifyPrompt =
    verifySystemPrompt() + '\n' + verifyUserPrompt(input.text, input.text, constraints);
  const repairPrompt =
    repairSystemPrompt() +
    '\n' +
    repairUserPrompt(
      input.text,
      constraints.filter((c) => c.severity === 'critical'),
    );

  const [compressIn, verifyIn, repairIn, body] = await Promise.all([
    count(compressPrompt, compressModel),
    count(verifyPrompt, verifyModel),
    count(repairPrompt, compressModel),
    count(input.text, compressModel),
  ]);

  const verifyOut = Math.max(
    VERIFY_TOKENS_FLOOR,
    constraints.length * VERIFY_TOKENS_PER_CONSTRAINT,
  );

  const compressCost =
    costForTokens(compressIn.tokens, compressModel.input_per_mtok) +
    costForTokens(body.tokens, compressModel.output_per_mtok);
  const verifyCost =
    costForTokens(verifyIn.tokens, verifyModel.input_per_mtok) +
    costForTokens(verifyOut, verifyModel.output_per_mtok);
  const repairCost =
    costForTokens(repairIn.tokens, compressModel.input_per_mtok) +
    costForTokens(body.tokens, compressModel.output_per_mtok);

  return {
    minUsd: compressCost + verifyCost,
    maxUsd: compressCost + verifyCost * 2 + repairCost * MAX_REPAIRS,
    minCalls: MIN_CALLS,
    maxCalls: MAX_CALLS,
    inputTokens: compressIn.tokens + verifyIn.tokens,
    outputTokens: body.tokens + verifyOut,
    compressModel,
    verifyModel,
    exact: compressIn.exact && verifyIn.exact && repairIn.exact && body.exact,
  };
}

/** Small amounts need more decimals than `toFixed(2)` gives. */
export function formatUsd(value: number): string {
  if (value === 0) return '$0';
  if (value < 0.01) return `$${value.toFixed(4)}`;
  if (value < 1) return `$${value.toFixed(3)}`;
  return `$${value.toFixed(2)}`;
}
