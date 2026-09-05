import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findProtectedRanges } from '../src/core';
import { runLocalMlCompression } from '../src/local-ml/pipeline';
import type { LocalMlEngine } from '../src/local-ml/types';

const CORPUS_DIR = join(import.meta.dirname, '..', 'bench', 'corpus', 'phase0');
const FILES = readdirSync(CORPUS_DIR)
  .filter((f) => f.endsWith('.md'))
  .sort();

/**
 * A stand-in for the real ONNX model, standard across this repo's test suite
 * (see docs/PLAN.md §6.6 on `providers-corpus.test.ts`): no test downloads or
 * runs the actual 57 MB TinyBERT model. It drops a fixed filler vocabulary at
 * a rate that scales with the level, which is enough to exercise the
 * protected-region wrapper (`compressProtectedAware`) end to end over real
 * prompts that mix prose with code, JSON and variables.
 */
function fakeCompressor(): (text: string, rate: number) => string {
  const fillers = /\b(please|kindly|very|really|just|simply|basically|in order to)\b/gi;
  return (text, rate) => {
    const dropped = text.replace(fillers, '').replace(/[ \t]+/g, ' ');
    // Lower `rate` (more aggressive) also trims doubled punctuation spacing,
    // simulating a model that keeps fewer tokens overall.
    return rate < 0.6 ? dropped.replace(/ ([,.;:])/g, '$1') : dropped;
  };
}

async function loadEngine(): Promise<LocalMlEngine> {
  const compress = fakeCompressor();
  return { compress: async (text, rate) => compress(text, rate) };
}

describe('Local ML mode over the Phase 0 corpus: protected regions survive', () => {
  for (const file of FILES) {
    const prompt = readFileSync(join(CORPUS_DIR, file), 'utf8');

    it(`${file} keeps every protected region verbatim`, async () => {
      const ranges = findProtectedRanges(prompt);
      const run = await runLocalMlCompression(prompt, { level: 'aggressive', loadEngine });
      for (const range of ranges) {
        expect(run.output, `${file} @ ${range.kind}`).toContain(
          prompt.slice(range.start, range.end),
        );
      }
    });

    it(`${file} produces a ledger report over the real output`, async () => {
      const run = await runLocalMlCompression(prompt, { level: 'balanced', loadEngine });
      expect(run.report.total).toBe(run.constraints.length);
      expect(run.report.checks.length).toBe(run.constraints.length);
    });
  }
});
