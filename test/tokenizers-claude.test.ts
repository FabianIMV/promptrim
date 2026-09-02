import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { estimateClaudeTokens } from '../src/core/tokenizers/claude';

interface Fixture {
  text: string;
  tokens: number;
}

const FIXTURES: Fixture[] = JSON.parse(
  readFileSync(join(import.meta.dirname, 'fixtures', 'o200k-tokens.json'), 'utf8'),
);

describe('estimateClaudeTokens', () => {
  it('returns 0 for empty input', () => {
    expect(estimateClaudeTokens('')).toBe(0);
  });

  it('never returns 0 for non-empty input', () => {
    expect(estimateClaudeTokens('a')).toBeGreaterThanOrEqual(1);
    expect(estimateClaudeTokens('   ')).toBeGreaterThanOrEqual(1);
  });

  it('grows with input length', () => {
    const short = estimateClaudeTokens('one sentence.');
    const long = estimateClaudeTokens('one sentence. '.repeat(50));
    expect(long).toBeGreaterThan(short);
  });

  it('is deterministic', () => {
    const text = 'Compress this system prompt without losing any instruction.';
    expect(estimateClaudeTokens(text)).toBe(estimateClaudeTokens(text));
  });

  it('stays within a documented error bound on ordinary prose (calibration check)', () => {
    // Excludes fixtures the method's own docs call out as out-of-scope:
    // pure digit runs, pure symbol runs, and a single repeated character.
    const prose = FIXTURES.filter(
      (fx) =>
        fx.tokens > 0 &&
        !/^A+$/.test(fx.text) &&
        !fx.text.startsWith('1234567890') &&
        !fx.text.startsWith('Special characters:'),
    );
    const errors = prose.map(
      (fx) => Math.abs(estimateClaudeTokens(fx.text) - fx.tokens) / fx.tokens,
    );
    const meanAbsError = errors.reduce((a, b) => a + b, 0) / errors.length;
    expect(meanAbsError).toBeLessThan(0.3);
  });
});
