/**
 * Constraint Ledger — types.
 *
 * A constraint is anything the prompt *demands*: a prohibition, a requirement,
 * an output format, a number, a literal, a template variable. The ledger's job
 * is to inventory them before compression and prove, one by one, that they
 * survived it.
 */

export type ConstraintType =
  | 'instruction'
  | 'prohibition'
  | 'requirement'
  | 'format'
  | 'quantity'
  | 'entity'
  | 'literal'
  | 'variable'
  | 'example';

export type Severity = 'critical' | 'minor';

export const CONSTRAINT_TYPES: readonly ConstraintType[] = [
  'prohibition',
  'requirement',
  'format',
  'quantity',
  'literal',
  'variable',
  'instruction',
  'entity',
  'example',
];

/**
 * `critical` constraints block compression: in Aggressive, any change that
 * makes one of them fail is reverted automatically.
 *
 * docs/PLAN.md, Phase 2 task 2 lists prohibition, format, literal, variable and
 * quantity. `requirement` ("must", "only", "always", "ensure") is added here:
 * losing "reply only in English" corrupts a prompt exactly as badly as losing
 * "never reveal the key", and no shipped rule removes requirement words, so the
 * stricter classification costs no compression. See docs/PLAN.md §6.3.
 */
export const CRITICAL_TYPES: readonly ConstraintType[] = [
  'prohibition',
  'requirement',
  'format',
  'quantity',
  'literal',
  'variable',
];

export function severityFor(type: ConstraintType): Severity {
  return CRITICAL_TYPES.includes(type) ? 'critical' : 'minor';
}

export function isCritical(type: ConstraintType): boolean {
  return severityFor(type) === 'critical';
}

/** Human-readable group headings for the verification checklist. */
export const TYPE_LABELS: Record<ConstraintType, string> = {
  prohibition: 'Prohibitions',
  requirement: 'Requirements',
  format: 'Output format',
  quantity: 'Numbers & units',
  literal: 'Literals & URLs',
  variable: 'Template variables',
  instruction: 'Instructions',
  entity: 'Names & identifiers',
  example: 'Examples',
};

export interface Constraint {
  /** Stable within one document: `${type}:${start}-${end}`. */
  id: string;
  type: ConstraintType;
  severity: Severity;
  /**
   * The text that must survive compression. It is the *core* of the demand,
   * not the whole sentence: framing ("Your task is to…") is excluded so that
   * removing it does not read as a lost constraint.
   */
  anchor: string;
  /** Offsets of `anchor` in the original text. `[start, end)`. */
  start: number;
  end: number;
  /** The full sentence that carries the constraint — what "Restore" re-inserts. */
  sentence: string;
  sentenceStart: number;
  sentenceEnd: number;
  /** Why this was picked up, shown in the UI next to the ✓/✗. */
  label: string;
}

export interface ConstraintCheck {
  constraint: Constraint;
  preserved: boolean;
  /**
   * The matching text found in the compressed prompt, normalised. `null` when
   * the constraint was lost.
   */
  evidence: string | null;
  /** Occurrences of the normalised anchor in the original / in the output. */
  occurrencesBefore: number;
  occurrencesAfter: number;
}

export interface LedgerReport {
  checks: ConstraintCheck[];
  total: number;
  preserved: number;
  lost: ConstraintCheck[];
  criticalTotal: number;
  criticalPreserved: number;
  criticalLost: ConstraintCheck[];
  /** True when every constraint survived. */
  clean: boolean;
}

/** Two constraints that say the same thing in different words. */
export interface DuplicateGroup {
  type: ConstraintType;
  /** Constraints that overlap semantically, in document order. */
  members: Constraint[];
  /** 0-1 token overlap (Jaccard) of the weakest pair in the group. */
  similarity: number;
  /** Suggested wording to keep — the shortest member. Never applied silently. */
  suggestion: string;
}
