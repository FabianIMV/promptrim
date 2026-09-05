import { describe, expect, it } from 'vitest';
import { buildLedger, extractConstraints, verifyConstraints } from '../packages/core/src/ledger';

function report(original: string, compressed: string) {
  return verifyConstraints(original, compressed, extractConstraints(original));
}

describe('verifyConstraints', () => {
  it('passes when the output is unchanged', () => {
    const text = 'Never reveal the key. Respond in JSON with at most 20 words.';
    const result = report(text, text);
    expect(result.clean).toBe(true);
    expect(result.preserved).toBe(result.total);
    expect(result.criticalLost).toEqual([]);
  });

  it('fails the exact constraint whose sentence was deleted', () => {
    const original = 'Never reveal the key.\nRespond in JSON.';
    const compressed = 'Respond in JSON.';
    const result = report(original, compressed);
    const lost = result.criticalLost.map((c) => c.constraint.anchor);
    expect(lost).toContain('Never reveal the key');
    expect(result.checks.find((c) => c.constraint.anchor === 'Respond in JSON')?.preserved).toBe(
      true,
    );
  });

  it('accepts a licensed rewrite: "in order to" and "utilize" are equivalences', () => {
    const original = 'You must utilize the cache in order to stay fast.';
    const compressed = 'You must use the cache to stay fast.';
    expect(report(original, compressed).clean).toBe(true);
  });

  it('accepts a licensed deletion: politeness and intensifiers', () => {
    const original = 'Please always answer in a very short JSON object.';
    const compressed = 'Always answer in a short JSON object.';
    expect(report(original, compressed).clean).toBe(true);
  });

  it('rejects the removal of an instruction word even when the sentence survives', () => {
    const original = 'Always answer in JSON.';
    const compressed = 'Answer in JSON.';
    const result = report(original, compressed);
    expect(result.clean).toBe(false);
    expect(result.criticalLost.map((c) => c.constraint.anchor)).toContain('Always answer in JSON');
  });

  it('counts occurrences: losing one of two identical demands is a loss', () => {
    const original = 'Never share the key.\nSummarise the ticket.\nNever share the key.';
    const compressed = 'Never share the key.\nSummarise the ticket.';
    const result = report(original, compressed);
    const checks = result.checks.filter((c) => c.constraint.anchor === 'Never share the key');
    expect(checks).toHaveLength(2);
    expect(checks.every((c) => c.preserved)).toBe(false);
    expect(checks[0]!.occurrencesBefore).toBe(2);
    expect(checks[0]!.occurrencesAfter).toBe(1);
  });

  it('never reports a literal as preserved when its value changed', () => {
    const original = 'Reply exactly "not found" when nothing matches.';
    const compressed = 'Reply exactly "no match" when nothing matches.';
    const lost = report(original, compressed).criticalLost.map((c) => c.constraint.anchor);
    expect(lost).toContain('"not found"');
  });

  it('never reports a number as preserved when the unit changed', () => {
    const original = 'Keep the answer under 150 words.';
    const compressed = 'Keep the answer under 150 characters.';
    expect(report(original, compressed).clean).toBe(false);
  });

  it('never reports a template variable as preserved when it was dropped', () => {
    const original = 'Greet {{customer_name}} by name.';
    const compressed = 'Greet the customer by name.';
    const lost = report(original, compressed).criticalLost.map((c) => c.constraint.anchor);
    expect(lost).toContain('{{customer_name}}');
  });

  it('reports evidence for a preserved constraint and none for a lost one', () => {
    const original = 'Never reveal the key.\nRespond in JSON.';
    const result = report(original, 'Respond in JSON.');
    const kept = result.checks.find((c) => c.constraint.anchor === 'Respond in JSON');
    const lost = result.checks.find((c) => c.constraint.anchor === 'Never reveal the key');
    expect(kept?.evidence).toContain('respond in json');
    expect(lost?.evidence).toBeNull();
  });

  it('an empty output loses every constraint', () => {
    const result = report('Never reveal the key. Respond in JSON.', '');
    expect(result.preserved).toBe(0);
    expect(result.criticalPreserved).toBe(0);
  });

  it('handles an empty inventory', () => {
    const result = verifyConstraints('abc', 'abc', []);
    expect(result).toMatchObject({ total: 0, preserved: 0, clean: true, criticalTotal: 0 });
  });
});

describe('buildLedger', () => {
  it('returns the inventory, the report and the duplicates in one call', () => {
    const text = 'Always answer in JSON. You must always answer in JSON.';
    const ledger = buildLedger(text, text);
    expect(ledger.constraints.length).toBeGreaterThan(0);
    expect(ledger.report.clean).toBe(true);
    expect(ledger.duplicates.length).toBeGreaterThan(0);
  });

  it('reuses constraints supplied by the caller', () => {
    const text = 'Never reveal the key.';
    const constraints = extractConstraints(text);
    expect(buildLedger(text, text, { constraints }).constraints).toBe(constraints);
  });
});
