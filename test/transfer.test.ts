import { describe, expect, it } from 'vitest';
import {
  buildExportContent,
  exportFileName,
  exportMimeType,
  parseImportedFile,
} from '../packages/core/src/transfer';

describe('buildExportContent', () => {
  it('exports the compressed output as plain text for .txt/.md', () => {
    const bundle = { input: 'Please write X.', output: 'Write X.', level: 'balanced' as const };
    expect(buildExportContent('txt', bundle)).toBe('Write X.');
    expect(buildExportContent('md', bundle)).toBe('Write X.');
  });

  it('falls back to the input when there is no output yet', () => {
    const bundle = { input: 'Please write X.', output: '', level: 'balanced' as const };
    expect(buildExportContent('txt', bundle)).toBe('Please write X.');
  });

  it('exports input, output and level as a JSON object', () => {
    const bundle = { input: 'Please write X.', output: 'Write X.', level: 'aggressive' as const };
    const parsed = JSON.parse(buildExportContent('json', bundle)) as typeof bundle;
    expect(parsed).toEqual(bundle);
  });
});

describe('exportFileName / exportMimeType', () => {
  it('names files by format', () => {
    expect(exportFileName('txt')).toBe('promptrim.txt');
    expect(exportFileName('md')).toBe('promptrim.md');
    expect(exportFileName('json')).toBe('promptrim.json');
  });

  it('picks a MIME type per format', () => {
    expect(exportMimeType('txt')).toBe('text/plain');
    expect(exportMimeType('md')).toBe('text/markdown');
    expect(exportMimeType('json')).toBe('application/json');
  });
});

describe('parseImportedFile', () => {
  it('uses .txt/.md content verbatim', () => {
    expect(parseImportedFile('prompt.txt', 'Write X.')).toBe('Write X.');
    expect(parseImportedFile('prompt.md', '# Write X.')).toBe('# Write X.');
  });

  it('reads the input field back out of a .json export from this app', () => {
    const content = JSON.stringify({ input: 'Write X.', output: 'X.', level: 'light' });
    expect(parseImportedFile('promptrim.json', content)).toBe('Write X.');
  });

  it('falls back to the raw file content for JSON with no input field', () => {
    const content = JSON.stringify({ foo: 'bar' });
    expect(parseImportedFile('data.json', content)).toBe(content);
  });

  it('falls back to the raw file content for invalid JSON', () => {
    expect(parseImportedFile('broken.json', '{not valid json')).toBe('{not valid json');
  });
});
