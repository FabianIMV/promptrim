import { describe, expect, it } from 'vitest';
import { extractConstraints, findDuplicateConstraints } from '../src/core/ledger';

function duplicates(text: string) {
  return findDuplicateConstraints(extractConstraints(text));
}

describe('findDuplicateConstraints', () => {
  it('finds the same rule stated twice in different words', () => {
    const text = [
      'You must always answer in JSON.',
      'Summarise the ticket first.',
      'You must always reply in JSON.',
    ].join('\n');
    const groups = duplicates(text);
    expect(groups.length).toBeGreaterThan(0);
    const group = groups.find((g) => g.type === 'requirement');
    expect(group?.members.length).toBeGreaterThanOrEqual(2);
    expect(group?.similarity).toBeGreaterThanOrEqual(0.6);
  });

  it('proposes the shortest wording and never applies it', () => {
    const text = ['Never share the internal key.', 'Never share the key.'].join('\n');
    const group = duplicates(text).find((g) => g.type === 'prohibition');
    expect(group?.suggestion).toBe('Never share the key.');
  });

  it('does not group two different demands', () => {
    const text = ['Never share the key.', 'Never exceed 5 retries.'].join('\n');
    expect(duplicates(text).filter((g) => g.type === 'prohibition')).toEqual([]);
  });

  it('does not group two anchors that overlap in one sentence', () => {
    const text = 'Never share the key and never share the key material.';
    const groups = duplicates(text).filter((g) => g.type === 'prohibition');
    for (const group of groups) {
      const [a, b] = group.members;
      expect(a!.end <= b!.start || b!.end <= a!.start).toBe(true);
    }
  });

  it('ignores anchors that are too short to compare', () => {
    expect(findDuplicateConstraints(extractConstraints('Only. Only.'))).toEqual([]);
  });

  it('respects the similarity threshold', () => {
    const text = ['You must always answer in JSON.', 'You must always reply in JSON.'].join('\n');
    expect(findDuplicateConstraints(extractConstraints(text), 0.9)).toEqual([]);
    expect(findDuplicateConstraints(extractConstraints(text), 0.5).length).toBeGreaterThan(0);
  });

  it('returns groups in document order', () => {
    const text = [
      'Never share the key.',
      'Always answer in JSON.',
      'Never share the key.',
      'Always answer in JSON.',
    ].join('\n');
    const starts = duplicates(text).map((g) => g.members[0]!.start);
    expect([...starts].sort((a, b) => a - b)).toEqual(starts);
  });
});
