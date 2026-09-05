/**
 * Argument parsing for `promptrim check`.
 *
 * Hand-rolled on purpose: the CLI ships with exactly one runtime dependency
 * (`@promptrim/core`), so a prompt-checking step in someone else's CI installs
 * the engine and nothing else. The surface is small enough that a parser is
 * cheaper than an argument library, and it is a pure function of `argv`, so
 * every flag below is covered by tests instead of by trying the binary.
 */
import { LEVELS } from '@promptrim/core';
import type { Level } from '@promptrim/core';

export type ReportFormat = 'text' | 'markdown' | 'json';

/** What turns a report into a non-zero exit code. */
export type Gate = 'budget' | 'regression' | 'duplicates';

export const GATES: readonly Gate[] = ['budget', 'regression', 'duplicates'];

export const REPORT_FORMATS: readonly ReportFormat[] = ['text', 'markdown', 'json'];

/**
 * Same default as the web app (`src/ui/App.tsx`). Anthropic has no local
 * tokenizer, so counts are the calibrated estimate unless `ANTHROPIC_API_KEY`
 * is in the environment — the report says which of the two it used rather than
 * presenting an estimate as a measurement.
 */
export const DEFAULT_MODEL_ID = 'claude-sonnet-5';

/** Matches the web app's default projection input. */
export const DEFAULT_CALLS_PER_DAY = 1000;

export const DEFAULT_BASE_REF = 'main';

export interface CheckOptions {
  patterns: string[];
  cwd: string;
  /** Per-file token ceiling. `null` disables the budget check. */
  budget: number | null;
  modelId: string;
  level: Level;
  /** Git ref the delta is measured against. `null` skips the comparison. */
  baseRef: string | null;
  callsPerDay: number;
  /** Overwrite each file with its verified compressed version. */
  write: boolean;
  format: ReportFormat;
  /** Write the report here as well as to stdout. */
  outPath: string | null;
  gates: Gate[];
}

export interface ParsedArgs {
  command: 'check' | 'help' | 'version';
  options: CheckOptions;
}

export class UsageError extends Error {}

const DEFAULTS: Omit<CheckOptions, 'patterns' | 'cwd'> = {
  budget: null,
  modelId: DEFAULT_MODEL_ID,
  level: 'balanced',
  baseRef: DEFAULT_BASE_REF,
  callsPerDay: DEFAULT_CALLS_PER_DAY,
  write: false,
  format: 'text',
  outPath: null,
  gates: ['budget'],
};

export function parseArgs(argv: readonly string[], cwd: string): ParsedArgs {
  const options: CheckOptions = { ...DEFAULTS, patterns: [], cwd };
  const args = [...argv];
  let command: ParsedArgs['command'] | null = null;
  let sawDoubleDash = false;

  const next = (flag: string): string => {
    const value = args.shift();
    if (value === undefined) throw new UsageError(`${flag} needs a value.`);
    return value;
  };

  while (args.length > 0) {
    const arg = args.shift() as string;

    if (sawDoubleDash) {
      options.patterns.push(arg);
      continue;
    }
    if (arg === '--') {
      sawDoubleDash = true;
      continue;
    }

    // `--budget=2000` and `--budget 2000` are the same thing.
    let flag = arg;
    let inlineValue: string | null = null;
    if (arg.startsWith('--') && arg.includes('=')) {
      const at = arg.indexOf('=');
      flag = arg.slice(0, at);
      inlineValue = arg.slice(at + 1);
    }
    const take = (): string => (inlineValue === null ? next(flag) : inlineValue);
    const refuseInline = () => {
      if (inlineValue !== null) throw new UsageError(`${flag} does not take a value.`);
    };

    switch (flag) {
      case '-h':
      case '--help':
        command ??= 'help';
        break;
      case '-v':
      case '--version':
        command ??= 'version';
        break;
      case '--budget':
        options.budget = positiveInt(flag, take());
        break;
      case '--no-budget':
        refuseInline();
        options.budget = null;
        break;
      case '--model':
        options.modelId = take();
        break;
      case '--level':
        options.level = level(take());
        break;
      case '--base':
        options.baseRef = take();
        break;
      case '--no-base':
        refuseInline();
        options.baseRef = null;
        break;
      case '--calls-per-day':
        options.callsPerDay = positiveInt(flag, take());
        break;
      case '--write':
        refuseInline();
        options.write = true;
        break;
      case '--format':
        options.format = format(take());
        break;
      case '--out':
        options.outPath = take();
        break;
      case '--fail-on':
        options.gates = gates(take());
        break;
      case '--cwd':
        options.cwd = take();
        break;
      case 'check':
        if (command === null) command = 'check';
        else options.patterns.push(arg);
        break;
      default:
        if (arg.startsWith('-')) throw new UsageError(`Unknown option ${arg}.`);
        options.patterns.push(arg);
    }
  }

  if (command === null) command = 'check';
  if (command === 'check' && options.patterns.length === 0) {
    throw new UsageError('No file patterns given. Try: promptrim check "prompts/**/*.md"');
  }
  return { command, options };
}

function positiveInt(flag: string, raw: string): number {
  // `2_000` and `2,000` are what people type in a workflow file.
  const value = Number(raw.replace(/[_,]/g, ''));
  if (!Number.isFinite(value) || value < 0 || !Number.isInteger(value)) {
    throw new UsageError(`${flag} needs a non-negative whole number, got "${raw}".`);
  }
  return value;
}

function level(raw: string): Level {
  const value = raw.toLowerCase();
  if (!(LEVELS as readonly string[]).includes(value)) {
    throw new UsageError(`--level must be one of ${LEVELS.join(', ')}, got "${raw}".`);
  }
  return value as Level;
}

function format(raw: string): ReportFormat {
  const value = raw.toLowerCase();
  if (!(REPORT_FORMATS as readonly string[]).includes(value)) {
    throw new UsageError(`--format must be one of ${REPORT_FORMATS.join(', ')}, got "${raw}".`);
  }
  return value as ReportFormat;
}

function gates(raw: string): Gate[] {
  const values = raw
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part.length > 0);
  if (values.length === 1 && (values[0] === 'none' || values[0] === 'never')) return [];
  const unknown = values.filter((value) => !(GATES as readonly string[]).includes(value));
  if (unknown.length > 0) {
    throw new UsageError(
      `--fail-on takes a comma-separated list of ${GATES.join(', ')} (or "none"), got "${raw}".`,
    );
  }
  return [...new Set(values)] as Gate[];
}

export const HELP = `promptrim check — token budgets and verified compression for prompt files.

Usage
  promptrim check <pattern...> [options]

Patterns are glob paths relative to the working directory ("prompts/**/*.md"),
plain file paths, or directories (scanned for .md, .markdown, .txt and .prompt).

Options
  --budget <n>          Per-file token ceiling. Files above it are flagged.
  --model <id>          Model whose tokenizer and price to use (default ${DEFAULT_MODEL_ID}).
  --level <level>       Compression level to suggest: ${LEVELS.join(' | ')} (default balanced).
  --base <ref>          Git ref to measure the token delta against (default ${DEFAULT_BASE_REF}).
  --no-base             Skip the comparison against a git ref.
  --calls-per-day <n>   Calls/day used for the monthly cost projection (default ${DEFAULT_CALLS_PER_DAY}).
  --write               Overwrite each file with its verified compressed version.
  --format <fmt>        text | markdown | json (default text).
  --out <path>          Also write the report to this file.
  --fail-on <list>      Comma-separated: ${GATES.join(', ')} — or "none" (default budget).
  --cwd <dir>           Run as if started in this directory.
  -h, --help            Show this help.
  -v, --version         Show the version.

Exit codes
  0  nothing tripped the gates in --fail-on
  1  a gate tripped
  2  the arguments or the filesystem were wrong

Token counts are exact for OpenAI models (js-tiktoken, o200k_base) and for
Anthropic and Gemini models when ANTHROPIC_API_KEY / GEMINI_API_KEY are in the
environment. Otherwise they are the calibrated estimate, and the report marks
every estimated number with "~" instead of implying it measured them.
`;
