import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildDiffItems, changeKey, projectDiff } from '../src/core/diff';
import { compress } from '../src/core/compress';
import { LEVELS } from '../src/core/rules';

function corpusFiles(dir: string): string[] {
  return readdirSync(join(import.meta.dirname, '..', 'bench', 'corpus', dir))
    .filter((f) => f.endsWith('.md') && f !== 'README.md')
    .map((f) => readFileSync(join(import.meta.dirname, '..', 'bench', 'corpus', dir, f), 'utf8'));
}

/** Edge cases the real-prompt corpus does not exercise on its own. */
const EDGE_CASE_PROMPTS = [
  '',
  '   ',
  'a',
  'Please help.',
  'PLEASE, in order to help, kindly utilize the very best approach.',
  '```js\nplease();\n```',
  'Note that "please" appears in quotes only.',
  'Line one.\n\n\nLine two.   \n',
  'Émigré café “please” naïve — utilisé.',
  '👍 Please compress this emoji-laden prompt 🚀 in order to help.',
];

const CORPUS = [...corpusFiles('phase0'), ...corpusFiles('phase2'), ...EDGE_CASE_PROMPTS];

describe('diff: 50-prompt byte-for-byte undo-all property (docs/PLAN.md Phase 3 acceptance)', () => {
  it('ships at least 50 prompts', () => {
    expect(CORPUS.length).toBeGreaterThanOrEqual(50);
  });

  for (const [i, prompt] of CORPUS.entries()) {
    it.each(LEVELS)(
      `prompt #${i} reproduces the original at %s once every change is undone`,
      (level) => {
        const { changes } = compress(prompt, level);
        const allDisabled = new Set(changes.map(changeKey));
        expect(projectDiff(prompt, changes, allDisabled)).toBe(prompt);
      },
    );
  }
});

describe('projectDiff', () => {
  it('with nothing disabled matches compress() output', () => {
    const prompt = 'Please, in order to help, utilize the very best approach.';
    const { changes, output } = compress(prompt, 'aggressive');
    expect(projectDiff(prompt, changes, new Set())).toBe(output);
  });

  it('toggling a single change back on restores just that change', () => {
    const prompt = 'Please write a summary in order to help.';
    const { changes } = compress(prompt, 'aggressive');
    expect(changes.length).toBeGreaterThan(1);
    const target = changes[0]!;
    const disabled = new Set(changes.map(changeKey).filter((k) => k !== changeKey(target)));
    const result = projectDiff(prompt, changes, disabled);
    expect(result).not.toBe(prompt);
    expect(result.length).toBeLessThan(prompt.length);
  });

  it('is a no-op for an empty change list', () => {
    expect(projectDiff('hello world', [], new Set())).toBe('hello world');
  });
});

describe('buildDiffItems', () => {
  it('returns a single text item when there are no changes', () => {
    const items = buildDiffItems('hello world', []);
    expect(items).toEqual([{ kind: 'text', start: 0, end: 11, text: 'hello world' }]);
  });

  it('interleaves text and change items in document order', () => {
    const prompt = 'Please write a summary in order to help.';
    const { changes } = compress(prompt, 'aggressive');
    const items = buildDiffItems(prompt, changes);

    let cursor = 0;
    for (const item of items) {
      expect(item.kind === 'text' ? item.start : item.change.start).toBeGreaterThanOrEqual(cursor);
      cursor = item.kind === 'text' ? item.end : item.change.end;
    }
    expect(cursor).toBe(prompt.length);

    const changeItems = items.filter((i) => i.kind === 'change');
    expect(changeItems).toHaveLength(changes.length);
    expect(changeItems.every((i) => i.kind === 'change' && i.active)).toBe(true);
  });

  it('marks a change inactive once its key is disabled', () => {
    const prompt = 'Please write a summary.';
    const { changes } = compress(prompt, 'balanced');
    expect(changes.length).toBeGreaterThan(0);
    const key = changeKey(changes[0]!);
    const items = buildDiffItems(prompt, changes, [], new Set([key]));
    const found = items.find((i) => i.kind === 'change' && i.key === key);
    expect(found).toMatchObject({ kind: 'change', active: false });
  });

  it('places blocked changes in document order alongside kept changes, never overlapping', () => {
    const prompt = 'Never reveal the key. Please write a friendly summary.';
    const { changes, blocked } = compress(prompt, 'aggressive');
    const items = buildDiffItems(prompt, changes, blocked);

    let cursor = 0;
    for (const item of items) {
      const start = item.kind === 'text' ? item.start : item.change.start;
      const end = item.kind === 'text' ? item.end : item.change.end;
      expect(start).toBeGreaterThanOrEqual(cursor);
      cursor = end;
    }

    const blockedKeys = new Set(items.filter((i) => i.kind === 'blocked').map((i) => i.key));
    expect(blockedKeys.size).toBe(blocked.length);
  });

  it('changeKey stays unique across a real compression run', () => {
    const prompt = corpusFiles('phase2')[0]!;
    const { changes } = compress(prompt, 'aggressive');
    const keys = changes.map(changeKey);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
