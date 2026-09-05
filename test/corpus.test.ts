import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compress } from '../packages/core/src/compress';
import { findProtectedRanges } from '../packages/core/src/segment';
import { LEVELS } from '../packages/core/src/rules';

const CORPUS_DIR = join(import.meta.dirname, '..', 'bench', 'corpus', 'phase0');
const FILES = readdirSync(CORPUS_DIR)
  .filter((f) => f.endsWith('.md'))
  .sort();

/**
 * Phase 0 acceptance criterion: "a corpus of 10 prompts containing code/JSON
 * produces 0 changes inside protected regions".
 */
describe('phase-0 corpus: protected regions are never touched', () => {
  it('ships at least 10 prompts', () => {
    expect(FILES.length).toBeGreaterThanOrEqual(10);
  });

  for (const file of FILES) {
    const prompt = readFileSync(join(CORPUS_DIR, file), 'utf8');

    describe(file, () => {
      it('detects at least one protected region', () => {
        expect(findProtectedRanges(prompt).length).toBeGreaterThan(0);
      });

      it.each(LEVELS)('produces 0 changes inside protected regions at %s', (level) => {
        const ranges = findProtectedRanges(prompt);
        const { changes } = compress(prompt, level);
        const violations = changes.filter((c) =>
          ranges.some((r) => c.start < r.end && r.start < c.end),
        );
        expect(violations).toEqual([]);
      });

      it.each(LEVELS)('reproduces every protected region verbatim at %s', (level) => {
        const output = compress(prompt, level).output;
        for (const range of findProtectedRanges(prompt)) {
          expect(output, `${file} @ ${range.kind}`).toContain(prompt.slice(range.start, range.end));
        }
      });

      it.each(LEVELS)('never drops a protected instruction word at %s', (level) => {
        const output = compress(prompt, level).output;
        for (const word of ['never', 'always', 'must', 'only', 'step by step', 'make sure to']) {
          const before = countOccurrences(prompt, word);
          if (before === 0) continue;
          expect(countOccurrences(output, word), `${file}: "${word}"`).toBe(before);
        }
      });
    });
  }
});

function countOccurrences(haystack: string, needle: string): number {
  return haystack.toLowerCase().split(needle.toLowerCase()).length - 1;
}
