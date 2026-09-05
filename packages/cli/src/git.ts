/**
 * Reading a file as it stands on another git ref, so the report can say
 * "2,100 → 2,640 tokens (+26%)" instead of only "2,640 tokens".
 *
 * `git` is shelled out to rather than reimplemented: the CLI runs inside a
 * checkout in every case that matters (a PR job, a pre-commit hook, a
 * developer's terminal), and anything else falls back to "no base" with a
 * reason instead of an error.
 */
import { spawnSync } from 'node:child_process';

/** 8 MB — a prompt file that does not fit is not a prompt file. */
const MAX_BUFFER = 8 * 1024 * 1024;

function git(args: readonly string[], cwd: string): { ok: boolean; stdout: string } {
  const result = spawnSync('git', [...args], {
    cwd,
    encoding: 'utf8',
    maxBuffer: MAX_BUFFER,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) return { ok: false, stdout: '' };
  return { ok: true, stdout: result.stdout };
}

export interface BaseRef {
  /** The ref that was actually resolved — may be `origin/main` for `main`. */
  ref: string;
  commit: string;
}

/**
 * Resolves the ref the user asked for, falling back to `origin/<ref>`: a CI
 * checkout with `fetch-depth: 0` has the remote branch but often not the local
 * one. Returns `null` (with the caller reporting why) rather than throwing,
 * because a missing base is a degraded report, not a failure.
 */
export function resolveBaseRef(ref: string, cwd: string): BaseRef | null {
  for (const candidate of [ref, `origin/${ref}`]) {
    const result = git(['rev-parse', '--verify', '--quiet', `${candidate}^{commit}`], cwd);
    const commit = result.stdout.trim();
    if (result.ok && commit.length > 0) return { ref: candidate, commit };
  }
  return null;
}

/** File content at `ref`, or `null` when the file did not exist there. */
export function readAtRef(ref: string, relPath: string, cwd: string): string | null {
  const result = git(['show', `${ref}:${relPath}`], cwd);
  return result.ok ? result.stdout : null;
}

export function isGitRepository(cwd: string): boolean {
  return git(['rev-parse', '--is-inside-work-tree'], cwd).stdout.trim() === 'true';
}
