import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compress } from '../packages/core/src/compress';
import { findProtectedRanges } from '../packages/core/src/segment';
import { LEVELS } from '../packages/core/src/rules';
import { extractConstraints, verifyConstraints } from '../packages/core/src/ledger';

const CORPUS_DIR = join(import.meta.dirname, '..', 'bench', 'corpus', 'phase6');
const FILES = readdirSync(CORPUS_DIR)
  .filter((f) => /^\d+-.*\.md$/.test(f))
  .sort();

/**
 * docs/PLAN.md Phase 6 task 1: the everyday-prompt corpus `npm run bench`
 * reports numbers for must hold the same safety invariants as every other
 * corpus in the repo, not just show a bigger reduction percentage.
 */
describe('phase-6 corpus: everyday prompts', () => {
  it('ships at least 10 prompts', () => {
    expect(FILES.length).toBeGreaterThanOrEqual(10);
  });

  for (const file of FILES) {
    const prompt = readFileSync(join(CORPUS_DIR, file), 'utf8');

    describe(file, () => {
      it.each(LEVELS)('loses no constraint at %s', (level) => {
        const constraints = extractConstraints(prompt);
        const { output } = compress(prompt, level, { enforceLedger: true, constraints });
        const report = verifyConstraints(prompt, output, constraints);
        expect(report.criticalLost.map((c) => c.constraint.anchor)).toEqual([]);
      });

      it.each(LEVELS)('reproduces every protected region verbatim at %s', (level) => {
        const output = compress(prompt, level).output;
        for (const range of findProtectedRanges(prompt)) {
          expect(output, `${file} @ ${range.kind}`).toContain(prompt.slice(range.start, range.end));
        }
      });
    });
  }
});
