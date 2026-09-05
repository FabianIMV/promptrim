/**
 * The CLI's own glob matcher and file discovery. Both are exercised directly:
 * `globToRegExp` on strings, `expandPatterns` against a throwaway tree under
 * the OS temp directory, so no fixture in the repo can drift into these
 * assertions by accident.
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { expandPatterns, matchesGlob, staticPrefix } from '../packages/cli/src/files';

describe('matchesGlob', () => {
  it('keeps * inside one path segment', () => {
    expect(matchesGlob('prompts/*.md', 'prompts/a.md')).toBe(true);
    expect(matchesGlob('prompts/*.md', 'prompts/nested/a.md')).toBe(false);
  });

  it('lets ** cross directories, including zero of them', () => {
    expect(matchesGlob('prompts/**/*.md', 'prompts/a.md')).toBe(true);
    expect(matchesGlob('prompts/**/*.md', 'prompts/deep/deeper/a.md')).toBe(true);
    expect(matchesGlob('**/*.md', 'a.md')).toBe(true);
    expect(matchesGlob('prompts/**/*.md', 'other/a.md')).toBe(false);
  });

  it('matches ? against exactly one non-separator character', () => {
    expect(matchesGlob('a?.md', 'ab.md')).toBe(true);
    expect(matchesGlob('a?.md', 'a.md')).toBe(false);
    expect(matchesGlob('a?.md', 'a/.md')).toBe(false);
  });

  it('expands {a,b} alternation', () => {
    expect(matchesGlob('p/*.{md,txt}', 'p/a.md')).toBe(true);
    expect(matchesGlob('p/*.{md,txt}', 'p/a.txt')).toBe(true);
    expect(matchesGlob('p/*.{md,txt}', 'p/a.json')).toBe(false);
  });

  it('treats regex metacharacters in the pattern as literals', () => {
    expect(matchesGlob('a+b.md', 'a+b.md')).toBe(true);
    expect(matchesGlob('a+b.md', 'aab.md')).toBe(false);
    expect(matchesGlob('v1.2/x.md', 'v1.2/x.md')).toBe(true);
    expect(matchesGlob('v1.2/x.md', 'v1x2/x.md')).toBe(false);
  });

  it('anchors at both ends', () => {
    expect(matchesGlob('prompts/a.md', 'other/prompts/a.md')).toBe(false);
    expect(matchesGlob('prompts/a.md', 'prompts/a.md.bak')).toBe(false);
  });
});

describe('staticPrefix', () => {
  it('returns the deepest directory that contains no wildcard', () => {
    expect(staticPrefix('prompts/**/*.md')).toBe('prompts');
    expect(staticPrefix('a/b/c/*.md')).toBe('a/b/c');
    expect(staticPrefix('*.md')).toBe('');
    expect(staticPrefix('a/b/file.md')).toBe('a/b');
  });
});

describe('expandPatterns', () => {
  let root: string;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'promptrim-files-'));
    mkdirSync(join(root, 'prompts', 'deep'), { recursive: true });
    mkdirSync(join(root, 'node_modules', 'pkg'), { recursive: true });
    mkdirSync(join(root, '.hidden'), { recursive: true });
    writeFileSync(join(root, 'prompts', 'a.md'), 'a');
    writeFileSync(join(root, 'prompts', 'b.txt'), 'b');
    writeFileSync(join(root, 'prompts', 'deep', 'c.md'), 'c');
    writeFileSync(join(root, 'prompts', 'notes.json'), '{}');
    writeFileSync(join(root, 'node_modules', 'pkg', 'readme.md'), 'nope');
    writeFileSync(join(root, '.hidden', 'secret.md'), 'nope');
    writeFileSync(join(root, 'top.md'), 'top');
  });

  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it('expands a glob to repo-relative POSIX paths in a stable order', () => {
    expect(expandPatterns(['prompts/**/*.md'], root)).toEqual([
      'prompts/a.md',
      'prompts/deep/c.md',
    ]);
  });

  it('never walks into node_modules or dot directories', () => {
    const found = expandPatterns(['**/*.md'], root);
    expect(found).toContain('top.md');
    expect(found.some((path) => path.includes('node_modules'))).toBe(false);
    expect(found.some((path) => path.includes('.hidden'))).toBe(false);
  });

  it('accepts a plain file path', () => {
    expect(expandPatterns(['prompts/a.md'], root)).toEqual(['prompts/a.md']);
  });

  it('scans a directory for prompt-shaped files only', () => {
    expect(expandPatterns(['prompts'], root)).toEqual([
      'prompts/a.md',
      'prompts/b.txt',
      'prompts/deep/c.md',
    ]);
  });

  it('de-duplicates across overlapping patterns', () => {
    expect(expandPatterns(['prompts/a.md', 'prompts/*.md', 'prompts/**/*.md'], root)).toEqual([
      'prompts/a.md',
      'prompts/deep/c.md',
    ]);
  });

  it('returns nothing, rather than throwing, for a pattern that matches no directory', () => {
    expect(expandPatterns(['nowhere/**/*.md'], root)).toEqual([]);
  });

  it('ignores a leading ./ and a trailing slash', () => {
    expect(expandPatterns(['./prompts/'], root)).toEqual([
      'prompts/a.md',
      'prompts/b.txt',
      'prompts/deep/c.md',
    ]);
  });
});
