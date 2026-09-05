/**
 * The three renderings of a check: a terminal report, the Markdown body the
 * GitHub Action posts on a pull request, and the raw JSON for anything that
 * wants to consume the numbers itself.
 *
 * All three read the same `CheckReport`, so the comment on a PR can never
 * disagree with what the same command printed locally. Nothing here computes:
 * if a number is not already in the report, it does not get shown.
 */
import type { FileAnalysis, Totals } from './analyze';
import type { Gate, ReportFormat } from './options';
import type { Level, ModelPricing } from '@promptrim/core';

/** Marks the Action's sticky comment so a re-run edits it instead of stacking. */
export const COMMENT_MARKER = '<!-- promptrim-report -->';

export interface CheckReport {
  tool: 'promptrim';
  version: string;
  model: Pick<ModelPricing, 'id' | 'provider' | 'label' | 'input_per_mtok' | 'last_verified'>;
  level: Level;
  budget: number | null;
  callsPerDay: number;
  /** The git ref the delta is against, once resolved. */
  base: { ref: string; commit: string } | null;
  /** Why there is no base, when there is none. */
  baseNote: string | null;
  /** True when every token count came from a real tokenizer, not the estimate. */
  exact: boolean;
  files: FileAnalysis[];
  totals: Totals;
  gates: Gate[];
  failures: string[];
}

/** Which gates the report trips, in the order they are listed. */
export function evaluateGates(
  files: readonly FileAnalysis[],
  totals: Totals,
  gates: readonly Gate[],
): string[] {
  const failures: string[] = [];
  for (const gate of gates) {
    if (gate === 'budget' && totals.overBudget > 0) {
      const names = files.filter((file) => file.overBudget).map((file) => file.path);
      failures.push(`${plural(totals.overBudget, 'file')} over budget: ${names.join(', ')}`);
    }
    if (gate === 'regression') {
      const grown = files.filter((file) => (file.deltaTokens ?? 0) > 0);
      if (grown.length > 0) {
        const names = grown.map((file) => `${file.path} (+${num(file.deltaTokens ?? 0)})`);
        failures.push(`${plural(grown.length, 'file')} grew against the base: ${names.join(', ')}`);
      }
    }
    if (gate === 'duplicates' && totals.duplicateGroups > 0) {
      failures.push(`${plural(totals.duplicateGroups, 'duplicated instruction')} detected`);
    }
  }
  return failures;
}

export function render(report: CheckReport, format: ReportFormat): string {
  if (format === 'json') return `${JSON.stringify(report, null, 2)}\n`;
  if (format === 'markdown') return renderMarkdown(report);
  return renderText(report);
}

// ---------------------------------------------------------------- formatting

function num(value: number): string {
  return Math.round(value).toLocaleString('en-US');
}

function signed(value: number): string {
  const rounded = Math.round(value);
  return rounded > 0 ? `+${num(rounded)}` : num(rounded);
}

function percent(ratio: number): string {
  const pct = ratio * 100;
  const digits = Math.abs(pct) < 10 && pct !== 0 ? 1 : 0;
  return `${pct > 0 ? '+' : ''}${pct.toFixed(digits)}%`;
}

/** Same rounding ladder as the web app's `usd`, with a sign for deltas. */
function usdSigned(value: number): string {
  const abs = Math.abs(value);
  const sign = value < -0.00005 ? '-' : value > 0.00005 ? '+' : '';
  if (abs < 0.00005) return '$0';
  if (abs < 0.01) return `${sign}$${abs.toFixed(4)}`;
  if (abs < 10) return `${sign}$${abs.toFixed(2)}`;
  return `${sign}$${num(abs)}`;
}

function usd(value: number): string {
  return usdSigned(value).replace(/^\+/, '');
}

function plural(count: number, noun: string): string {
  return `${num(count)} ${noun}${count === 1 ? '' : 's'}`;
}

/** `~` in front of a count that is a calibrated estimate, never silently. */
function tokens(file: FileAnalysis): string {
  return `${file.exact ? '' : '~'}${num(file.tokens)}`;
}

function header(report: CheckReport): string {
  const parts = [
    report.model.id,
    report.level,
    `${num(report.callsPerDay)} calls/day`,
    report.base ? `base ${report.base.ref}` : 'no base',
  ];
  if (report.budget !== null) parts.splice(2, 0, `budget ${num(report.budget)}`);
  return parts.join(' · ');
}

function estimateNote(report: CheckReport): string | null {
  if (report.exact) return null;
  return (
    `Token counts are the calibrated estimate for ${report.model.label}: ` +
    `no local tokenizer exists for ${report.model.provider} and no API key was in the ` +
    `environment. Every estimated number is marked "~".`
  );
}

// -------------------------------------------------------------------- text

function renderText(report: CheckReport): string {
  const lines: string[] = [];
  lines.push(`PromptTrim check — ${plural(report.files.length, 'file')}`);
  lines.push(header(report));
  const note = estimateNote(report);
  if (note) lines.push(note);
  if (report.baseNote) lines.push(report.baseNote);
  lines.push('');

  if (report.files.length === 0) {
    lines.push('No files matched.');
    return `${lines.join('\n')}\n`;
  }

  for (const file of report.files) {
    lines.push(`  ${file.path}`);
    const first = [`${tokens(file)} tokens`, `${usd(file.monthlyCost)}/month`];
    if (file.baseTokens !== null && file.deltaTokens !== 0) {
      const change =
        file.deltaRatio === null
          ? `${signed(file.deltaTokens ?? 0)}`
          : `${signed(file.deltaTokens ?? 0)}, ${percent(file.deltaRatio)}`;
      first.push(`${num(file.baseTokens)} → ${num(file.tokens)} vs base (${change})`);
    } else if (file.baseTokens !== null) {
      first.push('unchanged vs base');
    }
    lines.push(`    ${first.join(' · ')}`);

    if (file.budget !== null) {
      lines.push(
        file.overBudget
          ? `    budget    OVER by ${num(file.overBudgetBy)} tokens (limit ${num(file.budget)})`
          : `    budget    ok, ${num(file.budget - file.tokens)} tokens to spare`,
      );
    }

    const suggestion = file.suggestion;
    if (suggestion === null) {
      lines.push('    trim      nothing safe to remove at this level');
    } else if (suggestion.verified) {
      lines.push(
        `    trim      -${num(suggestion.savedTokens)} tokens (${percent(-suggestion.savedRatio)}), ` +
          `${usd(Math.abs(suggestion.monthlySaving))}/month` +
          `${suggestion.written ? ' — written' : ''}`,
      );
      lines.push(
        `    verified  ${num(suggestion.criticalPreserved)}/${num(suggestion.criticalTotal)} critical constraints preserved` +
          (suggestion.blocked > 0
            ? `, ${plural(suggestion.blocked, 'change')} blocked by the ledger`
            : ''),
      );
    } else {
      lines.push(
        `    trim      not offered: ${num(suggestion.criticalTotal - suggestion.criticalPreserved)} ` +
          'critical constraints would be lost',
      );
    }

    if (file.duplicates.length > 0) {
      lines.push(`    dupes     ${plural(file.duplicates.length, 'duplicated instruction')}`);
      for (const group of file.duplicates) {
        lines.push(
          `              keep "${truncate(group.suggestion, 60)}" (${num(group.members.length)}×)`,
        );
      }
    }
    lines.push('');
  }

  lines.push(summaryLine(report));
  for (const failure of report.failures) lines.push(`  FAIL ${failure}`);
  return `${lines.join('\n')}\n`;
}

function summaryLine(report: CheckReport): string {
  const t = report.totals;
  const parts = [
    `${plural(t.files, 'file')}`,
    `${num(t.tokens)} tokens`,
    `${usd(t.monthlyCost)}/month`,
  ];
  if (t.deltaTokens !== null && t.deltaTokens !== 0) {
    parts.push(`${signed(t.deltaTokens)} vs base (${usdSigned(t.monthlyDelta ?? 0)}/month)`);
  }
  if (t.savedTokens > 0) {
    parts.push(`${num(t.savedTokens)} tokens removable, verified`);
  }
  if (t.overBudget > 0) parts.push(`${num(t.overBudget)} over budget`);
  return `Summary: ${parts.join(' · ')}`;
}

function truncate(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

// ---------------------------------------------------------------- markdown

function renderMarkdown(report: CheckReport): string {
  const lines: string[] = [COMMENT_MARKER, '## PromptTrim', '', `\`${header(report)}\``, ''];

  if (report.files.length === 0) {
    lines.push('No prompt files matched the configured patterns.');
    return `${lines.join('\n')}\n`;
  }

  // One sentence per changed file, in the shape docs/PLAN.md Phase 7 task 3
  // asks for. This is the part a reviewer reads; the table below is the detail.
  const headlines = report.files
    .filter((file) => (file.deltaTokens ?? 0) !== 0 || file.overBudget)
    .map((file) => `- ${headline(file)}`);
  if (headlines.length > 0) {
    lines.push(...headlines, '');
  }

  const hasBase = report.files.some((file) => file.baseTokens !== null);
  const head = [
    'File',
    'Tokens',
    ...(hasBase ? ['vs base'] : []),
    '$/month',
    'Verified trim',
    'Duplicates',
  ];
  const align = ['---', '---:', ...(hasBase ? ['---:'] : []), '---:', '---:', '---:'];
  lines.push(`| ${head.join(' | ')} |`, `| ${align.join(' | ')} |`);

  for (const file of report.files) {
    const cells = [`\`${file.path}\``, budgetCell(file)];
    if (hasBase) cells.push(deltaCell(file));
    cells.push(usd(file.monthlyCost));
    cells.push(trimCell(file));
    cells.push(file.duplicates.length > 0 ? `${num(file.duplicates.length)} ⚠️` : '—');
    lines.push(`| ${cells.join(' | ')} |`);
  }

  lines.push('', summaryLine(report).replace('Summary: ', '**Summary:** '));

  const note = estimateNote(report);
  if (note) lines.push('', `> ${note}`);
  if (report.baseNote) lines.push('', `> ${report.baseNote}`);

  const dupes = report.files.filter((file) => file.duplicates.length > 0);
  if (dupes.length > 0) {
    lines.push('', '<details><summary>Duplicated instructions</summary>', '');
    for (const file of dupes) {
      lines.push(`**\`${file.path}\`**`, '');
      for (const group of file.duplicates) {
        lines.push(
          `- ${group.type}, ${num(group.members.length)} sentences say the same thing ` +
            `(${Math.round(group.similarity * 100)}% overlap). Keep: \`${truncate(group.suggestion, 100)}\``,
        );
        for (const member of group.members) {
          lines.push(`  - \`${truncate(member.sentence, 100)}\``);
        }
      }
      lines.push('');
    }
    lines.push('</details>');
  }

  if (report.failures.length > 0) {
    lines.push('', '**Failing gates**', '');
    for (const failure of report.failures) lines.push(`- ❌ ${failure}`);
  }

  lines.push(
    '',
    `<sub>Prices from \`packages/core/src/data/pricing.json\`, verified ${report.model.last_verified}. ` +
      'A trim is only offered when every `critical` constraint in the original still verifies against it.</sub>',
  );
  return `${lines.join('\n')}\n`;
}

/** "system_prompt.md: 2,100 → 2,640 tokens (+26%). At 50,000 calls/day ≈ +$X/month." */
function headline(file: FileAnalysis): string {
  const parts: string[] = [];
  if (file.baseTokens !== null && file.deltaTokens !== 0) {
    const pct = file.deltaRatio === null ? '' : ` (${percent(file.deltaRatio)})`;
    parts.push(`\`${file.path}\`: ${num(file.baseTokens)} → ${tokens(file)} tokens${pct}.`);
    if (file.monthlyDelta !== null && Math.abs(file.monthlyDelta) >= 0.00005) {
      parts.push(`${usdSigned(file.monthlyDelta)}/month at this volume.`);
    }
  } else {
    parts.push(`\`${file.path}\`: ${tokens(file)} tokens.`);
  }
  if (file.overBudget)
    parts.push(`Over the ${num(file.budget ?? 0)}-token budget by ${num(file.overBudgetBy)}.`);
  if (file.duplicates.length > 0) {
    parts.push(`${plural(file.duplicates.length, 'duplicated instruction')} detected.`);
  }
  const suggestion = file.suggestion;
  if (suggestion?.verified) {
    parts.push(
      `A verified trim removes ${num(suggestion.savedTokens)} tokens (${percent(-suggestion.savedRatio)}).`,
    );
  }
  return parts.join(' ');
}

function budgetCell(file: FileAnalysis): string {
  const count = tokens(file);
  if (file.budget === null) return count;
  return file.overBudget ? `${count} ⚠️ / ${num(file.budget)}` : `${count} / ${num(file.budget)}`;
}

function deltaCell(file: FileAnalysis): string {
  if (file.baseTokens === null) return 'new';
  if (file.deltaTokens === 0) return '—';
  const pct = file.deltaRatio === null ? '' : ` (${percent(file.deltaRatio)})`;
  return `${signed(file.deltaTokens ?? 0)}${pct}`;
}

function trimCell(file: FileAnalysis): string {
  const suggestion = file.suggestion;
  if (suggestion === null) return '—';
  if (!suggestion.verified) return 'blocked by ledger';
  return (
    `−${num(suggestion.savedTokens)} (${percent(-suggestion.savedRatio)})` +
    (suggestion.written ? ' ✍️' : '')
  );
}
