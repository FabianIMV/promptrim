/**
 * Constraint Ledger — sentence segmentation.
 *
 * Sentences bound how far an anchor may reach and are the unit that the
 * "Restore" button re-inserts. Splitting is deliberately conservative: a
 * boundary is only recognised outside protected regions, so a full stop inside
 * a URL, a code fence or `{{template.var}}` never splits anything.
 */

import { findProtectedRanges } from '../segment';
import type { ProtectedRange } from '../segment';

export interface Sentence {
  text: string;
  start: number;
  end: number;
}

const SENTENCE_BREAK = /[.!?](?=["')\]]?(?:\s|$))/g;

function inProtected(ranges: readonly ProtectedRange[], index: number): boolean {
  return ranges.some((r) => index >= r.start && index < r.end);
}

/**
 * Split on line breaks first (a list item or a heading is its own sentence,
 * even without punctuation), then on sentence-final punctuation.
 */
export function splitSentences(
  text: string,
  ranges: readonly ProtectedRange[] = findProtectedRanges(text),
): Sentence[] {
  const out: Sentence[] = [];

  let lineStart = 0;
  for (let i = 0; i <= text.length; i++) {
    if (i !== text.length && text[i] !== '\n') continue;
    pushLine(text, ranges, lineStart, i, out);
    lineStart = i + 1;
  }
  return out;
}

function pushLine(
  text: string,
  ranges: readonly ProtectedRange[],
  start: number,
  end: number,
  out: Sentence[],
): void {
  const line = text.slice(start, end);
  if (line.trim() === '') return;

  const breaks: number[] = [];
  SENTENCE_BREAK.lastIndex = 0;
  for (const match of line.matchAll(SENTENCE_BREAK)) {
    const absolute = start + match.index;
    if (inProtected(ranges, absolute)) continue;
    // "e.g." / "1." / "No." are not sentence ends.
    if (isAbbreviation(line, match.index)) continue;
    breaks.push(absolute + 1);
  }
  breaks.push(end);

  let cursor = start;
  for (const boundary of breaks) {
    if (boundary <= cursor) continue;
    const slice = text.slice(cursor, boundary);
    if (slice.trim() !== '') {
      const leading = slice.length - slice.trimStart().length;
      const trailing = slice.length - slice.trimEnd().length;
      out.push({
        text: text.slice(cursor + leading, boundary - trailing),
        start: cursor + leading,
        end: boundary - trailing,
      });
    }
    cursor = boundary;
  }
}

const ABBREVIATIONS = ['e.g', 'i.e', 'etc', 'vs', 'no', 'fig', 'approx', 'cf', 'al'];

function isAbbreviation(line: string, dotIndex: number): boolean {
  if (line[dotIndex] !== '.') return false;
  const before = line.slice(0, dotIndex);
  // A bare list marker: "1." / "12)" at the start of the line.
  if (/^\s*\d+$/.test(before)) return true;
  const word = /([\p{L}.]+)$/u.exec(before)?.[1]?.toLowerCase();
  return word !== undefined && ABBREVIATIONS.includes(word.replace(/\.$/, ''));
}

/** The sentence containing `index`, or `null` when it falls between sentences. */
export function sentenceAt(sentences: readonly Sentence[], index: number): Sentence | null {
  return sentences.find((s) => index >= s.start && index < s.end) ?? null;
}
