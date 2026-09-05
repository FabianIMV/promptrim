/**
 * Phase 5 — the compress → verify → repair pipeline.
 *
 * The shape is the one docs/PLAN.md §3 Phase 5 asks for:
 *
 *   A. **Compress.** System prompt carries the protection rules and the whole
 *      constraint ledger; the model returns `{compressed, kept, dropped}`.
 *   B. **Verify, independently.** A second call — by default a cheaper model —
 *      sees the original, the compressed prompt and the ledger, and returns a
 *      per-constraint `{preserved, evidence}`. Its answer is crossed with the
 *      local verifier from Phase 2.
 *   C. **Repair.** While a *critical* constraint is missing, a third call puts
 *      back only those, at most twice. What still fails after that is shown as
 *      ✗ with the manual "Restore" button of Phase 2 next to it.
 *
 * Two rules decide who wins when the two verifiers disagree, and both follow
 * from the Phase 2 principle that a false ✓ costs trust while a false ✗ only
 * costs compression:
 *
 *  - **The local verifier owns the ✓/✗ column.** A model saying "preserved" is
 *    never enough to mark a constraint preserved; it is displayed next to the
 *    ✗ as a disagreement so the user can judge.
 *  - **Repair is driven by the union of both.** Anything either verifier calls
 *    a lost critical constraint gets repaired, which is the stricter reading.
 */

import { buildLedger, extractConstraints, isCritical, verifyConstraints } from '@promptrim/core';
import type {
  Constraint,
  ConstraintCheck,
  DuplicateGroup,
  Level,
  LedgerReport,
} from '@promptrim/core';
import {
  compressSystemPrompt,
  compressUserPrompt,
  repairSystemPrompt,
  repairUserPrompt,
  verifySystemPrompt,
  verifyUserPrompt,
} from './prompts';
import { COMPRESS_SCHEMA, REPAIR_SCHEMA, VERIFY_SCHEMA } from './schemas';
import { ProviderError } from './types';
import type { ProviderClient, StructuredRequest, TokenUsage } from './types';

export const MAX_REPAIRS = 2;

/** Worst case: compress + verify + 2 repairs + one final re-verification. */
export const MAX_CALLS = 2 + MAX_REPAIRS + 1;
/** Best case: compress + verify. */
export const MIN_CALLS = 2;

export type AiStepName = 'compress' | 'verify' | 'repair';
export type AiStepStatus = 'pending' | 'running' | 'done' | 'skipped' | 'failed';

export interface AiStep {
  name: AiStepName;
  status: AiStepStatus;
  /** Short line for the UI: what this step did. */
  detail: string;
}

export interface AiVerdict {
  id: string;
  preserved: boolean;
  evidence: string;
}

/** How the two verifiers compare on one constraint. */
export type Agreement = 'agree-kept' | 'agree-lost' | 'model-only' | 'local-only' | 'unjudged';

export interface AiRun {
  output: string;
  constraints: Constraint[];
  /** Local verification of `output` — the authoritative ✓/✗. */
  report: LedgerReport;
  duplicates: DuplicateGroup[];
  /** The model verifier's answer, by constraint id. Evidence, never proof. */
  verdicts: Record<string, AiVerdict>;
  /** Constraint ids the compressing model claimed to keep / drop. */
  kept: string[];
  dropped: string[];
  repairs: number;
  steps: AiStep[];
  usage: TokenUsage;
  calls: number;
}

export interface AiPipelineOptions {
  provider: ProviderClient;
  apiKey: string;
  level: Level;
  compressModel: string;
  verifyModel: string;
  maxRepairs?: number;
  signal?: AbortSignal;
  onProgress?: (steps: AiStep[]) => void;
  /** Reuse constraints already extracted by the caller. */
  constraints?: Constraint[];
}

/**
 * Output budget for one call. The JSON wrapper holds the whole compressed
 * prompt, so it scales with the input; the constant covers the ids and, on
 * Anthropic, the adaptive thinking that shares the output budget.
 */
export function outputBudget(chars: number): number {
  return Math.min(32_000, Math.max(2_048, Math.ceil(chars / 2) + 2_048));
}

export function agreementFor(check: ConstraintCheck, verdict: AiVerdict | undefined): Agreement {
  if (!verdict) return check.preserved ? 'unjudged' : 'unjudged';
  if (check.preserved && verdict.preserved) return 'agree-kept';
  if (!check.preserved && !verdict.preserved) return 'agree-lost';
  return check.preserved ? 'local-only' : 'model-only';
}

/** Constraints the two verifiers disagree about, for the UI and the tests. */
export function disagreements(
  report: LedgerReport,
  verdicts: Record<string, AiVerdict>,
): ConstraintCheck[] {
  return report.checks.filter((check) => {
    const agreement = agreementFor(check, verdicts[check.constraint.id]);
    return agreement === 'local-only' || agreement === 'model-only';
  });
}

/* ------------------------------------------------------------------ */
/* Payload validation — the schema constrains the model, not the wire. */
/* ------------------------------------------------------------------ */

export interface CompressPayload {
  compressed: string;
  kept: string[];
  dropped: string[];
}

export interface RepairPayload {
  compressed: string;
  reinserted: string[];
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string');
}

export function readCompressPayload(provider: ProviderClient, data: unknown): CompressPayload {
  const record = data as Partial<CompressPayload> | null;
  const compressed = typeof record?.compressed === 'string' ? record.compressed.trim() : '';
  if (!compressed) {
    throw new ProviderError(provider.id, `${provider.label} returned an empty compressed prompt.`);
  }
  return {
    compressed,
    kept: asStringArray(record?.kept),
    dropped: asStringArray(record?.dropped),
  };
}

export function readVerifyPayload(data: unknown): Record<string, AiVerdict> {
  const rows = (data as { results?: unknown } | null)?.results;
  const verdicts: Record<string, AiVerdict> = {};
  if (!Array.isArray(rows)) return verdicts;
  for (const row of rows) {
    const entry = row as Partial<AiVerdict> | null;
    if (!entry || typeof entry.id !== 'string' || typeof entry.preserved !== 'boolean') continue;
    verdicts[entry.id] = {
      id: entry.id,
      preserved: entry.preserved,
      evidence: typeof entry.evidence === 'string' ? entry.evidence.trim() : '',
    };
  }
  return verdicts;
}

export function readRepairPayload(provider: ProviderClient, data: unknown): RepairPayload {
  const record = data as Partial<RepairPayload> | null;
  const compressed = typeof record?.compressed === 'string' ? record.compressed.trim() : '';
  if (!compressed) {
    throw new ProviderError(provider.id, `${provider.label} returned an empty repaired prompt.`);
  }
  return { compressed, reinserted: asStringArray(record?.reinserted) };
}

/* ------------------------------------------------------------------ */
/* The pipeline                                                        */
/* ------------------------------------------------------------------ */

function initialSteps(): AiStep[] {
  return [
    { name: 'compress', status: 'pending', detail: '' },
    { name: 'verify', status: 'pending', detail: '' },
    { name: 'repair', status: 'pending', detail: '' },
  ];
}

function addUsage(total: TokenUsage, usage: TokenUsage | null): TokenUsage {
  if (!usage) return total;
  return {
    inputTokens: total.inputTokens + usage.inputTokens,
    outputTokens: total.outputTokens + usage.outputTokens,
  };
}

export async function runAiPipeline(text: string, options: AiPipelineOptions): Promise<AiRun> {
  const {
    provider,
    apiKey,
    level,
    compressModel,
    verifyModel,
    maxRepairs = MAX_REPAIRS,
    signal,
    onProgress,
  } = options;

  const constraints = options.constraints ?? extractConstraints(text);
  const steps = initialSteps();
  const emit = () => onProgress?.(steps.map((step) => ({ ...step })));

  const setStep = (name: AiStepName, status: AiStepStatus, detail: string) => {
    const step = steps.find((s) => s.name === name)!;
    step.status = status;
    step.detail = detail;
    emit();
  };

  let usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
  let calls = 0;

  const call = async (request: StructuredRequest, model: string) => {
    const response = await provider.complete(request, { apiKey, model, signal });
    usage = addUsage(usage, response.usage);
    calls += 1;
    return response.data;
  };

  // ---- Step A: compression -----------------------------------------------
  setStep('compress', 'running', `Compressing with ${compressModel}…`);
  let payload: CompressPayload;
  try {
    payload = readCompressPayload(
      provider,
      await call(
        {
          system: compressSystemPrompt(level, constraints),
          user: compressUserPrompt(text),
          schemaName: 'promptrim_compression',
          schema: COMPRESS_SCHEMA,
          maxOutputTokens: outputBudget(text.length),
        },
        compressModel,
      ),
    );
  } catch (err) {
    setStep('compress', 'failed', (err as Error).message);
    throw err;
  }

  let output = payload.compressed;
  let report = verifyConstraints(text, output, constraints);
  setStep(
    'compress',
    'done',
    `${constraints.length ? `${report.preserved}/${report.total} constraints found locally` : 'compressed'}`,
  );

  // ---- Step B: independent verification -----------------------------------
  let verdicts: Record<string, AiVerdict> = {};
  if (!constraints.length) {
    setStep('verify', 'skipped', 'No constraints to verify.');
  } else {
    setStep('verify', 'running', `Verifying with ${verifyModel}…`);
    try {
      verdicts = readVerifyPayload(
        await call(
          {
            system: verifySystemPrompt(),
            user: verifyUserPrompt(text, output, constraints),
            schemaName: 'promptrim_verification',
            schema: VERIFY_SCHEMA,
            maxOutputTokens: outputBudget(text.length),
          },
          verifyModel,
        ),
      );
      setStep('verify', 'done', verificationDetail(report, verdicts));
    } catch (err) {
      // A failed audit must not throw away a good compression: the local
      // ledger still stands, and the UI says the second opinion is missing.
      setStep('verify', 'failed', (err as Error).message);
    }
  }

  // ---- Step C: repair ------------------------------------------------------
  let repairs = 0;
  let missing = criticalLost(report, verdicts);

  if (!missing.length) {
    setStep(
      'repair',
      'skipped',
      constraints.length ? 'No critical constraint was lost.' : 'Nothing to repair.',
    );
  } else {
    while (missing.length > 0 && repairs < maxRepairs) {
      repairs += 1;
      setStep(
        'repair',
        'running',
        `Restoring ${missing.length} critical constraint${missing.length === 1 ? '' : 's'} (attempt ${repairs}/${maxRepairs})…`,
      );
      try {
        const repaired = readRepairPayload(
          provider,
          await call(
            {
              system: repairSystemPrompt(),
              user: repairUserPrompt(output, missing),
              schemaName: 'promptrim_repair',
              schema: REPAIR_SCHEMA,
              maxOutputTokens: outputBudget(text.length),
            },
            compressModel,
          ),
        );
        output = repaired.compressed;
        report = verifyConstraints(text, output, constraints);
        // Verdicts describe the previous output; only the local verifier can
        // judge the repaired one until the re-verification below runs.
        missing = report.criticalLost.map((check) => check.constraint);
      } catch (err) {
        setStep('repair', 'failed', (err as Error).message);
        break;
      }
    }

    if (steps.find((s) => s.name === 'repair')!.status !== 'failed') {
      setStep(
        'repair',
        'done',
        missing.length
          ? `${missing.length} critical constraint${missing.length === 1 ? '' : 's'} still missing after ${repairs} attempt${repairs === 1 ? '' : 's'}. Restore manually below.`
          : `Restored in ${repairs} attempt${repairs === 1 ? '' : 's'}.`,
      );
    }

    // The evidence shown next to each ✓ must belong to the prompt on screen,
    // so re-run the audit once when a repair changed the output.
    if (repairs > 0 && constraints.length) {
      try {
        verdicts = readVerifyPayload(
          await call(
            {
              system: verifySystemPrompt(),
              user: verifyUserPrompt(text, output, constraints),
              schemaName: 'promptrim_verification',
              schema: VERIFY_SCHEMA,
              maxOutputTokens: outputBudget(text.length),
            },
            verifyModel,
          ),
        );
        setStep('verify', 'done', verificationDetail(report, verdicts));
      } catch {
        setStep('verify', 'failed', 'Re-verification after repair failed; showing local results.');
      }
    }
  }

  const ledger = buildLedger(text, output, { constraints });

  return {
    output,
    constraints,
    report: ledger.report,
    duplicates: ledger.duplicates,
    verdicts,
    kept: payload.kept,
    dropped: payload.dropped,
    repairs,
    steps,
    usage,
    calls,
  };
}

/** Critical constraints either verifier calls lost — the stricter union. */
export function criticalLost(
  report: LedgerReport,
  verdicts: Record<string, AiVerdict>,
): Constraint[] {
  const lost: Constraint[] = [];
  for (const check of report.checks) {
    if (!isCritical(check.constraint.type)) continue;
    const verdict = verdicts[check.constraint.id];
    if (!check.preserved || verdict?.preserved === false) lost.push(check.constraint);
  }
  return lost;
}

function verificationDetail(report: LedgerReport, verdicts: Record<string, AiVerdict>): string {
  const judged = report.checks.filter((check) => verdicts[check.constraint.id]).length;
  const conflicts = disagreements(report, verdicts).length;
  const base = `${judged}/${report.total} constraints audited`;
  return conflicts ? `${base} · ${conflicts} disagreement${conflicts === 1 ? '' : 's'}` : base;
}
