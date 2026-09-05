#!/usr/bin/env node
/**
 * Entry point for the `promptrim` binary.
 *
 * Exit codes are the contract with CI: 0 clean, 1 a gate in `--fail-on`
 * tripped, 2 the invocation or the filesystem was wrong. A report always goes
 * to stdout so that a workflow can pipe it somewhere even on a failing run.
 */
import { HELP, UsageError, parseArgs } from './options';
import { runCheck } from './run';
import { VERSION } from './version';

export async function main(argv: readonly string[], env = process.env): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs(argv, env.PROMPTRIM_CWD ?? process.cwd());
  } catch (error) {
    if (error instanceof UsageError) {
      process.stderr.write(`promptrim: ${error.message}\n\nRun promptrim --help.\n`);
      return 2;
    }
    throw error;
  }

  if (parsed.command === 'help') {
    process.stdout.write(HELP);
    return 0;
  }
  if (parsed.command === 'version') {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }

  try {
    const result = await runCheck(parsed.options, env);
    process.stdout.write(result.output);
    if (result.report.files.length === 0) {
      process.stderr.write(
        `promptrim: no files matched ${parsed.options.patterns.join(', ')}. ` +
          'Quote the pattern so the shell does not expand it first.\n',
      );
    }
    return result.exitCode;
  } catch (error) {
    process.stderr.write(`promptrim: ${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
}

/* c8 ignore start -- the process wiring itself; `main` is what the tests call. */
if (typeof module !== 'undefined' && typeof require !== 'undefined' && require.main === module) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      process.stderr.write(`promptrim: ${error instanceof Error ? error.stack : String(error)}\n`);
      process.exitCode = 2;
    },
  );
}
/* c8 ignore stop */
