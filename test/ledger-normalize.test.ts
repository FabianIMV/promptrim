import { describe, expect, it } from 'vitest';
import {
  canonicalize,
  containsTokens,
  countOccurrences,
  reduceToTokens,
  tokenize,
  tokenSimilarity,
} from '../src/core/ledger';
import { ALL_RULES } from '../src/core/rules';

describe('canonicalize', () => {
  it('lowercases and drops punctuation', () => {
    expect(reduceToTokens('Answer in JSON.')).toEqual(['answer', 'in', 'json']);
  });

  it('applies the non-lossy substitution equivalences', () => {
    expect(reduceToTokens('Read the file in order to utilize the parser')).toEqual(
      reduceToTokens('Read the file to use the parser'),
    );
  });

  it('normalises typographic quotes and non-breaking spaces', () => {
    expect(reduceToTokens('don’t stop')).toEqual(reduceToTokens("don't stop"));
  });

  it('keeps % and $ as tokens so a unit cannot be dropped silently', () => {
    expect(tokenize(canonicalize('50%'))).toEqual(['50', '%']);
    expect(tokenize(canonicalize('$5'))).toEqual(['$', '5']);
    expect(containsTokens(reduceToTokens('return 50 rows'), reduceToTokens('50%'))).toBe(false);
  });

  it('drops politeness, request framing and intensifiers', () => {
    expect(reduceToTokens('Could you please write a very short summary')).toEqual([
      'write',
      'a',
      'short',
      'summary',
    ]);
  });

  it('never drops an instruction word', () => {
    for (const word of ['never', 'always', 'must', 'only', 'ensure', 'step', 'not', 'no']) {
      expect(reduceToTokens(`you ${word} do it`), word).toContain(word);
    }
  });
});

/**
 * The ledger is only as trustworthy as this invariant: the vocabulary it
 * normalises away must be exactly what the shipped deletion rules remove. If a
 * rule ever deleted anything else, this test fails — and so would the rule's
 * own output at Aggressive, where the ledger reverts it.
 */
describe('licensed vocabulary matches the deletion rules', () => {
  const deletionRules = ALL_RULES.filter((r) => r.replacement === '');

  it('covers every shipped deletion rule', () => {
    expect(deletionRules.length).toBeGreaterThan(5);
  });

  for (const rule of deletionRules) {
    for (const testCase of rule.cases) {
      it(`${rule.id}: "${testCase.input}" reduces the same before and after`, () => {
        expect(reduceToTokens(testCase.input)).toEqual(reduceToTokens(testCase.expected));
      });
    }
  }
});

describe('countOccurrences', () => {
  it('counts every position at which the needle occurs', () => {
    expect(countOccurrences(['a', 'b', 'a', 'b'], ['a', 'b'])).toBe(2);
  });

  it('is 0 for an empty or oversized needle', () => {
    expect(countOccurrences(['a'], [])).toBe(0);
    expect(countOccurrences(['a'], ['a', 'b'])).toBe(0);
  });
});

describe('tokenSimilarity', () => {
  it('is 1 for identical token sets and 0 for disjoint ones', () => {
    expect(tokenSimilarity(['a', 'b'], ['b', 'a'])).toBe(1);
    expect(tokenSimilarity(['a'], ['b'])).toBe(0);
    expect(tokenSimilarity([], ['b'])).toBe(0);
  });
});
