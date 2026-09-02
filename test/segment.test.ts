import { describe, expect, it } from 'vitest';
import { findProtectedRanges, segment } from '../src/core/segment';
import type { ProtectedKind } from '../src/core/segment';

function kindsOf(input: string): ProtectedKind[] {
  return findProtectedRanges(input).map((r) => r.kind);
}

function protectedTexts(input: string, kind?: ProtectedKind): string[] {
  return segment(input)
    .filter((s) => s.kind === 'protected' && (!kind || s.protectedKind === kind))
    .map((s) => s.text);
}

describe('segment', () => {
  it('covers the whole input with no gaps or overlaps', () => {
    const input = 'Use `code` and see https://x.dev, then {"a": 1} and {{var}}.';
    const segments = segment(input);
    expect(segments.map((s) => s.text).join('')).toBe(input);
    for (let i = 1; i < segments.length; i++) {
      expect(segments[i]!.start).toBe(segments[i - 1]!.end);
    }
  });

  it('returns a single text segment when nothing is protected', () => {
    const segments = segment('just plain prose here');
    expect(segments).toHaveLength(1);
    expect(segments[0]!.kind).toBe('text');
  });

  describe('code fences', () => {
    it('protects a fenced block including its markers', () => {
      const input = 'before\n```js\nreturn x.utilize();\n```\nafter';
      expect(protectedTexts(input, 'code-fence')).toEqual(['```js\nreturn x.utilize();\n```']);
    });

    it('protects to the end of input when the fence is never closed', () => {
      const input = 'before\n```\nplease utilize';
      expect(protectedTexts(input, 'code-fence')).toEqual(['```\nplease utilize']);
    });

    it('handles two fences without merging them', () => {
      const input = '```\na\n```\nprose\n```\nb\n```';
      expect(protectedTexts(input, 'code-fence')).toEqual(['```\na\n```', '```\nb\n```']);
    });

    it('supports tilde fences', () => {
      expect(protectedTexts('~~~\nplease\n~~~', 'code-fence')).toEqual(['~~~\nplease\n~~~']);
    });
  });

  describe('inline code', () => {
    it('protects single backtick spans', () => {
      expect(protectedTexts('run `git status` now', 'inline-code')).toEqual(['`git status`']);
    });

    it('protects double backtick spans containing a backtick', () => {
      expect(protectedTexts('use ``a ` b`` here', 'inline-code')).toEqual(['``a ` b``']);
    });

    it('does not protect a lone backtick', () => {
      expect(protectedTexts('a ` b', 'inline-code')).toEqual([]);
    });
  });

  describe('quoted strings', () => {
    it('protects double-quoted strings', () => {
      expect(protectedTexts('echo "please utilize"', 'quoted-string')).toEqual([
        '"please utilize"',
      ]);
    });

    it('protects single-quoted strings but not apostrophes', () => {
      expect(protectedTexts("don't stop, say 'please'", 'quoted-string')).toEqual(["'please'"]);
    });

    it('protects typographic quotes', () => {
      expect(protectedTexts('say “please” now', 'quoted-string')).toEqual(['“please”']);
    });
  });

  describe('urls and emails', () => {
    it('protects a url without swallowing the trailing period', () => {
      const input = 'See https://example.com/in-order-to.';
      expect(protectedTexts(input, 'url')).toEqual(['https://example.com/in-order-to']);
    });

    it('protects bare www hosts', () => {
      expect(protectedTexts('go to www.example.com now', 'url')).toEqual(['www.example.com']);
    });

    it('protects emails', () => {
      expect(protectedTexts('mail support@example.com today', 'email')).toEqual([
        'support@example.com',
      ]);
    });
  });

  describe('template variables', () => {
    it.each([
      ['{{company}}', 'hello {{company}} there'],
      ['${user_id}', 'id is ${user_id} ok'],
      ['{locale}', 'locale {locale} ok'],
      ['<name>', 'render <name> exactly'],
      ['[CUSTOMER_NAME]', 'dear [CUSTOMER_NAME] hi'],
    ])('protects %s', (expected, input) => {
      expect(protectedTexts(input, 'variable')).toContain(expected);
    });

    it('protects printf placeholders', () => {
      expect(protectedTexts('format %s exactly', 'variable')).toEqual(['%s']);
    });

    it('does not treat ordinary prose braces-free text as a variable', () => {
      expect(protectedTexts('no variables here', 'variable')).toEqual([]);
    });
  });

  describe('json', () => {
    it('protects a JSON object detected by shape', () => {
      const input = 'Return {"name": "please utilize", "n": 3} exactly.';
      expect(protectedTexts(input, 'json')).toEqual(['{"name": "please utilize", "n": 3}']);
    });

    it('protects a multi-line JSON array', () => {
      const input = 'Use:\n[\n  {"a": 1},\n  {"b": 2}\n]\ndone';
      expect(protectedTexts(input, 'json')).toEqual(['[\n  {"a": 1},\n  {"b": 2}\n]']);
    });

    it('does not treat a template variable as JSON', () => {
      expect(kindsOf('use {locale} here')).toEqual(['variable']);
    });
  });

  describe('tables and examples', () => {
    it('protects a markdown table with its header', () => {
      const input = 'before\n| a | b |\n|---|---|\n| 1 | 2 |\nafter';
      expect(protectedTexts(input, 'table')).toEqual(['| a | b |\n|---|---|\n| 1 | 2 |']);
    });

    it('protects a labelled example block', () => {
      const input = 'Classify.\n\nExample:\nInput: "please"\nOutput: negative\n\nAnswer only.';
      expect(protectedTexts(input, 'example')).toEqual([
        'Example:\nInput: "please"\nOutput: negative',
      ]);
    });

    it('protects <example> tags', () => {
      const input = 'see <example>please utilize</example> above';
      expect(protectedTexts(input, 'example')).toEqual(['<example>please utilize</example>']);
    });
  });

  it('resolves overlaps by detector priority: a fence wins over inline code', () => {
    const input = '```\n`inner` please\n```';
    expect(kindsOf(input)).toEqual(['code-fence']);
  });
});
