import { describe, expect, it, vi } from 'vitest';
import { compressProtectedAware } from '../src/local-ml/segments';
import { findProtectedRanges } from '../src/core';

describe('compressProtectedAware', () => {
  it('reproduces the input exactly when the compressor is the identity', async () => {
    const input =
      'Please write a function that calls `x.utilize()` and returns "please" as a string.';
    const output = await compressProtectedAware(input, async (text) => text);
    expect(output).toBe(input);
  });

  it('never sends a protected region to the compressor', async () => {
    const input =
      'Summarize this in a friendly way. See https://example.com/docs for the schema ' +
      'and use the variable {{topic}}. The user said "do not change this literal string".';
    const seen: string[] = [];
    await compressProtectedAware(input, async (text) => {
      seen.push(text);
      return text;
    });

    for (const range of findProtectedRanges(input)) {
      const protectedText = input.slice(range.start, range.end);
      for (const sent of seen) {
        expect(sent).not.toContain(protectedText);
      }
    }
  });

  it('keeps every protected region verbatim in the reassembled output', async () => {
    const input =
      'Please compress this politely. ```js\nfunction f(x) { return x.utilize(); }\n``` ' +
      'Keep the email contact@example.com intact.';
    const output = await compressProtectedAware(input, async () => 'X');
    for (const range of findProtectedRanges(input)) {
      expect(output).toContain(input.slice(range.start, range.end));
    }
  });

  it('preserves segment order: protected and compressed text interleave correctly', async () => {
    const input =
      'This is the very first surrounding sentence right here. {{one}} ' +
      'This is the very second surrounding sentence right here. {{two}} ' +
      'This concludes the message finally and for good.';
    const output = await compressProtectedAware(input, async (text) => `[${text.trim()}]`);

    const oneAt = output.indexOf('{{one}}');
    const twoAt = output.indexOf('{{two}}');
    expect(oneAt).toBeGreaterThan(-1);
    expect(twoAt).toBeGreaterThan(oneAt);
    expect(output.indexOf('first surrounding')).toBeLessThan(oneAt);
    expect(output.indexOf('second surrounding')).toBeGreaterThan(oneAt);
    expect(output.indexOf('second surrounding')).toBeLessThan(twoAt);
    expect(output.indexOf('concludes the message')).toBeGreaterThan(twoAt);
  });

  it('skips segments below the length floor instead of calling the model on fragments', async () => {
    const input = 'Hi {{x}} bye';
    const compressSegment = vi.fn(async (text: string) => text.toUpperCase());
    const output = await compressProtectedAware(input, compressSegment);
    expect(compressSegment).not.toHaveBeenCalled();
    expect(output).toBe(input);
  });

  it('falls back to the original segment when the compressor returns nothing', async () => {
    const input = 'This sentence is long enough to be sent to the model for compression.';
    const output = await compressProtectedAware(input, async () => '   ');
    expect(output).toBe(input);
  });

  it('applies real per-segment compression around protected regions', async () => {
    const input = 'Please kindly write a very detailed summary of {{topic}} for me, thank you.';
    const dropFillers = async (text: string) =>
      text
        .replace(/\b(please|kindly|very|thank you)\b/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
    const output = await compressProtectedAware(input, dropFillers);
    expect(output).toContain('{{topic}}');
    expect(output.toLowerCase()).not.toContain('kindly');
    expect(output.toLowerCase()).not.toContain('please');
  });
});
