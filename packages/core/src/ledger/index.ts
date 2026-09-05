export { extractConstraints } from './extract';
export type { ExtractOptions } from './extract';
export { verifyConstraints, buildLedger } from './verify';
export type { Ledger } from './verify';
export { findDuplicateConstraints, DEFAULT_SIMILARITY } from './duplicates';
export { restoreConstraint } from './restore';
export { splitSentences, sentenceAt } from './sentences';
export type { Sentence } from './sentences';
export {
  canonicalize,
  tokenize,
  reduceToTokens,
  countOccurrences,
  containsTokens,
  tokenSimilarity,
} from './normalize';
export { CONSTRAINT_TYPES, CRITICAL_TYPES, TYPE_LABELS, severityFor, isCritical } from './types';
export type {
  Constraint,
  ConstraintCheck,
  ConstraintType,
  DuplicateGroup,
  LedgerReport,
  Severity,
} from './types';
