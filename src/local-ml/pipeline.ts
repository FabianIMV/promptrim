/**
 * Local ML mode's compress → ledger pipeline (docs/PLAN.md Phase 8).
 *
 * There is no compress → verify → repair loop here like Phase 5's AI mode:
 * that loop spends extra model calls to *fix* what verification finds wrong,
 * and a local model call is a synchronous chunk of on-device compute, not a
 * cheap API round trip — running it three more times per prompt to chase a
 * fix a statistical token-classifier cannot reason about would not help.
 * Task 2 only asks that the output "always passes through protected regions
 * and the local ledger", so this pipeline does exactly that and stops: the
 * ledger's ✓/✗ checklist and the existing manual "Restore" button (Phase 2)
 * are what make the result usable, the same way they already are for a Fast
 * mode compression the ledger did not fully approve.
 */
import { buildLedger, extractConstraints } from '../core';
import type { Constraint, DuplicateGroup, Level, LedgerReport } from '../core';
import { loadLocalMlEngine } from './engine';
import { LEVEL_KEEP_RATE } from './rate';
import { compressProtectedAware } from './segments';
import type { LocalMlEngine, LocalMlProgress } from './types';

export interface LocalMlRun {
  output: string;
  constraints: Constraint[];
  report: LedgerReport;
  duplicates: DuplicateGroup[];
}

export interface LocalMlOptions {
  level: Level;
  onProgress?: (progress: LocalMlProgress) => void;
  /** Reuse constraints already extracted by the caller. */
  constraints?: Constraint[];
  /** Injected in tests so no test ever downloads or runs the real model. */
  loadEngine?: (onProgress?: (progress: LocalMlProgress) => void) => Promise<LocalMlEngine>;
}

export async function runLocalMlCompression(
  text: string,
  options: LocalMlOptions,
): Promise<LocalMlRun> {
  const loadEngine = options.loadEngine ?? loadLocalMlEngine;
  const constraints = options.constraints ?? extractConstraints(text);
  const engine = await loadEngine(options.onProgress);
  const rate = LEVEL_KEEP_RATE[options.level];

  options.onProgress?.({
    phase: 'compressing',
    message: 'Compressing locally…',
    percent: null,
  });
  const output = await compressProtectedAware(text, (segmentText) =>
    engine.compress(segmentText, rate),
  );

  const ledger = buildLedger(text, output, { constraints });
  return { output, constraints, report: ledger.report, duplicates: ledger.duplicates };
}
