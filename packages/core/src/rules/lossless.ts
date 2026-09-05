import type { Rule } from './types';

/**
 * Level `light`: formatting normalisation only. Nothing here changes wording,
 * so the output means exactly what the input meant — Section 2 requires every
 * `light` rule to be non-lossy.
 */
export const LOSSLESS_RULES: Rule[] = [
  {
    id: 'ws.trailing-space',
    level: 'light',
    lossy: false,
    why: 'Trailing whitespace at end of line carries no information and costs tokens.',
    pattern: /[ \t]+$/gm,
    replacement: '',
    cases: [
      { input: 'hello   \nworld', expected: 'hello\nworld' },
      { input: 'a\t\nb', expected: 'a\nb' },
      {
        input: 'no trailing space',
        expected: 'no trailing space',
        note: 'negative: nothing to trim',
      },
      {
        input: '  indented line',
        expected: '  indented line',
        note: 'negative: leading indent is kept',
      },
    ],
  },
  {
    id: 'ws.repeated-space',
    level: 'light',
    lossy: false,
    why: 'Runs of spaces inside a line are collapsed; indentation at line start is preserved.',
    pattern: /(\S)[ \t]{2,}(?=\S)/g,
    replacement: '$1 ',
    cases: [
      { input: 'one    two', expected: 'one two' },
      { input: 'a\t\tb', expected: 'a b' },
      { input: 'one two', expected: 'one two', note: 'negative: single space untouched' },
      {
        input: '    indented',
        expected: '    indented',
        note: 'negative: leading indentation is structure, not noise',
      },
    ],
  },
  {
    id: 'ws.blank-lines',
    level: 'light',
    lossy: false,
    why: 'More than one blank line between blocks adds tokens without adding structure.',
    pattern: /\n{3,}/g,
    replacement: '\n\n',
    cases: [
      { input: 'a\n\n\n\nb', expected: 'a\n\nb' },
      { input: 'a\n\n\nb', expected: 'a\n\nb' },
      { input: 'a\n\nb', expected: 'a\n\nb', note: 'negative: one blank line is meaningful' },
      { input: 'a\nb', expected: 'a\nb', note: 'negative: single newline untouched' },
    ],
  },
  {
    id: 'ws.nbsp',
    level: 'light',
    lossy: false,
    why: 'Non-breaking and narrow spaces tokenise worse than a plain space and read the same.',
    pattern: /[\u00a0\u2007\u202f]/g,
    replacement: ' ',
    cases: [
      { input: 'a\u00a0b', expected: 'a b' },
      { input: 'a\u202fb', expected: 'a b' },
      { input: 'a b', expected: 'a b', note: 'negative: plain space untouched' },
    ],
  },
  {
    id: 'ws.space-before-punct',
    level: 'light',
    lossy: false,
    why: 'A space before sentence punctuation is a typo, not structure.',
    pattern: /[ \t]+([,.;:!?])/g,
    replacement: '$1',
    cases: [
      { input: 'Answer in JSON .', expected: 'Answer in JSON.' },
      { input: 'first , second', expected: 'first, second' },
      { input: 'Answer in JSON.', expected: 'Answer in JSON.', note: 'negative: already tight' },
    ],
  },
  {
    id: 'md.bullet-marker',
    level: 'light',
    lossy: false,
    why: 'Markdown bullets are normalised to "- " so lists tokenise consistently.',
    pattern: /^([ \t]*)[*+][ \t]+/gm,
    replacement: '$1- ',
    cases: [
      { input: '* one\n* two', expected: '- one\n- two' },
      { input: '  + nested', expected: '  - nested' },
      { input: '- already', expected: '- already', note: 'negative: dash bullets untouched' },
      { input: '*emphasis*', expected: '*emphasis*', note: 'negative: emphasis is not a bullet' },
    ],
  },
  {
    id: 'md.bullet-space',
    level: 'light',
    lossy: false,
    why: 'Extra padding after a "-" bullet marker is not meaningful indentation.',
    pattern: /^([ \t]*-)[ \t]{2,}/gm,
    replacement: '$1 ',
    cases: [
      { input: '-   item', expected: '- item' },
      { input: '  -\t\titem', expected: '  - item' },
      { input: '- item', expected: '- item', note: 'negative: single space is canonical' },
    ],
  },
  {
    id: 'md.ordered-space',
    level: 'light',
    lossy: false,
    why: 'Extra padding after an ordered-list marker is not meaningful indentation.',
    pattern: /^([ \t]*\d+[.)])[ \t]{2,}/gm,
    replacement: '$1 ',
    cases: [
      { input: '1.   first', expected: '1. first' },
      { input: '2)\t\tsecond', expected: '2) second' },
      { input: '1. first', expected: '1. first', note: 'negative: single space is canonical' },
    ],
  },
  {
    id: 'punct.apostrophe',
    level: 'light',
    lossy: false,
    why: 'A typographic apostrophe inside a word is normalised to ASCII; the word is unchanged.',
    pattern: /(\p{L})[’‘](\p{L})/gu,
    replacement: "$1'$2",
    cases: [
      { input: 'don’t stop', expected: "don't stop" },
      { input: 'it’s fine', expected: "it's fine" },
      { input: "don't stop", expected: "don't stop", note: 'negative: already ASCII' },
    ],
  },
];
