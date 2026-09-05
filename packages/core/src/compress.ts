/**
 * Compression engine.
 *
 * The compressor does not return a string: it returns a list of `Change`s over
 * the ORIGINAL text. The compressed string is a projection of that list
 * (`applyChanges`). This is what makes the diff, per-change undo and rule
 * traceability of later phases possible, and it lets a test assert that undoing
 * every change reproduces the input byte for byte.
 *
 * Rules only ever see text segments; protected segments are copied verbatim.
 */

import { segment, findProtectedRanges } from './segment';
import type { ProtectedRange, Segment } from './segment';
import { rulesForLevel, ALL_RULES } from './rules';
import type { Level, Rule } from './rules/types';
import { resolveReplacement } from './rules/types';
import { extractConstraints, verifyConstraints } from './ledger';
import type { Constraint, LedgerReport } from './ledger';

export interface Change {
  ruleId: string;
  /** Offsets into the original input. `[start, end)`. */
  start: number;
  end: number;
  original: string;
  replacement: string;
  lossy: boolean;
  /** True when the change was extended to repair sentence capitalisation. */
  capitalised?: boolean;
}

/** A change the ledger reverted because it would have dropped a constraint. */
export interface BlockedChange extends Change {
  /** Ids of the `critical` constraints that failed while this change applied. */
  constraintIds: string[];
}

export interface CompressResult {
  output: string;
  changes: Change[];
  segments: Segment[];
  level: Level;
  /**
   * Changes reverted by the ledger. Non-empty only when enforcement ran, and
   * surfaced in the UI as "blocked by the ledger" so that a user can see why
   * Aggressive did not compress further.
   */
  blocked: BlockedChange[];
  /** The inventory enforcement ran against; `null` when it did not run. */
  constraints: Constraint[] | null;
  /** Verification of the final output; `null` when enforcement did not run. */
  ledger: LedgerReport | null;
}

export interface CompressOptions {
  /** Rule set to draw from. Defaults to every shipped rule. */
  rules?: Rule[];
  /** Rule ids to skip (Phase 3 will wire this to the UI rule panel). */
  disabledRuleIds?: readonly string[];
  /**
   * Revert any change that makes a `critical` constraint fail verification.
   * Defaults to `true` at `aggressive` and `false` below it, per docs/PLAN.md
   * Phase 2 task 3. Set explicitly to enforce (or skip) at any level.
   */
  enforceLedger?: boolean;
  /** Reuse an inventory the caller already extracted. */
  constraints?: Constraint[];
}

/** Rebuild a string from the original plus a set of changes. */
export function applyChanges(original: string, changes: readonly Change[]): string {
  const ordered = [...changes].sort((a, b) => a.start - b.start);
  let out = '';
  let cursor = 0;
  for (const change of ordered) {
    if (change.start < cursor) continue;
    out += original.slice(cursor, change.start) + change.replacement;
    cursor = change.end;
  }
  return out + original.slice(cursor);
}

export function compress(
  input: string,
  level: Level,
  options: CompressOptions = {},
): CompressResult {
  const rules = rulesForLevel(level, options.rules ?? ALL_RULES).filter(
    (r) => !options.disabledRuleIds?.includes(r.id),
  );
  const priority = new Map(rules.map((rule, index) => [rule.id, index]));
  const segments = segment(input);
  const ranges = findProtectedRanges(input);

  // Rules are matched against the WHOLE input, then any match that touches a
  // protected range is dropped. Matching per segment would break line anchors
  // (`^`/`$`) and word boundaries, because a segment edge is not a line edge:
  // the trailing space in `writes "please"` sits at the end of a text segment
  // but in the middle of its line.
  const intersectsProtected = (start: number, end: number) =>
    ranges.some((r) => start < r.end && r.start < end);

  const candidates: Change[] = [];
  for (const rule of rules) {
    const pattern = new RegExp(rule.pattern.source, ensureGlobal(rule.pattern.flags));
    for (const match of input.matchAll(pattern)) {
      if (match[0].length === 0) continue;
      const start = match.index;
      const end = start + match[0].length;
      if (intersectsProtected(start, end)) continue;
      const replacement = resolveReplacement(rule, match);
      if (replacement === match[0]) continue;
      candidates.push({
        ruleId: rule.id,
        start,
        end,
        original: match[0],
        replacement,
        lossy: rule.lossy,
      });
    }
  }

  candidates.sort(
    (a, b) =>
      a.start - b.start ||
      (priority.get(a.ruleId) ?? 0) - (priority.get(b.ruleId) ?? 0) ||
      b.end - a.end,
  );

  const selected: Change[] = [];
  let lastEnd = -1;
  for (const candidate of candidates) {
    if (candidate.start < lastEnd) continue;
    selected.push(candidate);
    lastEnd = candidate.end;
  }

  // Capitalisation repair mutates the changes it fixes, so the ledger works on
  // the raw selection and re-projects it each round; otherwise reverting a
  // change would leave the capitalisation it carried to its neighbour behind.
  const project = (raw: readonly Change[]): { changes: Change[]; output: string } => {
    const cloned = raw.map((c) => ({ ...c }));
    repairCapitalisation(input, cloned, ranges);
    return { changes: cloned, output: applyChanges(input, cloned) };
  };

  const enforce = options.enforceLedger ?? level === 'aggressive';
  if (!enforce) {
    const { changes, output } = project(selected);
    return { output, changes, segments, level, blocked: [], constraints: null, ledger: null };
  }

  const constraints = options.constraints ?? extractConstraints(input, { ranges });
  const { kept, blocked } = enforceLedger(input, selected, constraints, project);
  const { changes, output } = project(kept);
  return {
    output,
    changes,
    segments,
    level,
    blocked,
    constraints,
    ledger: verifyConstraints(input, output, constraints),
  };
}

/** Rounds of revert-and-recheck before giving up and reporting the ✗ as-is. */
const MAX_LEDGER_ROUNDS = 5;

/**
 * Drop every change that keeps a `critical` constraint from verifying.
 *
 * Blame is assigned by overlap: the changes inside the constraint's anchor
 * first, and only if none overlaps, the changes inside its sentence. A failure
 * that no change touches is left failing rather than guessed at — the UI shows
 * the ✗, which is the honest outcome.
 */
function enforceLedger(
  input: string,
  selected: readonly Change[],
  constraints: readonly Constraint[],
  project: (raw: readonly Change[]) => { output: string },
): { kept: Change[]; blocked: BlockedChange[] } {
  const critical = constraints.filter((c) => c.severity === 'critical');
  let kept = [...selected];
  const blocked: BlockedChange[] = [];
  if (critical.length === 0 || kept.length === 0) return { kept, blocked };

  for (let round = 0; round < MAX_LEDGER_ROUNDS; round++) {
    const report = verifyConstraints(input, project(kept).output, critical);
    if (report.criticalLost.length === 0) break;

    const culprits = new Map<Change, Set<string>>();
    for (const check of report.criticalLost) {
      const { start, end, sentenceStart, sentenceEnd, id } = check.constraint;
      let touching = kept.filter((c) => c.start < end && start < c.end);
      if (touching.length === 0) {
        touching = kept.filter((c) => c.start < sentenceEnd && sentenceStart < c.end);
      }
      for (const change of touching) {
        const ids = culprits.get(change) ?? new Set<string>();
        ids.add(id);
        culprits.set(change, ids);
      }
    }
    if (culprits.size === 0) break;

    for (const [change, ids] of culprits) {
      blocked.push({ ...change, constraintIds: [...ids] });
    }
    kept = kept.filter((c) => !culprits.has(c));
  }

  blocked.sort((a, b) => a.start - b.start);
  return { kept, blocked };
}

function ensureGlobal(flags: string): string {
  return flags.includes('g') ? flags : `${flags}g`;
}

/**
 * A deletion at the start of a sentence leaves the next word lowercase
 * ("Please write X." → "write X."). The repair is folded into the change
 * itself, so `applyChanges` stays the single source of truth for the output and
 * undoing a change also undoes its capitalisation.
 */
function repairCapitalisation(
  input: string,
  changes: Change[],
  ranges: readonly ProtectedRange[],
): void {
  // When two deletions are adjacent ("As an AI assistant, your task is to X"),
  // the first cannot reach the next word, so the obligation to capitalise is
  // carried over to the change that follows it.
  let carried = false;

  for (let i = 0; i < changes.length; i++) {
    const change = changes[i]!;
    const atSentenceStart = carried
      ? true
      : // Only repair when the change actually consumed the capital letter that
        // opened the sentence; a whitespace rewrite at sentence start must not
        // capitalise a word the author wrote in lower case.
        startsSentence(input, change.start) && /^\p{Lu}/u.test(change.original);
    carried = false;
    if (!atSentenceStart) continue;

    const firstLetter = change.replacement.search(/\p{L}/u);
    if (firstLetter !== -1) {
      const letter = change.replacement[firstLetter]!;
      if (letter === letter.toLowerCase() && letter !== letter.toUpperCase()) {
        change.replacement =
          change.replacement.slice(0, firstLetter) +
          letter.toUpperCase() +
          change.replacement.slice(firstLetter + 1);
        change.capitalised = true;
      }
      continue;
    }

    if (change.replacement.trim() !== '') continue;

    const nextChange = changes[i + 1];
    if (nextChange && nextChange.start === change.end) {
      carried = true;
      continue;
    }

    const next = input[change.end];
    if (!next || !/\p{Ll}/u.test(next)) continue;
    // Never reach into a protected region (a URL can start a "sentence" too).
    if (ranges.some((r) => change.end >= r.start && change.end < r.end)) continue;
    if (nextChange && nextChange.start < change.end + 1) continue;

    change.end += 1;
    change.original += next;
    change.replacement += next.toUpperCase();
    change.capitalised = true;
  }
}

/** True when `index` is the first character of a sentence, list item or line. */
function startsSentence(text: string, index: number): boolean {
  let i = index - 1;
  i = skipBack(text, i, /[ \t]/);
  if (i < 0) return true;
  const ch = text[i]!;
  if (ch === '\n') return true;
  if (ch === '.' || ch === '!' || ch === '?') return true;

  // List markers: "- item", "* item", "1. item", "2) item".
  let j = i;
  if (ch === '-' || ch === '*' || ch === '+') {
    j = i - 1;
  } else if (ch === ')') {
    j = skipBack(text, i - 1, /\d/);
    if (j === i - 1) return false;
  } else {
    return false;
  }
  j = skipBack(text, j, /[ \t]/);
  return j < 0 || text[j] === '\n';
}

function skipBack(text: string, from: number, re: RegExp): number {
  let i = from;
  while (i >= 0 && re.test(text[i]!)) i--;
  return i;
}
