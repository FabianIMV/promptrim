import { describe, expect, it } from 'vitest';
import { applyChanges, compress } from '../packages/core/src/compress';
import { LEVELS } from '../packages/core/src/rules';

describe('regression: the legacy engine corrupted content (docs/PLAN.md, Section 0)', () => {
  it('leaves `x.utilize()` inside a code fence untouched', () => {
    const prompt = [
      'Please review this function in order to find bugs.',
      '',
      '```js',
      'function f(x) {',
      '  // please utilize the fast path',
      '  return x.utilize();',
      '}',
      '```',
    ].join('\n');

    for (const level of LEVELS) {
      const out = compress(prompt, level).output;
      expect(out, level).toContain('return x.utilize();');
      expect(out, level).toContain('// please utilize the fast path');
    }
  });

  it('leaves "please" inside a quoted string untouched', () => {
    const prompt = 'If the user writes "please", echo it back. Please do not add prose.';
    const out = compress(prompt, 'aggressive').output;
    expect(out).toContain('"please"');
    expect(out).toBe('If the user writes "please", echo it back. Do not add prose.');
  });

  it('leaves inline code, urls, emails and template variables untouched', () => {
    const prompt =
      'Please run `please utilize --now`, read https://x.dev/in-order-to, mail a@b.dev, keep {{please}}.';
    const out = compress(prompt, 'aggressive').output;
    expect(out).toContain('`please utilize --now`');
    expect(out).toContain('https://x.dev/in-order-to');
    expect(out).toContain('a@b.dev');
    expect(out).toContain('{{please}}');
  });

  it('does not delete instruction words the legacy engine removed', () => {
    const prompt =
      'Always answer step by step. Make sure to ensure the output is valid. Never add prose. Return only JSON.';
    expect(compress(prompt, 'aggressive').output).toBe(prompt);
  });
});

describe('level semantics', () => {
  const concise = [
    'You are a support triage assistant.',
    '',
    '- Classify each ticket as billing, bug or other.',
    '- Answer with JSON only: {"label": "billing"}',
    '- Never invent a label.',
  ].join('\n');

  it('returns an already-concise prompt byte for byte at Light', () => {
    const result = compress(concise, 'light');
    expect(result.output).toBe(concise);
    expect(result.changes).toHaveLength(0);
  });

  it('Light never produces a lossy change', () => {
    const verbose = 'Please, in order to help, utilize the very best approach.';
    const result = compress(verbose, 'light');
    expect(result.changes.every((c) => !c.lossy)).toBe(true);
    expect(result.output).toBe(verbose);
  });

  it('Aggressive compresses at least as much as Balanced, which beats Light', () => {
    const verbose =
      'As an AI assistant, your task is to please write a very thorough summary in order to help the user.';
    const light = compress(verbose, 'light').output.length;
    const balanced = compress(verbose, 'balanced').output.length;
    const aggressive = compress(verbose, 'aggressive').output.length;
    expect(balanced).toBeLessThan(light);
    expect(aggressive).toBeLessThan(balanced);
  });

  it('repairs capitalisation after a sentence-initial removal', () => {
    expect(compress('Please write a haiku.', 'balanced').output).toBe('Write a haiku.');
    expect(compress('In order to help, be brief.', 'balanced').output).toBe('To help, be brief.');
    expect(compress('Ask them. Please reply fast.', 'balanced').output).toBe(
      'Ask them. Reply fast.',
    );
  });

  it('repairs capitalisation across two adjacent removals', () => {
    expect(compress('As an AI assistant, your task is to write tests.', 'aggressive').output).toBe(
      'Write tests.',
    );
  });

  it('does not capitalise into a protected region', () => {
    const prompt = 'Please https://example.com/x is the doc.';
    expect(compress(prompt, 'balanced').output).toBe('https://example.com/x is the doc.');
  });
});

describe('changes are the source of truth', () => {
  const prompt =
    'As an AI assistant, could you please utilize the API in order to fetch {{id}} from https://x.dev?';

  it('output equals the projection of its own changes', () => {
    const result = compress(prompt, 'aggressive');
    expect(applyChanges(prompt, result.changes)).toBe(result.output);
  });

  it('undoing every change reproduces the input byte for byte', () => {
    const result = compress(prompt, 'aggressive');
    expect(applyChanges(prompt, [])).toBe(prompt);
    const halfUndone = applyChanges(prompt, result.changes.slice(0, 1));
    expect(halfUndone.length).toBeLessThanOrEqual(prompt.length);
  });

  it('every change carries a rule id, a range and a lossy flag', () => {
    for (const change of compress(prompt, 'aggressive').changes) {
      expect(change.ruleId).toBeTruthy();
      expect(change.end).toBeGreaterThan(change.start);
      expect(prompt.slice(change.start, change.end)).toBe(change.original);
      expect(typeof change.lossy).toBe('boolean');
    }
  });

  it('changes never overlap', () => {
    const changes = compress(prompt, 'aggressive').changes;
    for (let i = 1; i < changes.length; i++) {
      expect(changes[i]!.start).toBeGreaterThanOrEqual(changes[i - 1]!.end);
    }
  });

  it('honours disabledRuleIds', () => {
    const all = compress(prompt, 'aggressive');
    const without = compress(prompt, 'aggressive', { disabledRuleIds: ['frame.as-an-ai'] });
    expect(all.changes.some((c) => c.ruleId === 'frame.as-an-ai')).toBe(true);
    expect(without.changes.some((c) => c.ruleId === 'frame.as-an-ai')).toBe(false);
  });
});

describe('edge cases', () => {
  it.each(LEVELS)('handles an empty prompt at %s', (level) => {
    expect(compress('', level).output).toBe('');
  });

  it('is idempotent: compressing the output again changes nothing', () => {
    const prompt = 'As an AI assistant, please utilize the tool in order to answer.';
    const once = compress(prompt, 'aggressive').output;
    expect(compress(once, 'aggressive').output).toBe(once);
  });
});
