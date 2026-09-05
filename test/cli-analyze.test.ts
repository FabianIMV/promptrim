/**
 * The measurement half of `promptrim check`: token counts, the delta against
 * a base version, the budget verdict, duplicated instructions and the
 * ledger-verified compression suggestion.
 *
 * These run on strings, never on the filesystem — `analyzeFile` takes the
 * content and the base content as arguments precisely so that the numbers can
 * be pinned without a fixture tree. `gpt-4o` is used wherever the count itself
 * matters, because its tokenizer runs locally and exactly; the Anthropic
 * default is used only to assert that an estimate is *labelled* as one.
 */
import { describe, expect, it } from 'vitest';
import { analyzeFile, apiKeyEnvName, resolveModel, totalsFor } from '../packages/cli/src/analyze';
import type { AnalyzeContext, FileAnalysis } from '../packages/cli/src/analyze';

const VERBOSE = [
  'Please make sure that you carefully review the pull request in order to find bugs.',
  'In order to do that, you should never approve a change that has no tests.',
  'You must always respond in JSON format.',
  '',
  'It is important to note that you should never approve a change that lacks tests.',
  '',
].join('\n');

const TERSE = 'Review the pull request.\n';

function ctx(overrides: Partial<AnalyzeContext> = {}): AnalyzeContext {
  return {
    model: resolveModel('gpt-4o'),
    level: 'balanced',
    budget: null,
    callsPerDay: 1000,
    ...overrides,
  };
}

describe('resolveModel', () => {
  it('resolves a model from the pricing data', () => {
    expect(resolveModel('claude-opus-5').provider).toBe('anthropic');
  });

  it('names the file to look in when the id is unknown', () => {
    expect(() => resolveModel('gpt-9')).toThrow(/pricing\.json/);
  });
});

describe('apiKeyEnvName', () => {
  it('maps each provider to the variable that holds its key', () => {
    expect(apiKeyEnvName({ provider: 'anthropic' })).toBe('ANTHROPIC_API_KEY');
    expect(apiKeyEnvName({ provider: 'openai' })).toBe('OPENAI_API_KEY');
    expect(apiKeyEnvName({ provider: 'gemini' })).toBe('GEMINI_API_KEY');
  });
});

describe('analyzeFile', () => {
  it('counts OpenAI tokens exactly, with the real tokenizer', async () => {
    const file = await analyzeFile(
      { path: 'p.md', content: 'hello world', baseContent: null },
      ctx(),
    );
    expect(file.tokens).toBe(2);
    expect(file.exact).toBe(true);
  });

  it('marks an Anthropic count as an estimate when there is no key', async () => {
    const file = await analyzeFile(
      { path: 'p.md', content: VERBOSE, baseContent: null },
      ctx({ model: resolveModel('claude-sonnet-5') }),
    );
    expect(file.exact).toBe(false);
    expect(file.tokens).toBeGreaterThan(0);
  });

  it('reports the delta against the base version', async () => {
    const file = await analyzeFile({ path: 'p.md', content: VERBOSE, baseContent: TERSE }, ctx());
    expect(file.baseTokens).toBeGreaterThan(0);
    expect(file.deltaTokens).toBe(file.tokens - (file.baseTokens ?? 0));
    expect(file.deltaTokens).toBeGreaterThan(0);
    expect(file.deltaRatio).toBeCloseTo(file.tokens / (file.baseTokens ?? 1) - 1, 10);
    expect(file.monthlyDelta).toBeGreaterThan(0);
  });

  it('leaves the delta null for a file that is new on this branch', async () => {
    const file = await analyzeFile({ path: 'p.md', content: VERBOSE, baseContent: null }, ctx());
    expect(file.baseTokens).toBeNull();
    expect(file.deltaTokens).toBeNull();
    expect(file.deltaRatio).toBeNull();
    expect(file.monthlyDelta).toBeNull();
  });

  it('does not divide by zero when the file was empty on the base', async () => {
    const file = await analyzeFile({ path: 'p.md', content: VERBOSE, baseContent: '' }, ctx());
    expect(file.baseTokens).toBe(0);
    expect(file.deltaTokens).toBe(file.tokens);
    expect(file.deltaRatio).toBeNull();
  });

  it('flags a file over the budget and says by how much', async () => {
    const over = await analyzeFile(
      { path: 'p.md', content: VERBOSE, baseContent: null },
      ctx({ budget: 20 }),
    );
    expect(over.overBudget).toBe(true);
    expect(over.overBudgetBy).toBe(over.tokens - 20);

    const under = await analyzeFile(
      { path: 'p.md', content: VERBOSE, baseContent: null },
      ctx({ budget: 5000 }),
    );
    expect(under.overBudget).toBe(false);
    expect(under.overBudgetBy).toBe(0);
  });

  it('projects the monthly cost from the model price and the call volume', async () => {
    const model = resolveModel('gpt-4o');
    const file = await analyzeFile(
      { path: 'p.md', content: VERBOSE, baseContent: null },
      ctx({ callsPerDay: 50_000 }),
    );
    expect(file.monthlyCost).toBeCloseTo(
      (file.tokens / 1e6) * model.input_per_mtok * 50_000 * 30,
      8,
    );
  });

  it('suggests a compression only when it saves tokens and the ledger verified it', async () => {
    const file = await analyzeFile({ path: 'p.md', content: VERBOSE, baseContent: null }, ctx());
    const suggestion = file.suggestion;
    expect(suggestion).not.toBeNull();
    expect(suggestion?.verified).toBe(true);
    expect(suggestion?.savedTokens).toBeGreaterThan(0);
    expect(suggestion?.tokens).toBe(file.tokens - (suggestion?.savedTokens ?? 0));
    expect(suggestion?.criticalPreserved).toBe(suggestion?.criticalTotal);
    expect(suggestion?.written).toBe(false);
  });

  it('keeps every critical instruction in the suggested output', async () => {
    const file = await analyzeFile({ path: 'p.md', content: VERBOSE, baseContent: null }, ctx());
    const output = file.suggestion?.output ?? '';
    expect(output).toContain('never approve a change that has no tests');
    expect(output).toContain('always respond in JSON format');
    // "in order to" → "to" is the kind of substitution that is allowed.
    expect(output).not.toContain('in order to');
  });

  it('offers nothing for a prompt that is already terse', async () => {
    const file = await analyzeFile({ path: 'p.md', content: TERSE, baseContent: null }, ctx());
    expect(file.suggestion).toBeNull();
  });

  it('runs the ledger at every level, not only at aggressive', async () => {
    for (const level of ['light', 'balanced', 'aggressive'] as const) {
      const file = await analyzeFile(
        { path: 'p.md', content: VERBOSE, baseContent: null },
        ctx({ level }),
      );
      if (file.suggestion === null) continue;
      expect(file.suggestion.criticalTotal).toBeGreaterThan(0);
      expect(file.suggestion.verified).toBe(true);
    }
  });

  it('reports instructions the prompt states twice', async () => {
    const file = await analyzeFile({ path: 'p.md', content: VERBOSE, baseContent: null }, ctx());
    expect(file.duplicates.length).toBeGreaterThan(0);
    expect(file.duplicates.every((group) => group.members.length >= 2)).toBe(true);
  });

  it('finds no duplicates in a prompt that says each thing once', async () => {
    const file = await analyzeFile(
      { path: 'p.md', content: 'Never reveal the key. Respond in JSON.\n', baseContent: null },
      ctx(),
    );
    expect(file.duplicates).toEqual([]);
  });
});

describe('totalsFor', () => {
  const base: FileAnalysis = {
    path: 'a.md',
    tokens: 100,
    exact: true,
    baseTokens: 80,
    deltaTokens: 20,
    deltaRatio: 0.25,
    monthlyCost: 3,
    monthlyDelta: 0.6,
    budget: 90,
    overBudget: true,
    overBudgetBy: 10,
    duplicates: [],
    suggestion: null,
  };

  it('adds up tokens, cost and over-budget files', () => {
    const totals = totalsFor([base, { ...base, path: 'b.md', overBudget: false, overBudgetBy: 0 }]);
    expect(totals.files).toBe(2);
    expect(totals.tokens).toBe(200);
    expect(totals.monthlyCost).toBe(6);
    expect(totals.overBudget).toBe(1);
    expect(totals.deltaTokens).toBe(40);
  });

  it('leaves the base totals null when nothing had a base version', () => {
    const totals = totalsFor([
      { ...base, baseTokens: null, deltaTokens: null, monthlyDelta: null },
    ]);
    expect(totals.baseTokens).toBeNull();
    expect(totals.deltaTokens).toBeNull();
    expect(totals.monthlyDelta).toBeNull();
  });

  it('counts only verified suggestions as removable tokens', () => {
    const suggestion = {
      output: '',
      tokens: 90,
      savedTokens: 10,
      savedRatio: 0.1,
      monthlySaving: 0.3,
      changes: 1,
      blocked: 0,
      criticalTotal: 2,
      criticalPreserved: 2,
      verified: true,
      written: false,
    };
    const totals = totalsFor([
      { ...base, suggestion },
      {
        ...base,
        path: 'b.md',
        suggestion: { ...suggestion, verified: false, criticalPreserved: 1 },
      },
    ]);
    expect(totals.savedTokens).toBe(10);
    expect(totals.monthlySaving).toBeCloseTo(0.3, 10);
    expect(totals.unverified).toBe(1);
  });
});
