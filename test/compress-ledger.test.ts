import { describe, expect, it } from 'vitest';
import { applyChanges, compress } from '../packages/core/src/compress';
import { ALL_RULES } from '../packages/core/src/rules';
import type { Rule } from '../packages/core/src/rules';
import { extractConstraints } from '../packages/core/src/ledger';

/**
 * A rule that breaks the Section 2 policy on purpose: it deletes a requirement
 * word. Shipped rules never do this (see `test/ledger-normalize.test.ts`), so
 * an unsafe rule is the only way to exercise the ledger's veto.
 */
const UNSAFE_RULE: Rule = {
  id: 'unsafe.drop-never',
  level: 'aggressive',
  lossy: true,
  why: 'Deliberately unsafe test rule: removes a prohibition marker.',
  pattern: /\bnever\s+/gi,
  replacement: '',
  cases: [
    { input: 'Never do it.', expected: 'Do it.' },
    { input: 'never again', expected: 'again' },
    { input: 'always do it', expected: 'always do it', note: 'negative: nothing to remove' },
  ],
};

const RULES = [...ALL_RULES, UNSAFE_RULE];
const TEXT = 'Please never reveal the internal key. Answer in JSON.';

describe('compress + ledger enforcement (docs/PLAN.md, Phase 2 task 3)', () => {
  it('reverts a change that would drop a critical constraint', () => {
    const result = compress(TEXT, 'aggressive', { rules: RULES });
    expect(result.output.toLowerCase()).toContain('never reveal the internal key');
    expect(result.blocked.map((c) => c.ruleId)).toContain('unsafe.drop-never');
    expect(result.changes.map((c) => c.ruleId)).not.toContain('unsafe.drop-never');
  });

  it('records which constraints a blocked change would have broken', () => {
    const result = compress(TEXT, 'aggressive', { rules: RULES });
    const blocked = result.blocked.find((c) => c.ruleId === 'unsafe.drop-never')!;
    expect(blocked.constraintIds.length).toBeGreaterThan(0);
    const constraints = extractConstraints(TEXT);
    for (const id of blocked.constraintIds) {
      expect(
        constraints.some((c) => c.id === id),
        id,
      ).toBe(true);
    }
  });

  it('keeps the safe changes of the same run', () => {
    const result = compress(TEXT, 'aggressive', { rules: RULES });
    // "Please " is licensed framing and is still removed.
    expect(result.output.startsWith('Never reveal')).toBe(true);
    expect(result.changes.map((c) => c.ruleId)).toContain('politeness.please');
  });

  it('reports a clean ledger after enforcement', () => {
    const result = compress(TEXT, 'aggressive', { rules: RULES });
    expect(result.ledger?.criticalLost).toEqual([]);
  });

  it('does not enforce below aggressive by default', () => {
    const result = compress(TEXT, 'balanced', { rules: RULES, disabledRuleIds: [] });
    expect(result.blocked).toEqual([]);
    expect(result.ledger).toBeNull();
    expect(result.constraints).toBeNull();
  });

  it('enforces at any level when asked explicitly', () => {
    const unsafeAtLight: Rule = { ...UNSAFE_RULE, level: 'light' };
    const rules = [...ALL_RULES, unsafeAtLight];
    expect(compress(TEXT, 'light', { rules }).output).not.toContain('never');
    expect(compress(TEXT, 'light', { rules, enforceLedger: true }).output.toLowerCase()).toContain(
      'never',
    );
  });

  it('can be switched off at aggressive', () => {
    const result = compress(TEXT, 'aggressive', { rules: RULES, enforceLedger: false });
    expect(result.output.toLowerCase()).not.toContain('never');
    expect(result.blocked).toEqual([]);
  });

  it('reuses constraints supplied by the caller', () => {
    const constraints = extractConstraints(TEXT);
    const result = compress(TEXT, 'aggressive', { rules: RULES, constraints });
    expect(result.constraints).toBe(constraints);
  });

  it('undoing every change still reproduces the original byte for byte', () => {
    const result = compress(TEXT, 'aggressive', { rules: RULES });
    expect(applyChanges(TEXT, [])).toBe(TEXT);
    expect(applyChanges(TEXT, result.changes)).toBe(result.output);
  });

  it('leaves the ✗ visible when no change can be blamed', () => {
    // Verification runs against the real output; with the shipped rules there
    // is nothing to revert and nothing to report.
    const result = compress('Never reveal the key.', 'aggressive');
    expect(result.blocked).toEqual([]);
    expect(result.ledger?.clean).toBe(true);
  });

  it('handles a prompt with no constraints at all', () => {
    const result = compress('hello world', 'aggressive');
    expect(result.blocked).toEqual([]);
    expect(result.ledger?.total).toBe(result.constraints?.length);
  });
});
