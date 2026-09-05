/**
 * Constraint Ledger — extraction.
 *
 * `extractConstraints` reads a prompt and returns the inventory of everything
 * it demands. Two design rules run through the whole file:
 *
 *  - **Anchors are cores, not sentences.** The anchor of a prohibition starts
 *    at "never", not at "Please remember that you should never". Framing that
 *    the compressor is licensed to delete must not sit inside an anchor, or
 *    every legal compression would read as a lost constraint.
 *  - **Markers are matched against the whole text and then filtered against the
 *    protected ranges**, the same order `compress.ts` uses (docs/PLAN.md §6.1,
 *    decision 1): a segment edge is not a line edge, so matching per segment
 *    would break `^`/`$` anchors and word boundaries.
 */

import { findProtectedRanges } from '../segment';
import type { ProtectedKind, ProtectedRange } from '../segment';
import { splitSentences, sentenceAt } from './sentences';
import type { Sentence } from './sentences';
import { canonicalize, fillerRanges, tokenize } from './normalize';
import { severityFor } from './types';
import type { Constraint, ConstraintType } from './types';

/** Longest anchor we keep. Beyond this a "constraint" is really a paragraph. */
const MAX_ANCHOR = 220;

interface Candidate {
  type: ConstraintType;
  /** The marker that triggered the match (e.g. "must not"). */
  markerStart: number;
  markerEnd: number;
  start: number;
  end: number;
  label: string;
  /**
   * `false` for anchors taken from a protected region: `{{ticket_id}}` and
   * `"status"` must keep their delimiters, so edge trimming is skipped.
   */
  trim?: boolean;
}

// ─── Marker vocabularies ──────────────────────────────────────────────────────

const PROHIBITION_RE =
  /\b(?:never|do not|don't|does not|doesn't|must not|mustn't|shall not|should not|shouldn't|cannot|can't|may not|will not|won't|avoid|refrain from|under no circumstances|at no point)\b/gi;

const REQUIREMENT_RE =
  /\b(?:must|should|shall|always|only|exactly|required to|require[sd]? that|need to|needs to|have to|has to|it is mandatory|mandatory|ensure that|ensure|make sure(?: that| to)?|be sure to|remember to|at all times)\b/gi;

const FORMAT_PATTERNS: { re: RegExp; label: string }[] = [
  {
    re: /\b(?:in|as|using|into|only|valid|well-formed|strict)\s+(?:json|jsonl|ndjson|yaml|xml|csv|tsv|html|markdown|plain\s+text|plaintext)\b/gi,
    label: 'serialisation format',
  },
  {
    re: /\b(?:json|yaml|xml|csv|html|markdown)\s+(?:object|array|list|format|output|response|document|schema|block)\b/gi,
    label: 'serialisation format',
  },
  {
    re: /\b(?:respond|reply|answer|output|return|write|produce|render|format|formatted|structure)\b[^.\n]{0,40}?\b(?:json|yaml|xml|csv|html|markdown|plain text|bullet points?|bulleted list|numbered list|markdown table|table|prose|paragraphs?)\b/gi,
    label: 'output shape',
  },
  {
    re: /\b(?:bullet points?|bulleted list|numbered list|markdown table|code block|code fence|one line|single line)\b/gi,
    label: 'output shape',
  },
  {
    // "at most 3 sentences", "under 120 words", "3 short paragraphs".
    re: /\b(?:no more than|at most|at least|fewer than|less than|under|over|maximum(?: of)?|max|minimum(?: of)?|min|up to|exactly|around|about|within)?\s*(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)(?:\s*[-–]\s*\d+)?(?:\s+\p{Ll}+){0,2}?\s+(?:words?|sentences?|characters?|chars?|paragraphs?|bullets?|bullet points?|items?|lines?|tokens?|steps?|options?|examples?|questions?|sections?|headings?)\b/gu,
    label: 'length limit',
  },
  {
    // An explicit limit word makes any noun an output-shape budget:
    // "at most 8 findings", "no more than 1 formula", "exactly 1 H1".
    // A limit on a *measurement* ("at least 24 hours") is a quantity instead,
    // filtered out by `MEASURE_UNITS` below.
    re: /\b(?:no more than|at most|at least|fewer than|less than|maximum of|minimum of|up to|exactly|between)\s+(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)(?:\s+and\s+\d+)?(?:\s+\p{Ll}+){0,2}?\s+[\p{L}\d][\p{L}\d-]*\b/gu,
    label: 'output budget',
  },
  {
    re: /\bin\s+(?:english|spanish|french|german|portuguese|italian|japanese|chinese|korean|russian|dutch|hindi|arabic)\b/gi,
    label: 'output language',
  },
  {
    re: /\bin the (?:user'?s|same|original|source|target) language\b/gi,
    label: 'output language',
  },
  {
    re: /\bno\s+(?:preamble|prose|explanations?|commentary|markdown|code fences?|extra text|additional text|greetings?|apologies)\b/gi,
    label: 'output shape',
  },
  {
    re: /\bnothing else\b|\bwithout (?:any )?(?:explanation|preamble|commentary|extra text)\b/gi,
    label: 'output shape',
  },
];

/**
 * Units that make a limit phrase a measurement rather than an output budget:
 * "at least 24 hours apart" constrains a schedule, not the shape of a reply.
 */
const MEASURE_UNITS = new Set([
  'ms',
  'sec',
  'secs',
  'second',
  'seconds',
  'min',
  'mins',
  'minute',
  'minutes',
  'hour',
  'hours',
  'hr',
  'hrs',
  'day',
  'days',
  'week',
  'weeks',
  'month',
  'months',
  'year',
  'years',
  'kb',
  'mb',
  'gb',
  'tb',
  'byte',
  'bytes',
  'px',
  'degrees',
  'celsius',
  'fahrenheit',
  'usd',
  'eur',
  'gbp',
  'kg',
  'km',
  'cm',
  'ml',
  'kcal',
  'dollars',
  'euros',
  'rows',
  'requests',
]);

const QUANTITY_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /\b\d{4}-\d{2}-\d{2}\b/g, label: 'date' },
  { re: /\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/g, label: 'date' },
  { re: /[$€£]\s?\d[\d,]*(?:\.\d+)?/g, label: 'amount' },
  { re: /\b\d[\d,]*(?:\.\d+)?\s?%/g, label: 'percentage' },
  {
    re: /\b\d[\d,]*(?:\.\d+)?\s?(?:ms|sec|secs|seconds?|mins?|minutes?|hours?|hrs?|days?|weeks?|months?|years?|kb|mb|gb|tb|bytes?|px|degrees?|celsius|fahrenheit|usd|eur|gbp|kg|km|cm)\b/gi,
    label: 'measurement',
  },
  {
    re: /\b(?:top|first|last|up to|at most|at least|no more than|maximum of|minimum of|exactly)\s+\d[\d,]*\b/gi,
    label: 'count limit',
  },
  { re: /\bv?\d+\.\d+(?:\.\d+)?\b/g, label: 'version' },
  {
    re: /\b(?:starting at|start at|beginning at|above|below|over|under|from)\s+\d[\d,]*(?:\.\d+)?\b/gi,
    label: 'threshold',
  },
  // A bare "number + noun" ("1000 rows", "5 recipients"). Function words after
  // the number are excluded, or "aged 12 to 16" would read as a quantity.
  { re: /\b\d[\d,]*(?:\.\d+)?\s+\p{Ll}[\p{Ll}-]*\b/gu, label: 'count' },
];

/** Words that follow a number without forming a quantity. */
const NOT_A_UNIT = new Set([
  'to',
  'and',
  'or',
  'of',
  'in',
  'on',
  'at',
  'as',
  'is',
  'are',
  'was',
  'were',
  'the',
  'a',
  'an',
  'for',
  'with',
  'by',
  'if',
  'when',
  'that',
  'this',
  'but',
  'so',
  'then',
  'not',
  'no',
  'be',
]);

const ENTITY_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g, label: 'identifier' },
  { re: /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g, label: 'identifier' },
  { re: /\b[a-z]+(?:[A-Z][a-z0-9]+)+\b/g, label: 'identifier' },
  {
    re: /\b[\w./-]+\.(?:ts|tsx|js|jsx|py|json|md|ya?ml|sql|csv|txt|html|css|sh|toml|ini)\b/g,
    label: 'path',
  },
  { re: /\b[A-Z]{2,6}s?\b/g, label: 'acronym' },
];

/** Acronyms that name an output format; they are `format` constraints already. */
const FORMAT_ACRONYMS = new Set(['JSON', 'YAML', 'XML', 'CSV', 'TSV', 'HTML', 'JSONL', 'NDJSON']);

/** Proper nouns: a capitalised word that is not opening its sentence. */
const PROPER_NOUN_RE = /\b\p{Lu}\p{Ll}{2,}\b/gu;

/**
 * Capitalised words that carry no identity: they open sentences, head sections
 * or name a format. Without this list every "Never" and "Output" would be
 * filed as a name.
 */
const NOT_A_NAME = new Set([
  'The',
  'This',
  'That',
  'These',
  'Those',
  'Your',
  'You',
  'Yours',
  'Our',
  'Their',
  'They',
  'When',
  'Where',
  'What',
  'Which',
  'While',
  'With',
  'Without',
  'Within',
  'From',
  'Into',
  'Never',
  'Always',
  'Only',
  'Must',
  'Should',
  'Avoid',
  'Ensure',
  'Make',
  'Note',
  'Include',
  'Example',
  'Examples',
  'Input',
  'Output',
  'Format',
  'Rules',
  'Rule',
  'Goal',
  'Task',
  'Role',
  'Step',
  'Steps',
  'Answer',
  'Respond',
  'Reply',
  'Return',
  'Write',
  'Use',
  'Each',
  'Every',
  'All',
  'Any',
  'Also',
  'Then',
  'Else',
  'For',
  'And',
  'But',
  'Not',
  'Are',
  'Can',
  'Ask',
  'Keep',
  'Read',
  'Send',
  'Show',
  'Stop',
  'Take',
  'Tell',
  'Give',
  'Check',
  'Start',
  'End',
  'Here',
  'There',
  'Under',
  'Over',
  'After',
  'Before',
  'Once',
  'Both',
  'Some',
  'Such',
]);

/**
 * Verbs that open an imperative in a prompt. There is no POS tagger in the
 * bundle, so instruction detection is lexicon-based; `instruction` is a `minor`
 * constraint precisely because this list cannot be complete.
 */
const IMPERATIVE_VERBS = new Set([
  'act',
  'add',
  'analyse',
  'analyze',
  'answer',
  'apply',
  'ask',
  'assign',
  'assume',
  'begin',
  'break',
  'build',
  'call',
  'check',
  'choose',
  'cite',
  'classify',
  'collect',
  'compare',
  'compile',
  'compose',
  'compute',
  'confirm',
  'consider',
  'convert',
  'copy',
  'count',
  'create',
  'decide',
  'describe',
  'detect',
  'determine',
  'do',
  'draft',
  'echo',
  'edit',
  'end',
  'escalate',
  'evaluate',
  'exclude',
  'explain',
  'extract',
  'filter',
  'find',
  'finish',
  'fix',
  'flag',
  'focus',
  'follow',
  'format',
  'generate',
  'give',
  'group',
  'help',
  'highlight',
  'identify',
  'ignore',
  'include',
  'infer',
  'inspect',
  'keep',
  'label',
  'limit',
  'list',
  'log',
  'look',
  'maintain',
  'map',
  'mark',
  'match',
  'mention',
  'merge',
  'name',
  'normalise',
  'normalize',
  'note',
  'offer',
  'omit',
  'output',
  'parse',
  'perform',
  'pick',
  'prefer',
  'preserve',
  'prioritise',
  'prioritize',
  'produce',
  'propose',
  'provide',
  'quote',
  'rank',
  'read',
  'recall',
  'recommend',
  'redact',
  'reduce',
  'refer',
  'reject',
  'remove',
  'render',
  'repeat',
  'rephrase',
  'reply',
  'report',
  'respond',
  'restate',
  'return',
  'review',
  'rewrite',
  'run',
  'sanitise',
  'sanitize',
  'say',
  'score',
  'search',
  'select',
  'send',
  'set',
  'show',
  'skip',
  'sort',
  'split',
  'start',
  'state',
  'stay',
  'stick',
  'stop',
  'store',
  'suggest',
  'summarise',
  'summarize',
  'support',
  'tag',
  'take',
  'tell',
  'think',
  'transform',
  'translate',
  'treat',
  'trim',
  'try',
  'update',
  'use',
  'validate',
  'verify',
  'wait',
  'walk',
  'work',
  'wrap',
  'write',
]);

/** Protected regions that are constraints in their own right. */
const PROTECTED_AS_CONSTRAINT: Partial<
  Record<ProtectedKind, { type: ConstraintType; label: string }>
> = {
  'quoted-string': { type: 'literal', label: 'quoted literal' },
  url: { type: 'literal', label: 'URL' },
  email: { type: 'literal', label: 'email address' },
  variable: { type: 'variable', label: 'template variable' },
  example: { type: 'example', label: 'example block' },
  'inline-code': { type: 'entity', label: 'inline code' },
};

// ─── Extraction ───────────────────────────────────────────────────────────────

export interface ExtractOptions {
  /** Reuse ranges already computed by the caller. */
  ranges?: ProtectedRange[];
  /** Types to skip. Useful for tests and for the AI pipeline of Phase 5. */
  exclude?: readonly ConstraintType[];
}

export function extractConstraints(text: string, options: ExtractOptions = {}): Constraint[] {
  const ranges = options.ranges ?? findProtectedRanges(text);
  const sentences = splitSentences(text, ranges);
  const exclude = new Set(options.exclude ?? []);
  // Markers that sit inside licensed framing are not constraints; see
  // `fillerRanges`. Without this, "It should be noted that X" would record a
  // requirement on "should" and then block the rule that removes the wrapper.
  const fillers = fillerRanges(text);
  const inFiller = (start: number, end: number) =>
    fillers.some((f) => start >= f.start && end <= f.end);

  const candidates: Candidate[] = [];
  const prohibitionMarkers: [number, number][] = [];

  // Prohibitions first: they own the "must not" / "should not" markers, so a
  // requirement scan must not claim them again.
  for (const match of matchesOutsideProtected(text, PROHIBITION_RE, ranges)) {
    const sentence = sentenceAt(sentences, match.index);
    if (!sentence) continue;
    if (inFiller(match.index, match.index + match[0].length)) continue;
    prohibitionMarkers.push([match.index, match.index + match[0].length]);
    candidates.push({
      type: 'prohibition',
      markerStart: match.index,
      markerEnd: match.index + match[0].length,
      start: match.index,
      end: clauseEnd(text, match.index, sentence),
      label: `prohibition ("${match[0].toLowerCase()}")`,
    });
  }

  for (const match of matchesOutsideProtected(text, REQUIREMENT_RE, ranges)) {
    const start = match.index;
    const end = start + match[0].length;
    if (prohibitionMarkers.some(([s, e]) => start < e && s < end)) continue;
    if (inFiller(start, end)) continue;
    const sentence = sentenceAt(sentences, start);
    if (!sentence) continue;
    candidates.push({
      type: 'requirement',
      markerStart: start,
      markerEnd: end,
      start,
      end: clauseEnd(text, start, sentence),
      label: `requirement ("${match[0].toLowerCase()}")`,
    });
  }

  const formatRanges: [number, number][] = [];
  for (const { re, label } of FORMAT_PATTERNS) {
    for (const match of matchesOutsideProtected(text, re, ranges)) {
      const start = match.index;
      const end = start + match[0].length;
      if (formatRanges.some(([s, e]) => start >= s && end <= e)) continue;
      if (inFiller(start, end)) continue;
      if (label === 'output budget' && MEASURE_UNITS.has(headNoun(match[0]))) continue;
      formatRanges.push([start, end]);
      candidates.push({ type: 'format', markerStart: start, markerEnd: end, start, end, label });
    }
  }

  for (const { re, label } of QUANTITY_PATTERNS) {
    for (const match of matchesOutsideProtected(text, re, ranges)) {
      const start = match.index;
      const end = start + match[0].length;
      if (label === 'count' && NOT_A_UNIT.has(/\s(\p{Ll}+)$/u.exec(match[0])?.[1] ?? '')) continue;
      // "no more than 500 words" is already a format (length) constraint;
      // do not also record the bare number inside it.
      if (formatRanges.some(([s, e]) => start >= s && end <= e)) continue;
      if (inFiller(start, end)) continue;
      candidates.push({ type: 'quantity', markerStart: start, markerEnd: end, start, end, label });
    }
  }

  const seenEntities = new Set<string>();
  for (const { re, label } of ENTITY_PATTERNS) {
    for (const match of matchesOutsideProtected(text, re, ranges)) {
      if (FORMAT_ACRONYMS.has(match[0])) continue;
      const key = match[0].toLowerCase();
      if (seenEntities.has(key)) continue;
      seenEntities.add(key);
      const start = match.index;
      const end = start + match[0].length;
      candidates.push({ type: 'entity', markerStart: start, markerEnd: end, start, end, label });
    }
  }

  for (const range of ranges) {
    const mapping = PROTECTED_AS_CONSTRAINT[range.kind];
    if (!mapping) continue;
    candidates.push({
      type: mapping.type,
      markerStart: range.start,
      markerEnd: range.end,
      start: range.start,
      end: range.end,
      label: mapping.label,
      trim: false,
    });
  }

  // A JSON block is protected as a whole, so its keys and enum values would
  // otherwise never be inventoried — and those are exactly the strings a
  // compressed prompt must keep.
  const JSON_STRING_RE = /"(?:[^"\\\n]|\\.)*"/g;
  for (const range of ranges) {
    if (range.kind !== 'json') continue;
    const block = text.slice(range.start, range.end);
    for (const match of block.matchAll(JSON_STRING_RE)) {
      if (match[0].length <= 2) continue;
      candidates.push({
        type: 'literal',
        markerStart: range.start + match.index,
        markerEnd: range.start + match.index + match[0].length,
        start: range.start + match.index,
        end: range.start + match.index + match[0].length,
        label: 'JSON string',
        trim: false,
      });
    }
  }

  for (const match of matchesOutsideProtected(text, PROPER_NOUN_RE, ranges)) {
    if (NOT_A_NAME.has(match[0])) continue;
    const key = match[0].toLowerCase();
    if (seenEntities.has(key)) continue;
    const sentence = sentenceAt(sentences, match.index);
    // A capital at the start of a sentence is grammar, not a name.
    if (sentence && stripsTo(sentence.text) + sentence.start === match.index) continue;
    seenEntities.add(key);
    candidates.push({
      type: 'entity',
      markerStart: match.index,
      markerEnd: match.index + match[0].length,
      start: match.index,
      end: match.index + match[0].length,
      label: 'proper noun',
    });
  }

  for (const sentence of sentences) {
    if (!isImperative(sentence)) continue;
    candidates.push({
      type: 'instruction',
      markerStart: sentence.start,
      markerEnd: sentence.end,
      start: sentence.start,
      end: Math.min(sentence.end, sentence.start + MAX_ANCHOR),
      label: 'imperative instruction',
    });
  }

  const constraints: Constraint[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (exclude.has(candidate.type)) continue;
    const trimmed =
      candidate.trim === false
        ? { start: candidate.start, end: candidate.end }
        : trimAnchor(text, candidate.start, candidate.end);
    if (!trimmed) continue;
    const anchor = text.slice(trimmed.start, trimmed.end);
    if (tokenize(canonicalize(anchor)).length === 0) continue;
    const id = `${candidate.type}:${trimmed.start}-${trimmed.end}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const sentence = sentenceAt(sentences, trimmed.start) ?? {
      text: anchor,
      start: trimmed.start,
      end: trimmed.end,
    };
    constraints.push({
      id,
      type: candidate.type,
      severity: severityFor(candidate.type),
      anchor,
      start: trimmed.start,
      end: trimmed.end,
      sentence: sentence.text,
      sentenceStart: sentence.start,
      sentenceEnd: sentence.end,
      label: candidate.label,
    });
  }

  return constraints.sort((a, b) => a.start - b.start || a.end - b.end);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function* matchesOutsideProtected(
  text: string,
  re: RegExp,
  ranges: readonly ProtectedRange[],
): Generator<RegExpExecArray> {
  const pattern = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
  for (const match of text.matchAll(pattern)) {
    if (match[0].length === 0) continue;
    const start = match.index;
    const end = start + match[0].length;
    if (ranges.some((r) => start < r.end && r.start < end)) continue;
    yield match as RegExpExecArray;
  }
}

/**
 * How far a marker's clause reaches: to the end of its sentence, or to the
 * first `;` / dash separator, whichever comes first, capped at `MAX_ANCHOR`.
 */
function clauseEnd(text: string, from: number, sentence: Sentence): number {
  let end = Math.min(sentence.end, from + MAX_ANCHOR);
  // A coordinated clause is its own constraint: "Never do X, and never do Y"
  // must yield two short anchors rather than one fragile long one.
  const separator = /;|,\s+(?:and|but|or|then)\b|\s[-–—]\s/;
  const match = separator.exec(text.slice(from, end));
  if (match) {
    end = from + match.index;
  } else if (end < sentence.end) {
    // Do not cut a word in half when the length cap bites.
    const cut = text.lastIndexOf(' ', end);
    if (cut > from) end = cut;
  }
  return end;
}

const TRIM_LEADING = /^[\s\-*+#>|.)\]]+/;
const TRIM_TRAILING = /[\s.,;:!?)\]}"'`|-]+$/;

/** Drop list markers and sentence punctuation from the edges of an anchor. */
function trimAnchor(
  text: string,
  start: number,
  end: number,
): { start: number; end: number } | null {
  const slice = text.slice(start, end);
  const leading = TRIM_LEADING.exec(slice)?.[0].length ?? 0;
  const trailing = TRIM_TRAILING.exec(slice.slice(leading))?.[0].length ?? 0;
  const nextStart = start + leading;
  const nextEnd = end - trailing;
  return nextEnd > nextStart ? { start: nextStart, end: nextEnd } : null;
}

/** The last word of a match, lowercased — the noun a limit phrase applies to. */
function headNoun(match: string): string {
  return /(\p{L}[\p{L}-]*)$/u.exec(match)?.[1]?.toLowerCase() ?? '';
}

/** Length of the list marker / punctuation a sentence opens with. */
function stripsTo(text: string): number {
  return TRIM_LEADING.exec(text)?.[0].length ?? 0;
}

/** True when the sentence reads as a command once framing is stripped. */
function isImperative(sentence: Sentence): boolean {
  const tokens = tokenize(canonicalize(sentence.text.replace(TRIM_LEADING, '')));
  const first = tokens[0];
  if (!first) return false;
  if (!IMPERATIVE_VERBS.has(first)) return false;
  // "Use of the cache is optional" is a noun phrase, not a command.
  return tokens.length > 1 && tokens[1] !== 'of';
}

export { IMPERATIVE_VERBS };
