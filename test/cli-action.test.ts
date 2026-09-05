/**
 * Keeps `action.yml`, the dogfooding workflow and the CLI from drifting apart.
 *
 * None of this is checked by lint or by the build: the Action is YAML that
 * shells out to a binary, so a renamed flag, a retired model id or a changed
 * sticky-comment marker would only surface as a broken job on someone else's
 * pull request. These assertions turn each of those into a failing test here.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { countTokensForModel, getModel } from '@promptrim/core';
import { expandPatterns } from '../packages/cli/src/files';
import { HELP, parseArgs } from '../packages/cli/src/options';
import { COMMENT_MARKER } from '../packages/cli/src/report';
import { VERSION } from '../packages/cli/src/version';

const ROOT = join(import.meta.dirname, '..');
const ACTION = readFileSync(join(ROOT, 'action.yml'), 'utf8');
const WORKFLOW = readFileSync(join(ROOT, '.github', 'workflows', 'promptrim.yml'), 'utf8');

/**
 * Every `--flag` the action's argument array hands to the CLI. Only the
 * `ARGS=(...)` literal and the `ARGS+=(...)` appends count — the `gh api`
 * calls further down have flags of their own that mean nothing to promptrim.
 */
function flagsPassedByAction(): string[] {
  const opening = ACTION.indexOf('ARGS=(check');
  expect(opening, 'action.yml no longer builds an ARGS array').toBeGreaterThan(-1);
  const literal = ACTION.slice(opening, ACTION.indexOf('\n\n', opening));
  const appends = ACTION.match(/ARGS\+=\([^)]*\)/g) ?? [];
  return [...new Set([literal, ...appends].join('\n').match(/--[a-z][a-z-]*/g) ?? [])];
}

describe('action.yml', () => {
  it('passes only flags the CLI documents', () => {
    const flags = flagsPassedByAction();
    expect(flags.length).toBeGreaterThan(5);
    for (const flag of flags) {
      expect(HELP, `${flag} is not a documented promptrim flag`).toContain(flag);
    }
  });

  it('looks for the same sticky marker the Markdown report writes', () => {
    expect(ACTION).toContain(`MARKER='${COMMENT_MARKER}'`);
  });

  it('defaults to a model that exists in the pricing data', () => {
    const match = /default: 'claude-sonnet-5'/.exec(ACTION);
    expect(match, 'the model input default changed; update this test with it').not.toBeNull();
    expect(getModel('claude-sonnet-5')).toBeDefined();
  });

  it('defaults to a fail-on value the CLI accepts', () => {
    expect(() => parseArgs(['a.md', '--fail-on', 'none'], ROOT)).not.toThrow();
  });

  it('declares the outputs a caller can read', () => {
    expect(ACTION).toContain('exit-code:');
    expect(ACTION).toContain('report-path:');
  });

  it('only builds the CLI when it is not already built', () => {
    expect(ACTION).toContain('if [ -f packages/cli/dist/cli.js ]; then');
  });
});

describe('.github/workflows/promptrim.yml', () => {
  it("runs this repository's own action, not a published copy", () => {
    expect(WORKFLOW).toContain('uses: ./');
  });

  it('asks for the permission the comment step needs', () => {
    expect(WORKFLOW).toMatch(/pull-requests: write/);
  });

  it('points at corpora that exist and contain prompts', () => {
    const patterns = [...WORKFLOW.matchAll(/^\s{12}(bench\/\S+)$/gm)].map((match) => match[1]!);
    expect(patterns.length).toBeGreaterThan(0);
    for (const pattern of patterns) {
      expect(expandPatterns([pattern], ROOT).length, `${pattern} matched nothing`).toBeGreaterThan(
        0,
      );
    }
  });

  it('uses settings the CLI can parse', () => {
    const model = /model: (\S+)/.exec(WORKFLOW)?.[1];
    const level = /level: (\S+)/.exec(WORKFLOW)?.[1];
    const budget = /budget: '(\d+)'/.exec(WORKFLOW)?.[1];
    const failOn = /fail-on: (\S+)/.exec(WORKFLOW)?.[1];
    expect(getModel(model ?? '')).toBeDefined();
    const { options } = parseArgs(
      ['a.md', '--level', level ?? '', '--budget', budget ?? '', '--fail-on', failOn ?? ''],
      ROOT,
    );
    expect(options.gates).toEqual(['budget']);
    expect(options.budget).toBe(1200);
  });

  it('keeps the corpus under the budget it enforces', async () => {
    // The gate is real (`fail-on: budget`), so a corpus file that grew past
    // the ceiling would fail the Prompt budget job on every future pull
    // request, with the cause buried in a workflow log. Fail here instead,
    // where the message says which file and by how much.
    const budget = Number(/budget: '(\d+)'/.exec(WORKFLOW)?.[1]);
    const model = getModel(/model: (\S+)/.exec(WORKFLOW)?.[1] ?? '');
    expect(model).toBeDefined();
    const patterns = [...WORKFLOW.matchAll(/^\s{12}(bench\/\S+)$/gm)].map((match) => match[1]!);

    for (const path of expandPatterns(patterns, ROOT)) {
      const content = readFileSync(join(ROOT, path), 'utf8');
      const { tokens } = await countTokensForModel(content, model!);
      expect(
        tokens,
        `${path} is ${tokens} tokens, over the ${budget} the workflow enforces`,
      ).toBeLessThanOrEqual(budget);
    }
  });
});

describe('CLI version', () => {
  it('matches packages/cli/package.json', () => {
    const manifest = JSON.parse(
      readFileSync(join(ROOT, 'packages', 'cli', 'package.json'), 'utf8'),
    ) as { version: string };
    expect(VERSION).toBe(manifest.version);
  });
});
