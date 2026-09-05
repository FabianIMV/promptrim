/**
 * `promptrim check`, wired to the filesystem and to git.
 *
 * Everything that decides a number lives in `analyze.ts` and everything that
 * decides a character lives in `report.ts`; this module only reads files,
 * asks git for their base version, and — under `--write` — writes back the
 * compressed version the ledger verified.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { analyzeFile, apiKeyEnvName, resolveModel, totalsFor } from './analyze';
import type { FileAnalysis } from './analyze';
import { expandPatterns, toLocalPath } from './files';
import { isGitRepository, readAtRef, resolveBaseRef } from './git';
import type { CheckOptions } from './options';
import { evaluateGates, render } from './report';
import type { CheckReport } from './report';
import { VERSION } from './version';

export interface RunResult {
  report: CheckReport;
  output: string;
  /** 0 clean, 1 a gate in `--fail-on` tripped. */
  exitCode: number;
}

export async function runCheck(
  options: CheckOptions,
  env: Record<string, string | undefined> = {},
): Promise<RunResult> {
  const cwd = resolve(options.cwd);
  const model = resolveModel(options.modelId);
  const apiKey = env[apiKeyEnvName(model)];
  const paths = expandPatterns(options.patterns, cwd);

  let base: { ref: string; commit: string } | null = null;
  let baseNote: string | null = null;
  if (options.baseRef !== null) {
    if (!isGitRepository(cwd)) {
      baseNote = 'No token delta: this is not a git working tree.';
    } else {
      base = resolveBaseRef(options.baseRef, cwd);
      if (base === null) {
        baseNote =
          `No token delta: git could not resolve "${options.baseRef}" ` +
          `(nor origin/${options.baseRef}). A shallow checkout is the usual cause — ` +
          'fetch the base branch, or pass --no-base.';
      }
    }
  }

  const files: FileAnalysis[] = [];
  for (const path of paths) {
    const content = readFileSync(toLocalPath(cwd, path), 'utf8');
    const baseContent = base === null ? null : readAtRef(base.ref, path, cwd);
    const analysis = await analyzeFile(
      { path, content, baseContent },
      {
        model,
        level: options.level,
        budget: options.budget,
        callsPerDay: options.callsPerDay,
        apiKey,
      },
    );

    // `--write` applies only what the ledger verified. An unverified
    // suggestion is reported and left on disk untouched — the whole point of
    // the tool is that it never silently trades a constraint for tokens.
    if (options.write && analysis.suggestion?.verified) {
      writeFileSync(toLocalPath(cwd, path), analysis.suggestion.output, 'utf8');
      analysis.suggestion.written = true;
    }
    files.push(analysis);
  }

  const totals = totalsFor(files);
  const failures = evaluateGates(files, totals, options.gates);
  const report: CheckReport = {
    tool: 'promptrim',
    version: VERSION,
    model: {
      id: model.id,
      provider: model.provider,
      label: model.label,
      input_per_mtok: model.input_per_mtok,
      last_verified: model.last_verified,
    },
    level: options.level,
    budget: options.budget,
    callsPerDay: options.callsPerDay,
    base,
    baseNote,
    exact: files.every((file) => file.exact),
    files,
    totals,
    gates: options.gates,
    failures,
  };

  const output = render(report, options.format);
  if (options.outPath !== null) {
    const target = resolve(cwd, options.outPath);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, output, 'utf8');
  }

  return { report, output, exitCode: failures.length > 0 ? 1 : 0 };
}
