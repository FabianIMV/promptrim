/**
 * Turns the patterns on the command line into a sorted list of files.
 *
 * Written by hand rather than pulling in a glob library: the CLI's whole
 * selling point over `tokensift`/`PromptLint` is that it installs an engine,
 * not a dependency tree. The subset supported is the one a prompt path
 * actually needs — `**`, `*`, `?`, and `{a,b}` alternation — and it is a pure
 * string function, so it is tested directly instead of through the filesystem.
 */
import { readdirSync, statSync } from 'node:fs';
import { join, posix, relative, resolve, sep } from 'node:path';

/** Extensions picked up when a pattern names a directory. */
export const PROMPT_EXTENSIONS = ['.md', '.markdown', '.txt', '.prompt'];

/** Never walked into, whatever the pattern says. */
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'coverage', '.next', '.cache']);

/**
 * Compiles a glob into a regular expression anchored at both ends.
 *
 * `**` crosses directory separators, `*` and `?` do not. `a/**\/b` also matches
 * `a/b` (zero directories in between), which is what people mean by it.
 */
export function globToRegExp(pattern: string): RegExp {
  let out = '';
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i] as string;
    if (char === '*') {
      const doubled = pattern[i + 1] === '*';
      if (doubled) {
        const slashAfter = pattern[i + 2] === '/';
        i += slashAfter ? 2 : 1;
        // `(?:.*/)?` rather than `.*/` so that `a/**/b` matches plain `a/b`.
        out += slashAfter ? '(?:[^\\0]*/)?' : '[^\\0]*';
      } else {
        out += '[^/]*';
      }
      continue;
    }
    if (char === '?') {
      out += '[^/]';
      continue;
    }
    if (char === '{') {
      const close = pattern.indexOf('}', i);
      if (close > i) {
        const alternatives = pattern.slice(i + 1, close).split(',');
        out += `(?:${alternatives.map((alt) => globToRegExp(alt).source.slice(1, -1)).join('|')})`;
        i = close;
        continue;
      }
    }
    out += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${out}$`);
}

export function matchesGlob(pattern: string, path: string): boolean {
  return globToRegExp(pattern).test(path);
}

/** The longest leading run of literal directories, used as the walk root. */
export function staticPrefix(pattern: string): string {
  const parts = pattern.split('/');
  const literal: string[] = [];
  for (const part of parts) {
    if (/[*?{]/.test(part)) break;
    literal.push(part);
  }
  // The last literal part may be the filename itself; only directories count.
  if (literal.length === parts.length) literal.pop();
  return literal.join('/');
}

function walk(dir: string, root: string, out: string[]): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.name !== '.github') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(full, root, out);
    } else if (entry.isFile()) {
      out.push(toPosix(relative(root, full)));
    }
  }
}

function toPosix(path: string): string {
  return sep === '/' ? path : path.split(sep).join('/');
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/**
 * Expands every pattern against `cwd` and returns unique repo-relative POSIX
 * paths in a stable order, so two runs on the same tree report the same rows.
 */
export function expandPatterns(patterns: readonly string[], cwd: string): string[] {
  const root = resolve(cwd);
  const found = new Set<string>();

  for (const raw of patterns) {
    const pattern = toPosix(raw).replace(/^\.\//, '').replace(/\/+$/, '');
    if (pattern.length === 0) continue;

    const asPath = resolve(root, pattern);
    if (isFile(asPath)) {
      found.add(toPosix(relative(root, asPath)));
      continue;
    }
    if (isDirectory(asPath)) {
      const files: string[] = [];
      walk(asPath, root, files);
      for (const file of files) {
        if (PROMPT_EXTENSIONS.some((ext) => file.endsWith(ext))) found.add(file);
      }
      continue;
    }

    const prefix = staticPrefix(pattern);
    const base = prefix.length > 0 ? resolve(root, prefix) : root;
    if (!isDirectory(base)) continue;
    const files: string[] = [];
    walk(base, root, files);
    const matcher = globToRegExp(pattern);
    for (const file of files) {
      if (matcher.test(file)) found.add(file);
    }
  }

  return [...found].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** Joins repo-relative POSIX paths the way the local filesystem wants them. */
export function toLocalPath(cwd: string, relPath: string): string {
  return resolve(cwd, ...posix.normalize(relPath).split('/'));
}
