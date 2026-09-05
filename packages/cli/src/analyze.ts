/**
 * The measurement half of `promptrim check`: everything the report shows is
 * computed here, from strings, with no filesystem and no git. `run.ts` reads
 * the files and hands them over; the tests hand over literals.
 *
 * What each file gets:
 *   - a token count from the target model's real tokenizer (never chars/4),
 *   - the same count for the file as it stands on the base git ref, so a PR
 *     can be told it added tokens rather than only how many it has,
 *   - the monthly cost of those tokens at the projected call volume,
 *   - duplicated instructions, from the ledger's own similarity check,
 *   - and a compressed version that the ledger has verified: it is only
 *     offered when every `critical` constraint in the original still verifies
 *     against it. An unverified suggestion is reported as such, never applied.
 */
import {
  compress,
  countTokensForModel,
  extractConstraints,
  findDuplicateConstraints,
  getModel,
  projectedMonthlyCost,
} from '@promptrim/core';
import type { DuplicateGroup, Level, ModelPricing } from '@promptrim/core';

export interface Suggestion {
  /** The compressed prompt. Written to disk only under `--write`. */
  output: string;
  tokens: number;
  savedTokens: number;
  /** 0-1 share of the original token count this removes. */
  savedRatio: number;
  monthlySaving: number;
  changes: number;
  /** Changes the ledger reverted because they cost a critical constraint. */
  blocked: number;
  criticalTotal: number;
  criticalPreserved: number;
  /**
   * True when no `critical` constraint was lost. The CLI never suggests — and
   * `--write` never applies — a compression that fails this.
   */
  verified: boolean;
  /** Set by `run.ts` once the file has actually been overwritten. */
  written: boolean;
}

export interface FileAnalysis {
  path: string;
  tokens: number;
  /** False when the count is the calibrated estimate, not an exact count. */
  exact: boolean;
  /** Token count on the base ref; `null` when the file is new or there is no base. */
  baseTokens: number | null;
  deltaTokens: number | null;
  /** 0-1 change against the base. `null` when there is no base or it was empty. */
  deltaRatio: number | null;
  monthlyCost: number;
  monthlyDelta: number | null;
  budget: number | null;
  overBudget: boolean;
  overBudgetBy: number;
  duplicates: DuplicateGroup[];
  suggestion: Suggestion | null;
}

export interface AnalyzeContext {
  model: ModelPricing;
  level: Level;
  budget: number | null;
  callsPerDay: number;
  /** Key for the *model's own* provider, used only for exact token counts. */
  apiKey?: string | undefined;
}

export interface AnalyzeFileInput {
  path: string;
  content: string;
  /** Content on the base ref, `null` when the file is new there. */
  baseContent: string | null;
}

export function resolveModel(modelId: string): ModelPricing {
  const model = getModel(modelId);
  if (!model) {
    throw new Error(`Unknown model "${modelId}". See packages/core/src/data/pricing.json.`);
  }
  return model;
}

/** The environment variable holding the key for a model's provider. */
export function apiKeyEnvName(model: Pick<ModelPricing, 'provider'>): string {
  if (model.provider === 'anthropic') return 'ANTHROPIC_API_KEY';
  if (model.provider === 'openai') return 'OPENAI_API_KEY';
  return 'GEMINI_API_KEY';
}

export async function analyzeFile(
  input: AnalyzeFileInput,
  ctx: AnalyzeContext,
): Promise<FileAnalysis> {
  const { model, level, budget, callsPerDay, apiKey } = ctx;
  const count = await countTokensForModel(input.content, model, apiKey);
  const monthlyCost = projectedMonthlyCost(count.tokens, model.input_per_mtok, callsPerDay);

  let baseTokens: number | null = null;
  let monthlyDelta: number | null = null;
  if (input.baseContent !== null) {
    const baseCount = await countTokensForModel(input.baseContent, model, apiKey);
    baseTokens = baseCount.tokens;
    monthlyDelta =
      monthlyCost - projectedMonthlyCost(baseTokens, model.input_per_mtok, callsPerDay);
  }

  const constraints = extractConstraints(input.content);

  // `enforceLedger` is forced on at every level, not just Aggressive. The web
  // app leaves Light/Balanced unenforced because a human is watching the diff;
  // a CI suggestion has nobody watching, so the ledger vets all of them. Same
  // reasoning as the benchmark's decision in docs/PLAN.md §6.7.
  const result = compress(input.content, level, { enforceLedger: true, constraints });
  const report = result.ledger;

  let suggestion: Suggestion | null = null;
  if (result.changes.length > 0 && result.output !== input.content) {
    const compressedCount = await countTokensForModel(result.output, model, apiKey);
    const savedTokens = count.tokens - compressedCount.tokens;
    const criticalTotal = report?.criticalTotal ?? 0;
    const criticalPreserved = report?.criticalPreserved ?? 0;
    const verified = report !== null && report.criticalLost.length === 0;
    if (savedTokens > 0) {
      suggestion = {
        output: result.output,
        tokens: compressedCount.tokens,
        savedTokens,
        savedRatio: count.tokens > 0 ? savedTokens / count.tokens : 0,
        monthlySaving:
          monthlyCost -
          projectedMonthlyCost(compressedCount.tokens, model.input_per_mtok, callsPerDay),
        changes: result.changes.length,
        blocked: result.blocked.length,
        criticalTotal,
        criticalPreserved,
        verified,
        written: false,
      };
    }
  }

  const overBudgetBy = budget === null ? 0 : Math.max(0, count.tokens - budget);
  return {
    path: input.path,
    tokens: count.tokens,
    exact: count.exact,
    baseTokens,
    deltaTokens: baseTokens === null ? null : count.tokens - baseTokens,
    deltaRatio: baseTokens === null || baseTokens === 0 ? null : count.tokens / baseTokens - 1,
    monthlyCost,
    monthlyDelta,
    budget,
    overBudget: overBudgetBy > 0,
    overBudgetBy,
    duplicates: findDuplicateConstraints(constraints),
    suggestion,
  };
}

export interface Totals {
  files: number;
  tokens: number;
  baseTokens: number | null;
  deltaTokens: number | null;
  monthlyCost: number;
  monthlyDelta: number | null;
  overBudget: number;
  duplicateGroups: number;
  /** Tokens the verified suggestions would save if all of them were applied. */
  savedTokens: number;
  monthlySaving: number;
  unverified: number;
}

export function totalsFor(files: readonly FileAnalysis[]): Totals {
  const compared = files.filter((file) => file.baseTokens !== null);
  const verified = files.filter((file) => file.suggestion?.verified);
  return {
    files: files.length,
    tokens: sum(files, (file) => file.tokens),
    baseTokens: compared.length > 0 ? sum(compared, (file) => file.baseTokens ?? 0) : null,
    deltaTokens: compared.length > 0 ? sum(compared, (file) => file.deltaTokens ?? 0) : null,
    monthlyCost: sum(files, (file) => file.monthlyCost),
    monthlyDelta: compared.length > 0 ? sum(compared, (file) => file.monthlyDelta ?? 0) : null,
    overBudget: files.filter((file) => file.overBudget).length,
    duplicateGroups: sum(files, (file) => file.duplicates.length),
    savedTokens: sum(verified, (file) => file.suggestion?.savedTokens ?? 0),
    monthlySaving: sum(verified, (file) => file.suggestion?.monthlySaving ?? 0),
    unverified: files.filter((file) => file.suggestion !== null && !file.suggestion.verified)
      .length,
  };
}

function sum<T>(items: readonly T[], pick: (item: T) => number): number {
  return items.reduce((total, item) => total + pick(item), 0);
}
