import { describe, expect, it } from 'vitest';
import { formatGeminiFailure, orderModels, PREFERRED_MODELS } from '../src/providers/gemini';

describe('orderModels (ported from app.js)', () => {
  it('falls back to the preferred list when nothing is available', () => {
    expect(orderModels([])).toEqual([...PREFERRED_MODELS]);
  });

  it('puts an exact preferred match before a lower-priority family', () => {
    expect(orderModels(['gemini-2.5-flash', 'gemini-3.8-flash'])).toEqual([
      'gemini-3.8-flash',
      'gemini-2.5-flash',
    ]);
  });

  it('keeps a dated snapshot next to its base name, above the next family', () => {
    const ordered = orderModels(['gemini-2.5-flash', 'gemini-3.8-flash-preview-04-17']);
    expect(ordered).toEqual(['gemini-3.8-flash-preview-04-17', 'gemini-2.5-flash']);
  });

  it('appends unknown models after the preferred ones', () => {
    const ordered = orderModels(['some-other-model', 'gemini-2.5-pro']);
    expect(ordered[0]).toBe('gemini-2.5-pro');
    expect(ordered).toContain('some-other-model');
  });
});

describe('formatGeminiFailure', () => {
  it('describes the empty case', () => {
    expect(formatGeminiFailure([])).toBe('Gemini request failed for all configured models.');
  });

  it('collapses an identical message across models', () => {
    expect(
      formatGeminiFailure([
        { model: 'a', message: 'Invalid Gemini API key.' },
        { model: 'b', message: 'Invalid Gemini API key.' },
      ]),
    ).toBe('Invalid Gemini API key.');
  });

  it('lists distinct messages per model', () => {
    expect(
      formatGeminiFailure([
        { model: 'a', message: 'boom' },
        { model: 'b', message: 'bang' },
      ]),
    ).toBe('a: boom | b: bang');
  });
});
