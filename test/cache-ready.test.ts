/**
 * "Generate cache-ready version": reordering must never lose or rewrite a line.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { buildCacheReady } from '../src/core/cache-advisor/cache-ready';
import { splitPrompt } from '../src/core/cache-advisor/split';
import { ttlsForModel } from '../src/core/cache-advisor/rules';
import { getModel } from '../src/core/pricing';

const opus = getModel('claude-opus-5')!;
const gpt5 = getModel('gpt-5')!;
const flash = getModel('gemini-2.5-flash')!;

const PROMPT = `You are a release-notes writer.
Current date: 2026-09-03
Write in the past tense.
Request id: 7f4a1c02-6b8e-4b1a-9c2e-2f7c9d3a1b55

## Rules
- Group changes by area.

User: {{diff}}`;

function contentLines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('<!-- PromptTrim:'))
    .sort();
}

describe('buildCacheReady', () => {
  const result = buildCacheReady(PROMPT, opus);

  it('moves every per-request line below the breakpoint', () => {
    const [prefix, rest] = result.text.split(result.marker);
    expect(prefix).toContain('Write in the past tense.');
    expect(prefix).toContain('Group changes by area.');
    expect(prefix).not.toContain('Current date');
    expect(prefix).not.toContain('Request id');
    expect(rest).toContain('Current date: 2026-09-03');
    expect(rest).toContain('Request id: 7f4a1c02');
    expect(rest).toContain('User: {{diff}}');
    expect(result.movedLines).toHaveLength(2);
  });

  it('keeps every line of the original, exactly once', () => {
    expect(contentLines(result.text)).toEqual(contentLines(PROMPT));
  });

  it('rewrites nothing: the moved lines are byte-identical', () => {
    expect(result.movedLines).toEqual([
      'Current date: 2026-09-03',
      'Request id: 7f4a1c02-6b8e-4b1a-9c2e-2f7c9d3a1b55',
    ]);
  });

  it('explains what it did', () => {
    expect(result.notes[0]).toContain('Moved 2 per-request lines');
  });

  it('marks the breakpoint the way each provider expects', () => {
    expect(buildCacheReady(PROMPT, opus).marker).toContain('cache_control');
    const oneHour = ttlsForModel(opus).find((t) => t.id === 'anthropic-1h')!;
    expect(buildCacheReady(PROMPT, opus, { ttl: oneHour }).marker).toContain('"ttl": "1h"');
    expect(buildCacheReady(PROMPT, gpt5).marker).toContain('byte-identical');
    expect(buildCacheReady(PROMPT, flash).marker).toContain('explicit cache');
    expect(buildCacheReady(PROMPT, flash).marker).toContain('3600s');
  });

  it('still emits a breakpoint for a prompt that is already cache-ready', () => {
    const text = 'You are a linter.\nReport one finding per line.';
    const result = buildCacheReady(text, opus);
    expect(result.movedLines).toEqual([]);
    expect(result.text).toBe(`${text}\n\n${result.marker}`);
  });

  it('says so when there is no static block at all', () => {
    const result = buildCacheReady('{{everything}}', opus);
    expect(result.notes.some((n) => n.includes('dynamic from the first line'))).toBe(true);
  });

  it('reuses a split the caller already computed', () => {
    const split = splitPrompt(PROMPT);
    expect(buildCacheReady(PROMPT, opus, { split }).text).toBe(buildCacheReady(PROMPT, opus).text);
  });
});

describe('buildCacheReady over the benchmark corpus', () => {
  const dirs = ['bench/corpus/phase0', 'bench/corpus/phase2'];
  const files = dirs.flatMap((dir) =>
    readdirSync(dir)
      .filter((name) => name.endsWith('.md'))
      .map((name) => join(dir, name)),
  );

  it('reads a corpus of at least 40 prompts', () => {
    expect(files.length).toBeGreaterThanOrEqual(40);
  });

  it('never loses, duplicates or rewrites a line', () => {
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      const result = buildCacheReady(text, opus);
      expect(contentLines(result.text), file).toEqual(contentLines(text));
    }
  });
});
