/**
 * Constraint Ledger — duplicated instructions.
 *
 * The largest honest saving in a long system prompt is not shorter wording: it
 * is the same rule stated three times in three sections. No compressor we know
 * of reports it. PromptTrim reports it and *proposes* a merge; it never merges
 * silently, because two similar sentences are sometimes deliberately different.
 */

import { reduceToTokens, tokenSimilarity } from './normalize';
import type { Constraint, ConstraintType, DuplicateGroup } from './types';

/** Types where restating the same thing is redundancy rather than data. */
const COMPARABLE: readonly ConstraintType[] = [
  'prohibition',
  'requirement',
  'format',
  'instruction',
];

/** Below this many tokens, two anchors match by accident too often. */
const MIN_TOKENS = 3;

/**
 * Token overlap above which two anchors are treated as the same demand. 0.6
 * catches a synonym swap ("answer" → "reply") in an otherwise identical
 * sentence while leaving two genuinely different rules apart.
 */
export const DEFAULT_SIMILARITY = 0.6;

export function findDuplicateConstraints(
  constraints: readonly Constraint[],
  threshold: number = DEFAULT_SIMILARITY,
): DuplicateGroup[] {
  const groups: DuplicateGroup[] = [];

  for (const type of COMPARABLE) {
    const items = constraints
      .filter((c) => c.type === type)
      .map((constraint) => ({ constraint, tokens: reduceToTokens(constraint.anchor) }))
      .filter((item) => item.tokens.length >= MIN_TOKENS);

    const assigned = new Set<string>();
    for (let i = 0; i < items.length; i++) {
      const seed = items[i]!;
      if (assigned.has(seed.constraint.id)) continue;
      const members = [seed.constraint];
      let weakest = 1;
      for (let j = i + 1; j < items.length; j++) {
        const other = items[j]!;
        if (assigned.has(other.constraint.id)) continue;
        if (overlaps(seed.constraint, other.constraint)) continue;
        const similarity = tokenSimilarity(seed.tokens, other.tokens);
        if (similarity < threshold) continue;
        members.push(other.constraint);
        assigned.add(other.constraint.id);
        weakest = Math.min(weakest, similarity);
      }
      if (members.length < 2) continue;
      assigned.add(seed.constraint.id);
      groups.push({
        type,
        members,
        similarity: weakest,
        suggestion: shortest(members),
      });
    }
  }

  return groups.sort((a, b) => a.members[0]!.start - b.members[0]!.start);
}

/** Two anchors from the same sentence are one statement, not a repetition. */
function overlaps(a: Constraint, b: Constraint): boolean {
  return a.start < b.end && b.start < a.end;
}

function shortest(members: readonly Constraint[]): string {
  return members.reduce(
    (best, c) => (c.sentence.length < best.length ? c.sentence : best),
    members[0]!.sentence,
  );
}
