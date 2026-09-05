import { describe, expect, it } from 'vitest';
import { compress } from '../packages/core/src/compress';
import { ALL_RULES, DISCARDED_RULES, rulesForLevel } from '../packages/core/src/rules';
import type { Rule } from '../packages/core/src/rules';

describe('rule policy (docs/PLAN.md, Section 2)', () => {
  it('every rule id is unique', () => {
    const ids = ALL_RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every rule declares id, level, lossy, a readable "why" and a global pattern', () => {
    for (const rule of ALL_RULES) {
      expect(rule.id, 'rule id').toMatch(/^[a-z]+(?:[.-][a-z0-9-]+)+$/);
      expect(['light', 'balanced', 'aggressive']).toContain(rule.level);
      expect(typeof rule.lossy).toBe('boolean');
      expect(rule.why.length, `${rule.id} needs a "why"`).toBeGreaterThan(20);
      expect(rule.pattern.flags, `${rule.id} must be global`).toContain('g');
    }
  });

  it('no light rule is lossy', () => {
    for (const rule of rulesForLevel('light')) {
      expect(rule.lossy, `${rule.id} runs at light and must be lossless`).toBe(false);
    }
  });

  it('every rule ships at least 3 cases, including a negative one', () => {
    for (const rule of ALL_RULES) {
      expect(rule.cases.length, `${rule.id} needs >= 3 cases`).toBeGreaterThanOrEqual(3);
      const negatives = rule.cases.filter((c) => c.input === c.expected);
      expect(negatives.length, `${rule.id} needs a negative case`).toBeGreaterThanOrEqual(1);
      for (const negative of negatives) {
        expect(negative.note, `${rule.id} negative cases must explain themselves`).toBeTruthy();
      }
    }
  });

  it('levels are cumulative', () => {
    const light = rulesForLevel('light').map((r) => r.id);
    const balanced = rulesForLevel('balanced').map((r) => r.id);
    const aggressive = rulesForLevel('aggressive').map((r) => r.id);
    expect(balanced).toEqual(expect.arrayContaining(light));
    expect(aggressive).toEqual(expect.arrayContaining(balanced));
    expect(aggressive.length).toBe(ALL_RULES.length);
  });
});

describe('rule cases', () => {
  const byId = new Map<string, Rule>(ALL_RULES.map((r) => [r.id, r]));
  for (const rule of ALL_RULES) {
    describe(rule.id, () => {
      for (const testCase of rule.cases) {
        const label = testCase.note ? `${testCase.note}: ${testCase.input}` : testCase.input;
        it(JSON.stringify(label), () => {
          const only = byId.get(rule.id)!;
          const result = compress(testCase.input, rule.level, { rules: [only] });
          expect(result.output).toBe(testCase.expected);
        });
      }
    });
  }
});

describe('discarded legacy rules stay discarded', () => {
  it('documents every rejection with a reason and an example', () => {
    expect(DISCARDED_RULES.length).toBeGreaterThanOrEqual(10);
    for (const entry of DISCARDED_RULES) {
      expect(entry.legacy).toBeTruthy();
      expect(entry.reason.length).toBeGreaterThan(20);
      expect(entry.example).toBeTruthy();
    }
  });

  it.each([
    ['step by step', 'Solve the problem step by step.'],
    ['Make sure to', 'Make sure to validate the input before sending.'],
    ['ensure', 'You must ensure the output is valid JSON.'],
    ['Always', 'Always answer in JSON.'],
    ['never', 'You should never expose the API key.'],
    ['only', 'Return only the JSON object.'],
    ['must', 'The reply must be under 100 words.'],
    ['Note that', 'Note that ids must be UUID v4.'],
    ['detailed', 'Write a detailed analysis.'],
    ['Feel free to', 'Feel free to ask a clarifying question.'],
    ['If possible', 'If possible, cite the source.'],
    ['Thank you', 'Summarise the ticket.\nThank you.'],
    ['in a structured format', 'Respond in a structured format.'],
    ['The following are', 'The following are the rules:'],
    ['You are required to', 'You are required to cite sources.'],
  ])('keeps "%s" at the aggressive level', (phrase, prompt) => {
    expect(compress(prompt, 'aggressive').output).toContain(phrase);
  });

  it('never drops a repeated instruction', () => {
    const prompt = 'Answer in JSON. Do not add prose. Answer in JSON.';
    const result = compress(prompt, 'aggressive');
    expect(result.output).toBe(prompt);
  });
});
