import { describe, expect, it } from 'vitest';
import { batchPreview, isBatch, splitBatch } from '../src/core/batch';

describe('splitBatch', () => {
  it('splits on a bare --- line and trims each prompt', () => {
    expect(splitBatch('First prompt.\n---\nSecond prompt.\n---\nThird prompt.')).toEqual([
      'First prompt.',
      'Second prompt.',
      'Third prompt.',
    ]);
  });

  it('tolerates surrounding whitespace and CRLF line endings', () => {
    expect(splitBatch('A\r\n---\r\nB')).toEqual(['A', 'B']);
    expect(splitBatch('A\n  ---  \nB')).toEqual(['A', 'B']);
  });

  it('returns a single-element array for plain text with no separator', () => {
    expect(splitBatch('Just one prompt, no separators here.')).toEqual([
      'Just one prompt, no separators here.',
    ]);
  });

  it('drops empty segments (leading/trailing/consecutive separators)', () => {
    expect(splitBatch('---\nA\n---\n---\nB\n---')).toEqual(['A', 'B']);
  });

  it('never fires on a markdown table divider', () => {
    const prompt = 'Summarize:\n\n| a | b |\n|---|---|\n| 1 | 2 |';
    expect(splitBatch(prompt)).toEqual([prompt.trim()]);
  });

  it('never fires on a `---` that is not alone on its line', () => {
    expect(splitBatch('Use the flag --- verbose for details.')).toEqual([
      'Use the flag --- verbose for details.',
    ]);
  });
});

describe('isBatch', () => {
  it('is true only when the split produces more than one prompt', () => {
    expect(isBatch('A\n---\nB')).toBe(true);
    expect(isBatch('Just one prompt.')).toBe(false);
    expect(isBatch('---\nA\n---')).toBe(false);
  });
});

describe('batchPreview', () => {
  it('collapses whitespace and truncates long prompts', () => {
    expect(batchPreview('Please   write\na summary.')).toBe('Please write a summary.');
    const long = 'x'.repeat(100);
    const preview = batchPreview(long, 20);
    expect(preview.length).toBe(20);
    expect(preview.endsWith('…')).toBe(true);
  });

  it('leaves short prompts untouched', () => {
    expect(batchPreview('Short one.')).toBe('Short one.');
  });
});
