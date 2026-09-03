import { describe, expect, it } from 'vitest';
import { compress } from '../src/core/compress';
import { extractConstraints, restoreConstraint, verifyConstraints } from '../src/core/ledger';

const ORIGINAL = [
  'Always answer in JSON.',
  'Never share the internal key.',
  'Summarise the ticket in one line.',
].join('\n');

function constraintFor(anchor: string) {
  const constraint = extractConstraints(ORIGINAL).find((c) => c.anchor === anchor);
  if (!constraint) throw new Error(`no constraint for ${anchor}`);
  return constraint;
}

describe('restoreConstraint', () => {
  it('re-inserts the lost sentence after the previous surviving one', () => {
    const compressed = 'Always answer in JSON.\nSummarise the ticket in one line.';
    const restored = restoreConstraint(
      ORIGINAL,
      compressed,
      constraintFor('Never share the internal key'),
    );
    expect(restored).toBe(ORIGINAL);
  });

  it('makes the constraint verify again', () => {
    const constraint = constraintFor('Never share the internal key');
    const compressed = 'Always answer in JSON.\nSummarise the ticket in one line.';
    expect(verifyConstraints(ORIGINAL, compressed, [constraint]).clean).toBe(false);
    const restored = restoreConstraint(ORIGINAL, compressed, constraint);
    expect(verifyConstraints(ORIGINAL, restored, [constraint]).clean).toBe(true);
  });

  it('falls back to the following sentence when nothing precedes it', () => {
    const constraint = constraintFor('Always answer in JSON');
    const compressed = 'Never share the internal key.\nSummarise the ticket in one line.';
    const restored = restoreConstraint(ORIGINAL, compressed, constraint);
    expect(restored.startsWith('Always answer in JSON.')).toBe(true);
  });

  it('appends when no neighbouring sentence survives', () => {
    const constraint = constraintFor('Never share the internal key');
    const restored = restoreConstraint(ORIGINAL, 'Totally different text.', constraint);
    expect(restored).toContain('Never share the internal key.');
  });

  it('is a no-op when the constraint is already there', () => {
    const constraint = constraintFor('Never share the internal key');
    expect(restoreConstraint(ORIGINAL, ORIGINAL, constraint)).toBe(ORIGINAL);
  });

  it('restores into an empty output', () => {
    const constraint = constraintFor('Never share the internal key');
    expect(restoreConstraint(ORIGINAL, '', constraint)).toBe('Never share the internal key.');
  });

  it('keeps the original text unmodified', () => {
    const before = ORIGINAL;
    restoreConstraint(ORIGINAL, 'Answer in JSON.', constraintFor('Never share the internal key'));
    expect(ORIGINAL).toBe(before);
  });

  it('restores a constraint dropped from a real compression', () => {
    const original = 'Please never use markdown. I would like you to answer in JSON.';
    const { output } = compress(original, 'aggressive');
    const constraint = extractConstraints(original).find((c) => c.type === 'prohibition')!;
    // Simulate an AI-mode output that dropped the prohibition entirely.
    const damaged = output.replace(/Never use markdown\.\s*/i, '');
    expect(verifyConstraints(original, damaged, [constraint]).clean).toBe(false);
    const restored = restoreConstraint(original, damaged, constraint);
    expect(verifyConstraints(original, restored, [constraint]).clean).toBe(true);
  });
});
