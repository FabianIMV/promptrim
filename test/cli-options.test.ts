/**
 * `promptrim check` argument parsing. The parser is hand-rolled (see
 * `packages/cli/src/options.ts`) so that the CLI installs the engine and
 * nothing else; that trade is only worth making if every flag is pinned by a
 * test rather than by trying the binary once.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BASE_REF,
  DEFAULT_CALLS_PER_DAY,
  DEFAULT_MODEL_ID,
  GATES,
  HELP,
  UsageError,
  parseArgs,
} from '../packages/cli/src/options';

const CWD = '/repo';

describe('parseArgs', () => {
  it('defaults to check with balanced, a main base and the budget gate', () => {
    const { command, options } = parseArgs(['prompts/**/*.md'], CWD);
    expect(command).toBe('check');
    expect(options.patterns).toEqual(['prompts/**/*.md']);
    expect(options.level).toBe('balanced');
    expect(options.baseRef).toBe(DEFAULT_BASE_REF);
    expect(options.modelId).toBe(DEFAULT_MODEL_ID);
    expect(options.callsPerDay).toBe(DEFAULT_CALLS_PER_DAY);
    expect(options.budget).toBeNull();
    expect(options.format).toBe('text');
    expect(options.write).toBe(false);
    expect(options.gates).toEqual(['budget']);
    expect(options.cwd).toBe(CWD);
  });

  it('parses the example invocation from docs/PLAN.md Phase 7', () => {
    const { options } = parseArgs(
      ['check', 'prompts/**/*.md', '--budget', '2000', '--model', 'claude-opus-5'],
      CWD,
    );
    expect(options.patterns).toEqual(['prompts/**/*.md']);
    expect(options.budget).toBe(2000);
    expect(options.modelId).toBe('claude-opus-5');
  });

  it('accepts --flag=value as well as --flag value', () => {
    const { options } = parseArgs(['a.md', '--budget=1500', '--level=aggressive'], CWD);
    expect(options.budget).toBe(1500);
    expect(options.level).toBe('aggressive');
  });

  it('accepts separators inside numbers, the way a workflow file writes them', () => {
    expect(parseArgs(['a.md', '--calls-per-day', '50,000'], CWD).options.callsPerDay).toBe(50000);
    expect(parseArgs(['a.md', '--budget', '2_000'], CWD).options.budget).toBe(2000);
  });

  it('turns off the base comparison and the budget with their --no- forms', () => {
    const { options } = parseArgs(['a.md', '--budget', '10', '--no-budget', '--no-base'], CWD);
    expect(options.baseRef).toBeNull();
    expect(options.budget).toBeNull();
  });

  it('takes a comma-separated gate list, and "none" to disable gating', () => {
    expect(parseArgs(['a.md', '--fail-on', 'budget,regression'], CWD).options.gates).toEqual([
      'budget',
      'regression',
    ]);
    expect(parseArgs(['a.md', '--fail-on', 'none'], CWD).options.gates).toEqual([]);
    expect(parseArgs(['a.md', '--fail-on', 'budget,budget'], CWD).options.gates).toEqual([
      'budget',
    ]);
  });

  it('treats everything after -- as a pattern, even if it looks like a flag', () => {
    const { options } = parseArgs(['--', '--weird-name.md'], CWD);
    expect(options.patterns).toEqual(['--weird-name.md']);
  });

  it('recognises help and version before anything else', () => {
    expect(parseArgs(['--help'], CWD).command).toBe('help');
    expect(parseArgs(['-h'], CWD).command).toBe('help');
    expect(parseArgs(['--version'], CWD).command).toBe('version');
    expect(parseArgs(['-v'], CWD).command).toBe('version');
  });

  it('rejects an unknown option instead of treating it as a pattern', () => {
    expect(() => parseArgs(['a.md', '--nope'], CWD)).toThrow(UsageError);
  });

  it('rejects a bad level, format, gate and number', () => {
    expect(() => parseArgs(['a.md', '--level', 'brutal'], CWD)).toThrow(/--level must be one of/);
    expect(() => parseArgs(['a.md', '--format', 'yaml'], CWD)).toThrow(/--format must be one of/);
    expect(() => parseArgs(['a.md', '--fail-on', 'vibes'], CWD)).toThrow(/--fail-on takes/);
    expect(() => parseArgs(['a.md', '--budget', 'lots'], CWD)).toThrow(/whole number/);
    expect(() => parseArgs(['a.md', '--budget', '-5'], CWD)).toThrow(/whole number/);
  });

  it('rejects a flag left without its value', () => {
    expect(() => parseArgs(['a.md', '--model'], CWD)).toThrow(/--model needs a value/);
  });

  it('rejects a value glued onto a flag that takes none', () => {
    expect(() => parseArgs(['a.md', '--write=yes'], CWD)).toThrow(/does not take a value/);
  });

  it('refuses to run with no patterns, rather than scanning the whole tree', () => {
    expect(() => parseArgs([], CWD)).toThrow(/No file patterns given/);
    expect(() => parseArgs(['check'], CWD)).toThrow(/No file patterns given/);
  });

  it('lets --cwd move the working directory', () => {
    expect(parseArgs(['a.md', '--cwd', '/elsewhere'], CWD).options.cwd).toBe('/elsewhere');
  });

  it('documents every gate and the exit codes in --help', () => {
    for (const gate of GATES) expect(HELP).toContain(gate);
    expect(HELP).toContain('Exit codes');
  });
});
