/**
 * Constraint Ledger — normalisation.
 *
 * Verification compares an anchor taken from the original against the
 * compressed output. A literal string comparison would be useless: the
 * compressor is *licensed* to rewrite "in order to" into "to" and to drop
 * "please". So both sides are reduced to a token stream that ignores exactly
 * what the compressor is allowed to change, and nothing else:
 *
 *   1. case, typographic quotes, punctuation and whitespace;
 *   2. the non-lossy equivalences of `SUBSTITUTION_RULES` (docs/PLAN.md Phase 2
 *      task 2: "sinónimos definidos por las reglas de sustitución");
 *   3. the licensed filler vocabulary below — politeness, request framing and
 *      degree intensifiers, i.e. the words the lossy rules delete.
 *
 * Everything else — every instruction word, number, name and literal — must
 * appear verbatim in the output or the constraint is reported as lost. That
 * asymmetry is the whole point: the ledger must never call a dropped
 * requirement "preserved".
 *
 * `test/ledger-normalize.test.ts` pins point 3 to the rule set: every shipped
 * deletion rule must reduce its input and its expected output to the same
 * tokens. A rule that deleted anything outside this vocabulary would fail that
 * test — and, at Aggressive, would be reverted by the ledger.
 */

import { SUBSTITUTION_RULES } from '../rules/substitutions';

/**
 * Phrases the compressor may delete without changing what is being asked.
 * Ordered longest-first so that "as an ai assistant" is consumed before
 * "as an ai". Kept deliberately small: adding a word here makes the ledger
 * blind to its removal.
 */
const FILLER_PATTERNS: RegExp[] = [
  // Frames: "It is important to note that X" wraps the instruction X.
  /\bit(?:'s| is) important to note that\b/g,
  /\bit should be noted that\b/g,
  /\byour (?:task|job|role|goal) is to\b/g,
  /\byou are asked to\b/g,
  /\b(?:i would like|i'd like|i want|i need) you to\b/g,
  /\b(?:could|can|would) you(?: please)?\b/g,
  /\bin (?:this|the) task\b/g,
  /\bfor this (?:task|request|assignment)\b/g,
  /\bthe following is(?: an?)?\b/g,
  // Hedges.
  /\b(?:in my opinion|from my perspective)\b/g,
  /\bi (?:think|believe|feel|suppose)\b/g,
  // "As an AI assistant, …" — a reminder of what the model is, not a demand.
  /\bas an? (?:ai assistant|ai|assistant|language model|llm)\b/g,
  // Politeness.
  /\b(?:please|kindly)\b/g,
  // Degree intensifiers. Frequency words (always, never, often) are NOT here:
  // they are requirements and their removal must be visible.
  /\b(?:very|really|extremely|quite|rather|fairly|somewhat|totally|absolutely|definitely|certainly|basically|essentially)\b/g,
];

/** Typographic characters the compressor normalises to ASCII. */
function toAscii(text: string): string {
  return text
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”‟]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/[\u00a0\u2007\u202f]/g, ' ');
}

/**
 * Apply the non-lossy substitution rules, so that an anchor written as
 * "in order to return JSON" matches an output that says "to return JSON".
 */
function applyEquivalences(text: string): string {
  let out = text;
  for (const rule of SUBSTITUTION_RULES) {
    const pattern = new RegExp(
      rule.pattern.source,
      rule.pattern.flags.includes('g') ? rule.pattern.flags : `${rule.pattern.flags}g`,
    );
    out =
      typeof rule.replacement === 'string'
        ? out.replace(pattern, rule.replacement)
        : out.replace(pattern, (match, ...args) => {
            const groups = args.slice(0, -2).map((g) => (g as string | undefined) ?? '');
            return (rule.replacement as (m: string, ...g: string[]) => string)(match, ...groups);
          });
  }
  return out;
}

/** Lowercased, ASCII-quoted, equivalence-applied, filler-free text. */
export function canonicalize(text: string): string {
  let out = applyEquivalences(toAscii(text).toLowerCase());
  for (const pattern of FILLER_PATTERNS) {
    out = out.replace(pattern, ' ');
  }
  return out;
}

/**
 * Words, plus `%`, `$` and `#` as standalone tokens so that "50%" never
 * matches a bare "50" and "$5" never matches "5".
 */
const TOKEN_RE = /[\p{L}\p{N}]+(?:'[\p{L}\p{N}]+)*|[%$#]/gu;

export function tokenize(text: string): string[] {
  return text.match(TOKEN_RE) ?? [];
}

/** The comparison form used by every ledger check. */
export function reduceToTokens(text: string): string[] {
  return tokenize(canonicalize(text));
}

/** Number of positions at which `needle` occurs contiguously inside `haystack`. */
export function countOccurrences(haystack: readonly string[], needle: readonly string[]): number {
  if (needle.length === 0 || needle.length > haystack.length) return 0;
  let count = 0;
  outer: for (let i = 0; i + needle.length <= haystack.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    count++;
  }
  return count;
}

/** True when `needle`'s tokens appear contiguously inside `haystack`. */
export function containsTokens(haystack: readonly string[], needle: readonly string[]): boolean {
  return countOccurrences(haystack, needle) > 0;
}

/** Jaccard overlap of two token sets, used for duplicate detection. */
export function tokenSimilarity(a: readonly string[], b: readonly string[]): number {
  const setA = new Set(a);
  const setB = new Set(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let shared = 0;
  for (const token of setA) if (setB.has(token)) shared++;
  return shared / (setA.size + setB.size - shared);
}

/**
 * Spans of `text` covered by the licensed filler vocabulary.
 *
 * A marker word inside one of these is framing, not a demand: the "should" in
 * "It should be noted that limits apply" belongs to the wrapper the compressor
 * is allowed to delete, so it must not be recorded as a requirement.
 */
export function fillerRanges(text: string): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  for (const pattern of FILLER_PATTERNS) {
    const re = new RegExp(
      pattern.source,
      pattern.flags.includes('i') ? pattern.flags : `${pattern.flags}i`,
    );
    for (const match of text.matchAll(re)) {
      out.push({ start: match.index, end: match.index + match[0].length });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

export { FILLER_PATTERNS };
