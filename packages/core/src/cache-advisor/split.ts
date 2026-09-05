/**
 * Static prefix / dynamic suffix split.
 *
 * Prompt caching is *prefix* caching: a provider can only reuse the bytes from
 * the start of the prompt up to the first byte that differs between two
 * requests. So the question this module answers is not "which parts look
 * dynamic" but "where does the identical part stop".
 *
 * Two offsets come out of it:
 *
 * - `boundary` — where per-request *sections* start (`User:`, `<documents>`,
 *   `Context:`). Everything after that is dynamic by design.
 * - `cacheableEnd` — where the cacheable prefix actually stops *today*, which
 *   is earlier whenever something varying sits above the boundary: a date in
 *   the system prompt, a request id, a template variable. Anthropic's caching
 *   guide calls these out as the common mistake ("a per-request block
 *   containing a timestamp… no cache hit, you pay for a fresh cache write on
 *   every request"), and they are silent: nothing errors, you just never get a
 *   hit. We report them as `invalidators` and offer to move them below the
 *   breakpoint.
 *
 * Markers inside protected example or code regions are ignored: a date in a
 * few-shot example is illustrative, and few-shot blocks are exactly the kind of
 * bulk you want *inside* the cached prefix.
 *
 * Pure functions, no DOM.
 */

import { findProtectedRanges } from '../segment';

export type MarkerKind = 'section' | 'variable' | 'date' | 'identifier';

export interface DynamicMarker {
  kind: MarkerKind;
  /** The matched text, e.g. `Current date:` or `{{user_query}}`. */
  text: string;
  /** Offsets into the original prompt. `[start, end)`. */
  start: number;
  end: number;
  /** 0-based index of the line the marker starts on. */
  line: number;
  /** Human-readable reason this makes the surrounding text per-request. */
  why: string;
}

export interface PromptSplit {
  /** Offset where per-request sections begin; `text.length` when there are none. */
  boundary: number;
  /** Offset where the cacheable prefix ends as the prompt is written today. */
  cacheableEnd: number;
  /** `text.slice(0, cacheableEnd)` — what a cache would hold today. */
  staticPrefix: string;
  /** `text.slice(cacheableEnd)` — everything a cache cannot hold today. */
  dynamicSuffix: string;
  /** The prefix once every invalidator line moves below the breakpoint. */
  reorderedPrefix: string;
  /** Invalidator lines plus the dynamic sections, in their original order. */
  reorderedSuffix: string;
  /** Every dynamic marker found, in document order. */
  markers: DynamicMarker[];
  /** Markers above `boundary`: the ones cutting the prefix short for nothing. */
  invalidators: DynamicMarker[];
}

const SECTION_LABEL_RE =
  /^[ \t]*(?:#{1,6}[ \t]*)?(?:\*\*|__)?(user(?: query| message| input| question)?|human|question|query|context|documents?|retrieved(?: documents?| context| passages| chunks)?|conversation(?: history)?|chat history|history|transcript|input)(?:\*\*|__)?[ \t]*:/i;

const SECTION_TAG_RE =
  /<(user(?:_(?:query|message|input|question))?|human|question|query|context|documents?|retrieved_?\w*|conversation(?:_history)?|chat_history|history|transcript|input)\b[^>]*>/gi;

const DATE_HINT_RE =
  /\b(?:current date|current time|current datetime|today'?s date|today is|date today|now is|as of (?:today|now)|timestamp)\b/gi;

const ISO_DATE_RE = /\b\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:?\d{2})?)?\b/g;

const ID_HINT_RE =
  /\b(?:request|session|conversation|thread|trace|correlation|user|customer|account|order|ticket|tenant)[ _-]?(?:id|uuid)s?\b/gi;

const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

const DATE_NAME_RE = /(?:^|[^a-z])(date|time|now|today|timestamp|clock|day)(?:[^a-z]|$)/i;
const ID_NAME_RE = /(?:^|[^a-z])(id|uuid|session|request|thread|trace)(?:[^a-z]|$)/i;

const WHY: Record<MarkerKind, string> = {
  section: 'Per-request section: everything from here down changes on every call.',
  variable:
    'Template variable: unless it holds the same value on every call, the cache stops here.',
  date: 'Date or timestamp: changes every day (or every call) and silently kills the cache.',
  identifier: 'Per-request identifier: a new value on every call, so no two prefixes match.',
};

interface LineIndex {
  /** Start offset of each line. */
  starts: number[];
  /** End offset of each line, excluding its newline. */
  ends: number[];
  texts: string[];
}

function indexLines(text: string): LineIndex {
  const starts: number[] = [];
  const ends: number[] = [];
  const texts: string[] = [];
  let start = 0;
  for (let i = 0; i <= text.length; i++) {
    if (i === text.length || text[i] === '\n') {
      starts.push(start);
      ends.push(i);
      texts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  return { starts, ends, texts };
}

function lineOf(index: LineIndex, offset: number): number {
  let lo = 0;
  let hi = index.starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (index.starts[mid]! <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Classify a template variable by its name: `{{today}}` is a date, `{{req_id}}` an id. */
function variableKind(text: string): MarkerKind {
  const name = text.replace(/[^A-Za-z0-9_ .-]/g, ' ').trim();
  if (DATE_NAME_RE.test(name)) return 'date';
  if (ID_NAME_RE.test(name)) return 'identifier';
  return 'variable';
}

/**
 * Find every marker that makes the text around it vary per request.
 *
 * Overlaps are resolved by document order and by length: the first marker wins,
 * and a marker inside one already accepted is dropped, so `<documents>` is
 * reported once as a section rather than also as a template variable.
 */
export function findDynamicMarkers(text: string): DynamicMarker[] {
  const index = indexLines(text);
  const protectedRanges = findProtectedRanges(text);
  const skip = protectedRanges.filter((r) => r.kind === 'example' || r.kind === 'code-fence');
  const inSkipped = (start: number) => skip.some((r) => start >= r.start && start < r.end);

  const found: DynamicMarker[] = [];
  const push = (kind: MarkerKind, start: number, end: number, matched: string) => {
    if (inSkipped(start)) return;
    found.push({
      kind,
      text: matched,
      start,
      end,
      line: lineOf(index, start),
      why: WHY[kind],
    });
  };

  index.texts.forEach((line, i) => {
    const m = SECTION_LABEL_RE.exec(line);
    if (m) push('section', index.starts[i]!, index.starts[i]! + m[0].length, m[0].trim());
  });

  for (const m of text.matchAll(SECTION_TAG_RE)) {
    push('section', m.index, m.index + m[0].length, m[0]);
  }
  for (const m of text.matchAll(DATE_HINT_RE)) {
    push('date', m.index, m.index + m[0].length, m[0]);
  }
  for (const m of text.matchAll(ISO_DATE_RE)) {
    push('date', m.index, m.index + m[0].length, m[0]);
  }
  for (const m of text.matchAll(ID_HINT_RE)) {
    push('identifier', m.index, m.index + m[0].length, m[0]);
  }
  for (const m of text.matchAll(UUID_RE)) {
    push('identifier', m.index, m.index + m[0].length, m[0]);
  }
  for (const range of protectedRanges) {
    if (range.kind !== 'variable') continue;
    const matched = text.slice(range.start, range.end);
    push(variableKind(matched), range.start, range.end, matched);
  }

  const order: MarkerKind[] = ['section', 'date', 'identifier', 'variable'];
  const accepted: DynamicMarker[] = [];
  const sorted = [...found].sort(
    (a, b) => a.start - b.start || order.indexOf(a.kind) - order.indexOf(b.kind),
  );
  for (const marker of sorted) {
    if (accepted.some((a) => marker.start < a.end && a.start < marker.end)) continue;
    accepted.push(marker);
  }
  return accepted;
}

/**
 * Split `text` into the part a cache can hold and the part it cannot, and work
 * out what the prefix would be if the invalidators moved below the breakpoint.
 */
export function splitPrompt(text: string): PromptSplit {
  const index = indexLines(text);
  const markers = findDynamicMarkers(text);

  const firstSection = markers.find((m) => m.kind === 'section');
  const boundary = firstSection ? index.starts[firstSection.line]! : text.length;

  const invalidators = markers.filter((m) => m.kind !== 'section' && m.start < boundary);
  const cacheableEnd = invalidators.length ? Math.min(invalidators[0]!.start, boundary) : boundary;

  const boundaryLine = firstSection ? firstSection.line : index.texts.length;
  const invalidatorLines = new Set(invalidators.map((m) => m.line));

  const staticLines: string[] = [];
  const movedLines: string[] = [];
  for (let i = 0; i < index.texts.length; i++) {
    if (i >= boundaryLine) break;
    (invalidatorLines.has(i) ? movedLines : staticLines).push(index.texts[i]!);
  }
  const tail = boundaryLine < index.texts.length ? text.slice(index.starts[boundaryLine]!) : '';

  const reorderedSuffix = [movedLines.join('\n'), tail].filter((part) => part !== '').join('\n');

  return {
    boundary,
    cacheableEnd,
    staticPrefix: text.slice(0, cacheableEnd),
    dynamicSuffix: text.slice(cacheableEnd),
    reorderedPrefix: staticLines.join('\n'),
    reorderedSuffix,
    markers,
    invalidators,
  };
}
