/**
 * Segmentation: split a prompt into plain-text regions (rules may rewrite them)
 * and protected regions (rules must never touch them).
 *
 * This module is the safety foundation of PromptTrim: the single reason the
 * legacy engine corrupted prompts was that it applied regexes to the whole
 * string, including code, strings, URLs and template variables.
 *
 * Pure functions, no DOM.
 */

export type ProtectedKind =
  | 'code-fence'
  | 'inline-code'
  | 'example'
  | 'table'
  | 'json'
  | 'url'
  | 'email'
  | 'variable'
  | 'quoted-string';

export interface Segment {
  /** `text` segments are rewritable; `protected` segments are copied verbatim. */
  kind: 'text' | 'protected';
  /** Why the segment is protected. `null` for text segments. */
  protectedKind: ProtectedKind | null;
  text: string;
  /** Offsets into the original input. `[start, end)`. */
  start: number;
  end: number;
}

interface Range {
  start: number;
  end: number;
  kind: ProtectedKind;
}

/** Detector priority: earlier entries win when two candidates overlap. */
const DETECTOR_ORDER: ProtectedKind[] = [
  'code-fence',
  'example',
  'table',
  'json',
  'inline-code',
  'url',
  'email',
  'variable',
  'quoted-string',
];

// ─── Line helpers ─────────────────────────────────────────────────────────────

interface Line {
  text: string;
  start: number;
  /** Offset of the newline (or end of input) that terminates the line. */
  end: number;
}

function splitLines(input: string): Line[] {
  const lines: Line[] = [];
  let start = 0;
  for (let i = 0; i <= input.length; i++) {
    if (i === input.length || input[i] === '\n') {
      lines.push({ text: input.slice(start, i), start, end: i });
      start = i + 1;
    }
  }
  // A trailing newline produces a final empty line; harmless for our scans.
  return lines;
}

// ─── Detectors ────────────────────────────────────────────────────────────────

const FENCE_RE = /^[ \t]{0,3}(```+|~~~+)/;

/** Fenced code blocks. An unterminated fence protects everything to the end. */
function findCodeFences(input: string, lines: Line[]): Range[] {
  const out: Range[] = [];
  let i = 0;
  while (i < lines.length) {
    const open = FENCE_RE.exec(lines[i]!.text);
    if (!open) {
      i++;
      continue;
    }
    const marker = open[1]!;
    const start = lines[i]!.start;
    let end = input.length;
    let next = lines.length;
    for (let j = i + 1; j < lines.length; j++) {
      const close = FENCE_RE.exec(lines[j]!.text);
      if (close && close[1]![0] === marker[0] && close[1]!.length >= marker.length) {
        end = lines[j]!.end;
        next = j + 1;
        break;
      }
    }
    out.push({ start, end, kind: 'code-fence' });
    i = next;
  }
  return out;
}

const EXAMPLE_LABEL_RE =
  /^[ \t]*(?:#{1,6}[ \t]*)?(?:\*\*)?(examples?|input|output|sample|ejemplos?|entrada|salida)(?:\*\*)?[ \t]*[:：]/i;

const EXAMPLE_TAG_RE = /<example\b[^>]*>[\s\S]*?<\/example>/gi;

/**
 * Few-shot example blocks: a labelled line (`Example:`, `Input:`, `Output:`)
 * and everything under it until a blank line that is not followed by another
 * label. Also `<example>…</example>` tags.
 */
function findExamples(input: string, lines: Line[]): Range[] {
  const out: Range[] = [];

  for (const m of input.matchAll(EXAMPLE_TAG_RE)) {
    out.push({ start: m.index, end: m.index + m[0].length, kind: 'example' });
  }

  for (let i = 0; i < lines.length; i++) {
    if (!EXAMPLE_LABEL_RE.test(lines[i]!.text)) continue;
    const start = lines[i]!.start;
    let end = lines[i]!.end;
    let j = i + 1;
    while (j < lines.length) {
      const line = lines[j]!;
      if (line.text.trim() === '') {
        // A blank line ends the block unless another label follows immediately.
        let k = j + 1;
        while (k < lines.length && lines[k]!.text.trim() === '') k++;
        if (k < lines.length && EXAMPLE_LABEL_RE.test(lines[k]!.text)) {
          j = k;
          continue;
        }
        break;
      }
      end = line.end;
      j++;
    }
    out.push({ start, end, kind: 'example' });
    i = j - 1;
  }

  return out;
}

const TABLE_SEPARATOR_RE = /^[ \t]*\|?[ \t]*:?-{2,}:?[ \t]*(\|[ \t]*:?-{2,}:?[ \t]*)+\|?[ \t]*$/;

/** Markdown tables: a pipe row plus a `---|---` separator row. */
function findTables(lines: Line[]): Range[] {
  const out: Range[] = [];
  for (let i = 1; i < lines.length; i++) {
    if (!TABLE_SEPARATOR_RE.test(lines[i]!.text)) continue;
    if (!lines[i - 1]!.text.includes('|')) continue;
    let first = i - 1;
    while (first > 0 && lines[first - 1]!.text.includes('|')) first--;
    let last = i;
    while (last + 1 < lines.length && lines[last + 1]!.text.includes('|')) last++;
    out.push({ start: lines[first]!.start, end: lines[last]!.end, kind: 'table' });
    i = last;
  }
  return out;
}

/**
 * JSON objects and arrays, detected by shape: a balanced brace/bracket span
 * that `JSON.parse` accepts as an object or array.
 *
 * YAML is only protected when it appears inside a fenced block or between
 * `---` document markers (handled by the fence detector); heuristic YAML
 * sniffing produced too many false positives on prose like `Note: do this`.
 */
function findJson(input: string): Range[] {
  const out: Range[] = [];
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    if (ch !== '{' && ch !== '[') continue;
    const end = matchBalanced(input, i);
    if (end === -1) continue;
    const candidate = input.slice(i, end);
    if (candidate.length < 4) continue;
    try {
      const parsed: unknown = JSON.parse(candidate);
      if (parsed !== null && typeof parsed === 'object') {
        out.push({ start: i, end, kind: 'json' });
        i = end - 1;
      }
    } catch {
      // Not JSON; leave it to the variable/quoted-string detectors.
    }
  }
  return out;
}

/** Returns the offset just past the balanced closer, or -1. */
function matchBalanced(input: string, from: number): number {
  const stack: string[] = [];
  let inString: '"' | null = null;
  for (let i = from; i < input.length; i++) {
    const ch = input[i]!;
    if (inString) {
      if (ch === '\\') i++;
      else if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"') {
      inString = '"';
      continue;
    }
    if (ch === '{' || ch === '[') stack.push(ch);
    else if (ch === '}' || ch === ']') {
      const open = stack.pop();
      if (!open) return -1;
      if ((ch === '}') !== (open === '{')) return -1;
      if (stack.length === 0) return i + 1;
    }
  }
  return -1;
}

const SIMPLE_PATTERNS: { kind: ProtectedKind; re: RegExp }[] = [
  { kind: 'inline-code', re: /(`+)(?:(?!\1)[^\n])+\1/g },
  { kind: 'url', re: /\b(?:https?:\/\/|www\.)[^\s<>"'`)\]]+/gi },
  { kind: 'email', re: /\b[\w.+-]+@[\w-]+\.[\w.-]*\w\b/g },
  // Template variables, in decreasing specificity.
  { kind: 'variable', re: /\{\{[^{}\n]*\}\}/g },
  { kind: 'variable', re: /\$\{[^{}\n]*\}/g },
  { kind: 'variable', re: /\{[A-Za-z0-9_.\-| ]{1,48}\}/g },
  { kind: 'variable', re: /%\(\w+\)[sdifr]|%[sdifr]\b/g },
  { kind: 'variable', re: /<\/?[A-Za-z][\w:.-]*(?:\s[^<>\n]*?)?\/?>/g },
  { kind: 'variable', re: /\[[A-Z][A-Z0-9_ ]{1,32}\]/g },
  // Quoted literals. Straight single quotes need lookarounds so that
  // apostrophes in words like "don't" are not read as string delimiters.
  { kind: 'quoted-string', re: /"[^"\n]{1,300}"/g },
  { kind: 'quoted-string', re: /“[^”\n]{0,300}”/g },
  {
    kind: 'quoted-string',
    re: /(?<=^|[\s([{:;,\-–—])'[^'\n]{1,300}'(?=$|[\s)\]}.,;:!?])/g,
  },
  {
    kind: 'quoted-string',
    re: /(?<=^|[\s([{:;,\-–—])‘[^’\n]{1,300}’(?=$|[\s)\]}.,;:!?])/g,
  },
];

/** URLs commonly end a sentence; do not swallow the sentence punctuation. */
function trimUrlTail(input: string, range: Range): Range {
  if (range.kind !== 'url') return range;
  let end = range.end;
  while (end > range.start && /[.,;:!?)\]]/.test(input[end - 1]!)) end--;
  return { ...range, end };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Collect protected ranges, resolving overlaps by detector priority. */
export function findProtectedRanges(input: string): Range[] {
  const lines = splitLines(input);
  const byKind = new Map<ProtectedKind, Range[]>();
  const push = (ranges: Range[]) => {
    for (const r of ranges) {
      if (r.end <= r.start) continue;
      const list = byKind.get(r.kind) ?? [];
      list.push(r);
      byKind.set(r.kind, list);
    }
  };

  push(findCodeFences(input, lines));
  push(findExamples(input, lines));
  push(findTables(lines));
  push(findJson(input));
  for (const { kind, re } of SIMPLE_PATTERNS) {
    const found: Range[] = [];
    for (const m of input.matchAll(re)) {
      found.push(trimUrlTail(input, { start: m.index, end: m.index + m[0].length, kind }));
    }
    push(found);
  }

  const accepted: Range[] = [];
  const overlaps = (r: Range) => accepted.some((a) => r.start < a.end && a.start < r.end);
  for (const kind of DETECTOR_ORDER) {
    const candidates = (byKind.get(kind) ?? []).sort((a, b) => a.start - b.start || b.end - a.end);
    for (const c of candidates) {
      if (!overlaps(c)) accepted.push(c);
    }
  }
  return accepted.sort((a, b) => a.start - b.start);
}

/**
 * Split `input` into alternating text / protected segments covering the whole
 * string. Concatenating every `segment.text` reproduces the input exactly.
 */
export function segment(input: string): Segment[] {
  const ranges = findProtectedRanges(input);
  const segments: Segment[] = [];
  let cursor = 0;
  for (const r of ranges) {
    if (r.start > cursor) {
      segments.push({
        kind: 'text',
        protectedKind: null,
        text: input.slice(cursor, r.start),
        start: cursor,
        end: r.start,
      });
    }
    segments.push({
      kind: 'protected',
      protectedKind: r.kind,
      text: input.slice(r.start, r.end),
      start: r.start,
      end: r.end,
    });
    cursor = r.end;
  }
  if (cursor < input.length) {
    segments.push({
      kind: 'text',
      protectedKind: null,
      text: input.slice(cursor),
      start: cursor,
      end: input.length,
    });
  }
  return segments;
}

/** True when `[start, end)` intersects any protected range. */
export function isProtectedRange(ranges: Range[], start: number, end: number): boolean {
  return ranges.some((r) => start < r.end && r.start < end);
}

export type { Range as ProtectedRange };
