/**
 * Static prefix / dynamic suffix split and silent cache invalidators.
 */
import { describe, expect, it } from 'vitest';
import { findDynamicMarkers, splitPrompt } from '../src/core/cache-advisor/split';

const SUPPORT_PROMPT = `You are a support agent for Acme Corp.
Current date: 2026-09-03
Never share internal pricing with the customer.

## Guidelines
- Answer in at most 3 sentences.
- Escalate refunds over $500.

Example:
Input: my order 2026-01-02 is late
Output: I am sorry about that.

User: {{question}}
Session id: {{session_id}}`;

describe('findDynamicMarkers', () => {
  it('finds the date, the section label, the variables and the id', () => {
    const kinds = findDynamicMarkers(SUPPORT_PROMPT).map((m) => `${m.kind}:${m.text}`);
    expect(kinds).toEqual([
      'date:Current date',
      'date:2026-09-03',
      'section:User:',
      'variable:{{question}}',
      'identifier:Session id',
      'identifier:{{session_id}}',
    ]);
  });

  it('ignores markers inside few-shot examples and code fences', () => {
    // The 2026-01-02 inside the `Input:` example above is illustrative, not a
    // per-request value, and the example block is exactly what you want cached.
    expect(findDynamicMarkers(SUPPORT_PROMPT).some((m) => m.text === '2026-01-02')).toBe(false);

    const fenced = ['Follow the schema.', '```json', '{"date": "2026-09-03"}', '```'].join('\n');
    expect(findDynamicMarkers(fenced)).toEqual([]);
  });

  it('classifies a template variable by its name', () => {
    const markers = findDynamicMarkers('Today: {{today}} Request: {{request_id}} Name: {{name}}');
    expect(markers.map((m) => m.kind)).toEqual(['date', 'identifier', 'variable']);
  });

  it('reports each marker once, preferring the section reading', () => {
    // `<documents>` is both an XML section and a `<tag>`-shaped variable.
    const markers = findDynamicMarkers('Rules.\n<documents>{{passages}}</documents>');
    expect(markers.filter((m) => m.text === '<documents>')).toHaveLength(1);
    expect(markers[0]!.kind).toBe('section');
  });

  it('recognises the usual per-request section labels', () => {
    for (const label of ['User', 'Context', 'Documents', 'Conversation history', 'Question']) {
      const markers = findDynamicMarkers(`Static rules.\n${label}: something`);
      expect(markers.map((m) => m.kind)).toContain('section');
    }
  });
});

describe('splitPrompt', () => {
  const split = splitPrompt(SUPPORT_PROMPT);

  it('cuts the cacheable prefix at the first thing that varies', () => {
    expect(split.staticPrefix).toBe('You are a support agent for Acme Corp.\n');
    expect(split.dynamicSuffix.startsWith('Current date: 2026-09-03')).toBe(true);
  });

  it('reports the date as a silent invalidator, not the trailing variables', () => {
    expect(split.invalidators.map((m) => m.kind)).toEqual(['date', 'date']);
    expect(split.invalidators.every((m) => m.line === 1)).toBe(true);
  });

  it('puts the boundary at the first per-request section', () => {
    expect(SUPPORT_PROMPT.slice(split.boundary)).toBe(
      'User: {{question}}\nSession id: {{session_id}}',
    );
  });

  it('recovers the whole static block once the date line moves down', () => {
    expect(split.reorderedPrefix).toContain('Never share internal pricing');
    expect(split.reorderedPrefix).toContain('Escalate refunds over $500.');
    expect(split.reorderedPrefix).not.toContain('Current date');
    expect(split.reorderedSuffix.split('\n')[0]).toBe('Current date: 2026-09-03');
    expect(split.reorderedPrefix.length).toBeGreaterThan(split.staticPrefix.length * 5);
  });

  it('treats a prompt with no dynamic marker as fully static', () => {
    const text = 'You are a careful reviewer.\nNever approve without a test.';
    const s = splitPrompt(text);
    expect(s.staticPrefix).toBe(text);
    expect(s.dynamicSuffix).toBe('');
    expect(s.reorderedSuffix).toBe('');
    expect(s.invalidators).toEqual([]);
    expect(s.boundary).toBe(text.length);
  });

  it('treats a prompt that opens with a variable as fully dynamic', () => {
    const s = splitPrompt('{{user_input}}\nAnswer briefly.');
    expect(s.staticPrefix).toBe('');
    expect(s.cacheableEnd).toBe(0);
    expect(s.reorderedPrefix).toBe('Answer briefly.');
  });

  it('handles an empty prompt', () => {
    const s = splitPrompt('');
    expect(s.staticPrefix).toBe('');
    expect(s.dynamicSuffix).toBe('');
    expect(s.markers).toEqual([]);
  });

  it('never loses text: prefix + suffix is the original', () => {
    for (const text of [SUPPORT_PROMPT, 'a', '', 'User: hi', '{{x}}', 'Rules.\nContext: {{c}}']) {
      const s = splitPrompt(text);
      expect(s.staticPrefix + s.dynamicSuffix).toBe(text);
    }
  });
});
