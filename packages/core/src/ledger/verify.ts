/**
 * Constraint Ledger — verification.
 *
 * The product promise is "it proves it did not break your prompt", so the only
 * unacceptable failure mode is a ✓ next to a constraint that is gone. Two
 * choices make that impossible by construction:
 *
 *  - **Occurrence counting, not presence.** A constraint passes only when its
 *    normalised anchor occurs in the output *at least as often* as in the
 *    input. If a prompt says "never reveal the key" twice and compression drops
 *    one, presence would still say ✓; counting says ✗.
 *  - **Only licensed vocabulary is normalised away** (see `normalize.ts`).
 *    Anything else missing is a failure, even when the meaning arguably
 *    survives. False ✗ costs compression; false ✓ costs trust.
 */

import { countOccurrences, reduceToTokens } from './normalize';
import { extractConstraints } from './extract';
import type { ExtractOptions } from './extract';
import { findDuplicateConstraints } from './duplicates';
import type { Constraint, ConstraintCheck, DuplicateGroup, LedgerReport } from './types';

/** Tokens of context shown around the evidence window. */
const EVIDENCE_CONTEXT = 3;

export function verifyConstraints(
  original: string,
  compressed: string,
  constraints: readonly Constraint[],
): LedgerReport {
  const before = reduceToTokens(original);
  const after = reduceToTokens(compressed);

  const checks: ConstraintCheck[] = constraints.map((constraint) => {
    const anchor = reduceToTokens(constraint.anchor);
    const occurrencesBefore = countOccurrences(before, anchor);
    const occurrencesAfter = countOccurrences(after, anchor);
    // `Math.max(…, 1)`: an anchor always comes from the original, so it must
    // survive at least once even if normalisation of the surrounding text made
    // it uncountable on the way in.
    const expected = Math.max(occurrencesBefore, 1);
    const preserved = anchor.length > 0 && occurrencesAfter >= expected;
    return {
      constraint,
      preserved,
      evidence: preserved ? evidenceFor(after, anchor) : null,
      occurrencesBefore,
      occurrencesAfter,
    };
  });

  return summarise(checks);
}

function summarise(checks: ConstraintCheck[]): LedgerReport {
  const lost = checks.filter((c) => !c.preserved);
  const critical = checks.filter((c) => c.constraint.severity === 'critical');
  const criticalLost = critical.filter((c) => !c.preserved);
  return {
    checks,
    total: checks.length,
    preserved: checks.length - lost.length,
    lost,
    criticalTotal: critical.length,
    criticalPreserved: critical.length - criticalLost.length,
    criticalLost,
    clean: lost.length === 0,
  };
}

function evidenceFor(haystack: readonly string[], needle: readonly string[]): string | null {
  for (let i = 0; i + needle.length <= haystack.length; i++) {
    let hit = true;
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) {
        hit = false;
        break;
      }
    }
    if (!hit) continue;
    const from = Math.max(0, i - EVIDENCE_CONTEXT);
    const to = Math.min(haystack.length, i + needle.length + EVIDENCE_CONTEXT);
    return haystack.slice(from, to).join(' ');
  }
  return null;
}

export interface Ledger {
  constraints: Constraint[];
  report: LedgerReport;
  duplicates: DuplicateGroup[];
}

/** Extract, verify and look for duplicated instructions in one call. */
export function buildLedger(
  original: string,
  compressed: string,
  options: ExtractOptions & { constraints?: Constraint[] } = {},
): Ledger {
  const constraints = options.constraints ?? extractConstraints(original, options);
  return {
    constraints,
    report: verifyConstraints(original, compressed, constraints),
    duplicates: findDuplicateConstraints(constraints),
  };
}
