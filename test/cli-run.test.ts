/**
 * End-to-end `promptrim check`, against a throwaway git repository created in
 * the OS temp directory.
 *
 * A real repo is worth the setup cost here: the delta against a base ref is
 * the CLI's whole reason to exist inside a pull request, and mocking `git
 * show` would only prove that the mock works. Everything else — `--write`,
 * `--out`, the exit codes — is checked on the same tree.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { main } from '../packages/cli/src/cli';
import { parseArgs } from '../packages/cli/src/options';
import { runCheck } from '../packages/cli/src/run';

const VERBOSE = [
  'Please make sure that you carefully review the pull request in order to find bugs.',
  'In order to do that, you should never approve a change that has no tests.',
  'You must always respond in JSON format.',
  '',
].join('\n');

const TERSE = 'Review the pull request.\n';

let repo: string;

function git(...args: string[]): void {
  const result = spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
}

function options(argv: string[]) {
  return parseArgs([...argv, '--cwd', repo], repo).options;
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'promptrim-run-'));
  mkdirSync(join(repo, 'prompts'), { recursive: true });
  writeFileSync(join(repo, 'prompts', 'system.md'), TERSE);
  git('init', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  git('add', '.');
  git('commit', '-m', 'initial');
});

afterEach(() => rmSync(repo, { recursive: true, force: true }));

describe('runCheck', () => {
  it('reports the delta between the working tree and the base ref', async () => {
    writeFileSync(join(repo, 'prompts', 'system.md'), VERBOSE);
    const { report } = await runCheck(options(['prompts/**/*.md', '--model', 'gpt-4o']));

    expect(report.base?.ref).toBe('main');
    expect(report.files).toHaveLength(1);
    const file = report.files[0]!;
    expect(file.path).toBe('prompts/system.md');
    expect(file.baseTokens).toBeGreaterThan(0);
    expect(file.deltaTokens).toBeGreaterThan(0);
  });

  it('treats a file absent from the base ref as new, not as a shrink', async () => {
    writeFileSync(join(repo, 'prompts', 'added.md'), VERBOSE);
    const { report } = await runCheck(options(['prompts/added.md', '--model', 'gpt-4o']));
    expect(report.files[0]?.baseTokens).toBeNull();
  });

  it('falls back to origin/<ref> and explains a ref it cannot resolve', async () => {
    const { report } = await runCheck(
      options(['prompts/**/*.md', '--model', 'gpt-4o', '--base', 'no-such-branch']),
    );
    expect(report.base).toBeNull();
    expect(report.baseNote).toContain('origin/no-such-branch');
    expect(report.files[0]?.deltaTokens).toBeNull();
  });

  it('skips git entirely with --no-base', async () => {
    const { report } = await runCheck(
      options(['prompts/**/*.md', '--model', 'gpt-4o', '--no-base']),
    );
    expect(report.base).toBeNull();
    expect(report.baseNote).toBeNull();
  });

  it('says so when it is not run inside a git working tree', async () => {
    const loose = mkdtempSync(join(tmpdir(), 'promptrim-loose-'));
    try {
      writeFileSync(join(loose, 'a.md'), VERBOSE);
      const { report } = await runCheck(
        parseArgs(['a.md', '--model', 'gpt-4o', '--cwd', loose], loose).options,
      );
      expect(report.baseNote).toContain('not a git working tree');
    } finally {
      rmSync(loose, { recursive: true, force: true });
    }
  });

  it('exits 1 when a file is over budget and 0 when the gate is off', async () => {
    writeFileSync(join(repo, 'prompts', 'system.md'), VERBOSE);
    const failing = await runCheck(
      options(['prompts/**/*.md', '--model', 'gpt-4o', '--budget', '10']),
    );
    expect(failing.exitCode).toBe(1);
    expect(failing.report.failures[0]).toContain('over budget');

    const passing = await runCheck(
      options(['prompts/**/*.md', '--model', 'gpt-4o', '--budget', '10', '--fail-on', 'none']),
    );
    expect(passing.exitCode).toBe(0);
    expect(passing.report.failures).toEqual([]);
    expect(passing.report.files[0]?.overBudget).toBe(true);
  });

  it('exits 1 on a regression only when that gate is asked for', async () => {
    writeFileSync(join(repo, 'prompts', 'system.md'), VERBOSE);
    const gated = await runCheck(
      options(['prompts/**/*.md', '--model', 'gpt-4o', '--fail-on', 'regression']),
    );
    expect(gated.exitCode).toBe(1);

    const ungated = await runCheck(options(['prompts/**/*.md', '--model', 'gpt-4o']));
    expect(ungated.exitCode).toBe(0);
  });

  it('--write applies the verified trim and leaves the rest of the tree alone', async () => {
    writeFileSync(join(repo, 'prompts', 'system.md'), VERBOSE);
    const { report } = await runCheck(
      options(['prompts/**/*.md', '--model', 'gpt-4o', '--write', '--fail-on', 'none']),
    );

    const written = readFileSync(join(repo, 'prompts', 'system.md'), 'utf8');
    expect(report.files[0]?.suggestion?.written).toBe(true);
    expect(written).toBe(report.files[0]?.suggestion?.output);
    expect(written).not.toBe(VERBOSE);
    // The constraints the ledger vouched for are still there, verbatim.
    expect(written).toContain('never approve a change that has no tests');
    expect(written).toContain('always respond in JSON format');
  });

  it('without --write nothing on disk changes', async () => {
    writeFileSync(join(repo, 'prompts', 'system.md'), VERBOSE);
    await runCheck(options(['prompts/**/*.md', '--model', 'gpt-4o', '--fail-on', 'none']));
    expect(readFileSync(join(repo, 'prompts', 'system.md'), 'utf8')).toBe(VERBOSE);
  });

  it('--write skips a file with no verified trim', async () => {
    const { report } = await runCheck(options(['prompts/**/*.md', '--model', 'gpt-4o', '--write']));
    expect(report.files[0]?.suggestion).toBeNull();
    expect(readFileSync(join(repo, 'prompts', 'system.md'), 'utf8')).toBe(TERSE);
  });

  it('--out writes the same report it returns, creating the directory', async () => {
    const { output } = await runCheck(
      options([
        'prompts/**/*.md',
        '--model',
        'gpt-4o',
        '--format',
        'markdown',
        '--out',
        'tmp/out/report.md',
      ]),
    );
    expect(readFileSync(join(repo, 'tmp', 'out', 'report.md'), 'utf8')).toBe(output);
  });

  it('uses the API key for the model provider, and only that one', async () => {
    const { report } = await runCheck(options(['prompts/**/*.md', '--model', 'gpt-4o']), {
      ANTHROPIC_API_KEY: 'must-not-be-used',
    });
    // gpt-4o counts locally: the run must not have needed a key at all.
    expect(report.exact).toBe(true);
  });

  it('produces an empty report for patterns that match nothing', async () => {
    const { report, exitCode } = await runCheck(options(['nowhere/**/*.md', '--model', 'gpt-4o']));
    expect(report.files).toEqual([]);
    expect(exitCode).toBe(0);
  });
});

describe('main', () => {
  let stdout: string;
  let stderr: string;

  beforeEach(() => {
    stdout = '';
    stderr = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdout += String(chunk);
      return true;
    });
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      stderr += String(chunk);
      return true;
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it('prints the help and exits 0', async () => {
    expect(await main(['--help'])).toBe(0);
    expect(stdout).toContain('promptrim check');
  });

  it('prints the version and exits 0', async () => {
    expect(await main(['--version'])).toBe(0);
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('exits 2 with a usage message on a bad flag', async () => {
    expect(await main(['a.md', '--nope'])).toBe(2);
    expect(stderr).toContain('Unknown option --nope');
    expect(stdout).toBe('');
  });

  it('exits 2 on an unknown model rather than guessing one', async () => {
    expect(await main(['check', 'prompts/**/*.md', '--model', 'gpt-9', '--cwd', repo])).toBe(2);
    expect(stderr).toContain('Unknown model');
  });

  it('exits 1 and still prints the report when a gate trips', async () => {
    writeFileSync(join(repo, 'prompts', 'system.md'), VERBOSE);
    const code = await main([
      'check',
      'prompts/**/*.md',
      '--model',
      'gpt-4o',
      '--budget',
      '10',
      '--cwd',
      repo,
    ]);
    expect(code).toBe(1);
    expect(stdout).toContain('prompts/system.md');
    expect(stdout).toContain('FAIL');
  });

  it('warns on stderr when a pattern matched nothing', async () => {
    expect(await main(['check', 'nowhere/*.md', '--model', 'gpt-4o', '--cwd', repo])).toBe(0);
    expect(stderr).toContain('no files matched');
  });
});

describe('package surface', () => {
  it('re-exports everything a consumer of the package needs', async () => {
    // `packages/cli/src/index.ts` is what `require('promptrim')` resolves to.
    // Nothing else in the suite goes through it (the tests import the modules
    // directly), so without this the barrel could lose an export unnoticed.
    const api = await import('../packages/cli/src/index');
    for (const name of [
      'main',
      'runCheck',
      'analyzeFile',
      'totalsFor',
      'resolveModel',
      'apiKeyEnvName',
      'expandPatterns',
      'globToRegExp',
      'matchesGlob',
      'staticPrefix',
      'toLocalPath',
      'resolveBaseRef',
      'readAtRef',
      'isGitRepository',
      'parseArgs',
      'UsageError',
      'render',
      'evaluateGates',
      'COMMENT_MARKER',
      'VERSION',
      'HELP',
      'GATES',
      'REPORT_FORMATS',
      'PROMPT_EXTENSIONS',
      'DEFAULT_MODEL_ID',
      'DEFAULT_BASE_REF',
      'DEFAULT_CALLS_PER_DAY',
    ]) {
      expect(api, `promptrim does not export ${name}`).toHaveProperty(name);
    }
  });
});
