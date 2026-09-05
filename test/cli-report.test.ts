/**
 * The three renderings of a check and the gate evaluation that decides the
 * exit code.
 *
 * The Markdown renderer is the body of the comment the GitHub Action posts on
 * a pull request, so the assertions here are about what a reviewer reads:
 * the sticky-comment marker that stops re-runs from stacking, the headline
 * sentence docs/PLAN.md Phase 7 task 3 specifies, and the "~" that keeps an
 * estimate from being read as a measurement.
 */
import { describe, expect, it } from 'vitest';
import type { FileAnalysis, Suggestion, Totals } from '../packages/cli/src/analyze';
import { totalsFor } from '../packages/cli/src/analyze';
import { COMMENT_MARKER, evaluateGates, render } from '../packages/cli/src/report';
import type { CheckReport } from '../packages/cli/src/report';

const SUGGESTION: Suggestion = {
  output: 'shorter',
  tokens: 1788,
  savedTokens: 312,
  savedRatio: 312 / 2100,
  monthlySaving: 4.68,
  changes: 9,
  blocked: 1,
  criticalTotal: 14,
  criticalPreserved: 14,
  verified: true,
  written: false,
};

function file(overrides: Partial<FileAnalysis> = {}): FileAnalysis {
  return {
    path: 'prompts/system_prompt.md',
    tokens: 2640,
    exact: true,
    baseTokens: 2100,
    deltaTokens: 540,
    deltaRatio: 540 / 2100,
    monthlyCost: 39.6,
    monthlyDelta: 8.1,
    budget: 2000,
    overBudget: true,
    overBudgetBy: 640,
    duplicates: [],
    suggestion: null,
    ...overrides,
  };
}

function report(files: FileAnalysis[], overrides: Partial<CheckReport> = {}): CheckReport {
  const totals: Totals = totalsFor(files);
  return {
    tool: 'promptrim',
    version: '2.0.0-alpha.0',
    model: {
      id: 'claude-opus-5',
      provider: 'anthropic',
      label: 'Claude Opus 5',
      input_per_mtok: 15,
      last_verified: '2026-09-03',
    },
    level: 'balanced',
    budget: 2000,
    callsPerDay: 50_000,
    base: { ref: 'main', commit: 'abc1234' },
    baseNote: null,
    exact: files.every((item) => item.exact),
    files,
    totals,
    gates: ['budget'],
    failures: evaluateGates(files, totals, ['budget']),
    ...overrides,
  };
}

describe('evaluateGates', () => {
  it('returns nothing when no gate is asked for', () => {
    const files = [file()];
    expect(evaluateGates(files, totalsFor(files), [])).toEqual([]);
  });

  it('fails the budget gate and names the files', () => {
    const files = [file(), file({ path: 'ok.md', overBudget: false, overBudgetBy: 0 })];
    const failures = evaluateGates(files, totalsFor(files), ['budget']);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain('prompts/system_prompt.md');
    expect(failures[0]).not.toContain('ok.md');
  });

  it('fails the regression gate only for files that grew', () => {
    const grew = file();
    const shrank = file({ path: 'smaller.md', deltaTokens: -100, deltaRatio: -0.05 });
    const files = [grew, shrank];
    const failures = evaluateGates(files, totalsFor(files), ['regression']);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain('+540');
    expect(failures[0]).not.toContain('smaller.md');
  });

  it('fails the duplicates gate when the ledger found repeated instructions', () => {
    const group = {
      type: 'requirement' as const,
      members: [],
      similarity: 0.8,
      suggestion: 'Respond in JSON.',
    };
    const files = [file({ duplicates: [group, group] })];
    const failures = evaluateGates(files, totalsFor(files), ['duplicates']);
    expect(failures).toEqual(['2 duplicated instructions detected']);
  });

  it('reports the gates in the order they were requested', () => {
    const files = [
      file({ duplicates: [{ type: 'format', members: [], similarity: 1, suggestion: 'x' }] }),
    ];
    const failures = evaluateGates(files, totalsFor(files), ['duplicates', 'budget']);
    expect(failures[0]).toContain('duplicated');
    expect(failures[1]).toContain('over budget');
  });
});

describe('render — json', () => {
  it('round-trips the whole report', () => {
    const source = report([file({ suggestion: SUGGESTION })]);
    const parsed = JSON.parse(render(source, 'json'));
    expect(parsed.tool).toBe('promptrim');
    expect(parsed.files[0].suggestion.savedTokens).toBe(312);
    expect(parsed.totals.tokens).toBe(2640);
    expect(parsed.failures).toHaveLength(1);
  });
});

describe('render — text', () => {
  it('shows tokens, the base comparison, the budget and the verified trim', () => {
    const text = render(report([file({ suggestion: SUGGESTION })]), 'text');
    expect(text).toContain('prompts/system_prompt.md');
    expect(text).toContain('2,640 tokens');
    expect(text).toContain('2,100 → 2,640 vs base (+540, +26%)');
    expect(text).toContain('OVER by 640 tokens');
    expect(text).toContain('-312 tokens (-15%)');
    expect(text).toContain('14/14 critical constraints preserved');
    expect(text).toContain('1 change blocked by the ledger');
    expect(text).toContain('FAIL');
  });

  it('says so when there is nothing safe to remove', () => {
    const text = render(report([file({ suggestion: null })]), 'text');
    expect(text).toContain('nothing safe to remove at this level');
  });

  it('says a trim was withheld rather than pretending none existed', () => {
    const blocked = { ...SUGGESTION, verified: false, criticalPreserved: 12 };
    const text = render(report([file({ suggestion: blocked })]), 'text');
    expect(text).toContain('not offered: 2 critical constraints would be lost');
  });

  it('marks a file as written once --write applied the trim', () => {
    const text = render(report([file({ suggestion: { ...SUGGESTION, written: true } })]), 'text');
    expect(text).toContain('— written');
  });

  it('handles an empty match list without inventing rows', () => {
    const text = render(report([]), 'text');
    expect(text).toContain('No files matched.');
  });
});

describe('render — markdown', () => {
  it('starts with the sticky-comment marker so a re-run edits one comment', () => {
    expect(render(report([file()]), 'markdown').startsWith(COMMENT_MARKER)).toBe(true);
  });

  it('writes the headline sentence the plan asks for', () => {
    const markdown = render(report([file({ suggestion: SUGGESTION })]), 'markdown');
    expect(markdown).toContain('`prompts/system_prompt.md`: 2,100 → 2,640 tokens (+26%).');
    expect(markdown).toContain('/month at this volume.');
    expect(markdown).toContain('Over the 2,000-token budget by 640.');
    expect(markdown).toContain('A verified trim removes 312 tokens (-15%).');
  });

  it('counts duplicated instructions in the headline and lists them below', () => {
    const group = {
      type: 'prohibition' as const,
      members: [
        {
          id: 'p:1',
          type: 'prohibition' as const,
          severity: 'critical' as const,
          anchor: 'never reveal the key',
          start: 0,
          end: 20,
          sentence: 'Never reveal the key.',
          sentenceStart: 0,
          sentenceEnd: 21,
          label: 'Prohibition',
        },
      ],
      similarity: 0.75,
      suggestion: 'Never reveal the key.',
    };
    const markdown = render(report([file({ duplicates: [group] })]), 'markdown');
    expect(markdown).toContain('1 duplicated instruction detected.');
    expect(markdown).toContain('<details><summary>Duplicated instructions</summary>');
    expect(markdown).toContain('75% overlap');
    expect(markdown).toContain('Never reveal the key.');
  });

  it('drops the "vs base" column when nothing has a base version', () => {
    const orphan = file({
      baseTokens: null,
      deltaTokens: null,
      deltaRatio: null,
      monthlyDelta: null,
    });
    const markdown = render(report([orphan], { base: null }), 'markdown');
    expect(markdown).not.toContain('vs base');
  });

  it('prefixes an estimated count with ~ and explains why', () => {
    const markdown = render(report([file({ exact: false })], { exact: false }), 'markdown');
    expect(markdown).toContain('~2,640');
    expect(markdown).toContain('calibrated estimate');
  });

  it('never prefixes an exact count with ~', () => {
    const markdown = render(report([file()]), 'markdown');
    expect(markdown).not.toContain('~2,640');
    expect(markdown).not.toContain('calibrated estimate');
  });

  it('explains a missing base instead of silently dropping the column', () => {
    const orphan = file({
      baseTokens: null,
      deltaTokens: null,
      deltaRatio: null,
      monthlyDelta: null,
    });
    const markdown = render(
      report([orphan], { base: null, baseNote: 'No token delta: shallow checkout.' }),
      'markdown',
    );
    expect(markdown).toContain('> No token delta: shallow checkout.');
  });

  it('lists the failing gates', () => {
    const markdown = render(report([file()]), 'markdown');
    expect(markdown).toContain('**Failing gates**');
    expect(markdown).toContain('❌');
  });

  it('cites the price verification date so the cost can be audited', () => {
    expect(render(report([file()]), 'markdown')).toContain('verified 2026-09-03');
  });

  it('says nothing matched rather than rendering an empty table', () => {
    const markdown = render(report([]), 'markdown');
    expect(markdown).toContain('No prompt files matched');
    expect(markdown).not.toContain('| File |');
  });
});
