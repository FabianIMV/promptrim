/**
 * Constraint Ledger — restoring a lost constraint.
 *
 * The checklist is only useful if a ✗ is one click from being fixed. Restoring
 * re-inserts the *original sentence* (not just the anchor) as close to its
 * original position as the compressed text allows: after the nearest earlier
 * sentence that survived, otherwise before the nearest later one, otherwise at
 * the end. The caller gets a new string; nothing is mutated.
 */

import { splitSentences } from './sentences';
import type { Sentence } from './sentences';
import { containsTokens, reduceToTokens } from './normalize';
import type { Constraint } from './types';

/** Sentences shorter than this are too generic to anchor an insertion. */
const MIN_ANCHOR_CHARS = 8;

export function restoreConstraint(
  original: string,
  compressed: string,
  constraint: Constraint,
): string {
  const sentence = constraint.sentence.trim();
  if (sentence === '') return compressed;
  if (containsTokens(reduceToTokens(compressed), reduceToTokens(sentence))) return compressed;

  const sentences = splitSentences(original);
  const index = sentences.findIndex((s) => s.start === constraint.sentenceStart);
  const onOwnLine = startsLine(original, constraint.sentenceStart);
  const separator = onOwnLine ? '\n' : ' ';

  for (let i = index - 1; i >= 0; i--) {
    const at = locate(compressed, sentences[i]!);
    if (at === -1) continue;
    const cut = at + sentences[i]!.text.length;
    return splice(compressed, cut, separator + sentence);
  }

  for (let i = index + 1; i < sentences.length && index !== -1; i++) {
    const at = locate(compressed, sentences[i]!);
    if (at === -1) continue;
    return splice(compressed, at, sentence + separator);
  }

  const tail = compressed.endsWith('\n') ? '' : compressed.includes('\n') ? '\n' : ' ';
  return compressed === '' ? sentence : compressed + tail + sentence;
}

function locate(compressed: string, sentence: Sentence): number {
  if (sentence.text.trim().length < MIN_ANCHOR_CHARS) return -1;
  return compressed.indexOf(sentence.text);
}

function splice(text: string, at: number, insert: string): string {
  return text.slice(0, at) + insert + text.slice(at);
}

function startsLine(text: string, index: number): boolean {
  for (let i = index - 1; i >= 0; i--) {
    const ch = text[i]!;
    if (ch === '\n') return true;
    if (ch !== ' ' && ch !== '\t') return false;
  }
  return true;
}
