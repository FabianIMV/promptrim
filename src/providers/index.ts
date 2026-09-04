import { anthropicProvider } from './anthropic';
import { openAiProvider } from './openai';
import { geminiProvider } from './gemini';
import type { ProviderClient, ProviderId } from './types';

/**
 * AI-mode providers, in the order the picker shows them. Anthropic is first
 * because it is the default of docs/PLAN.md §3 Phase 5 (`claude-opus-5`).
 */
export const PROVIDERS: readonly ProviderClient[] = [
  anthropicProvider,
  openAiProvider,
  geminiProvider,
];

export const DEFAULT_PROVIDER_ID: ProviderId = 'anthropic';

export function getProvider(id: string): ProviderClient | undefined {
  return PROVIDERS.find((provider) => provider.id === id);
}

export { anthropicProvider, openAiProvider, geminiProvider };
export { ProviderError } from './types';
export type {
  CallOptions,
  JsonSchema,
  ProviderClient,
  ProviderId,
  StructuredRequest,
  StructuredResponse,
  TokenUsage,
} from './types';
export { COMPRESS_SCHEMA, REPAIR_SCHEMA, VERIFY_SCHEMA, toGeminiSchema } from './schemas';
export {
  compressSystemPrompt,
  compressUserPrompt,
  formatLedger,
  repairSystemPrompt,
  repairUserPrompt,
  verifySystemPrompt,
  verifyUserPrompt,
} from './prompts';
export {
  agreementFor,
  criticalLost,
  disagreements,
  MAX_CALLS,
  MAX_REPAIRS,
  MIN_CALLS,
  outputBudget,
  readCompressPayload,
  readRepairPayload,
  readVerifyPayload,
  runAiPipeline,
} from './pipeline';
export type {
  Agreement,
  AiPipelineOptions,
  AiRun,
  AiStep,
  AiStepName,
  AiStepStatus,
  AiVerdict,
} from './pipeline';
export { estimateAiCost, formatUsd } from './cost';
export { forgetKeys, isRemembering, loadKey, loadKeys, saveKey, setRemembering } from './keys';
export type { AiCostEstimate, AiCostInput } from './cost';
