/**
 * Phase 6 — import/export the prompt as `.txt`, `.md` or `.json`.
 *
 * Pure functions only: `App.tsx` owns the `File`/`Blob`/DOM download plumbing,
 * this module just decides what bytes go in and what comes back out, so it is
 * testable without a browser.
 */
import type { Level } from './rules';

export type TransferFormat = 'txt' | 'md' | 'json';

export interface ExportBundle {
  input: string;
  output: string;
  level: Level;
}

/** `.txt`/`.md` hold plain text — the compressed output when there is one, the original prompt otherwise. `.json` keeps both plus the level that produced the output. */
export function buildExportContent(format: TransferFormat, bundle: ExportBundle): string {
  if (format === 'json') {
    return (
      JSON.stringify({ input: bundle.input, output: bundle.output, level: bundle.level }, null, 2) +
      '\n'
    );
  }
  return bundle.output || bundle.input;
}

export function exportFileName(format: TransferFormat): string {
  return `promptrim.${format}`;
}

export function exportMimeType(format: TransferFormat): string {
  if (format === 'json') return 'application/json';
  if (format === 'md') return 'text/markdown';
  return 'text/plain';
}

/**
 * Reads an imported file back into a prompt string. A `.json` export from
 * this app round-trips its `input` field; anything else — a bare `.txt`/`.md`
 * file, or JSON that doesn't match the shape — is used verbatim as the
 * prompt text, which is the only sane fallback for a file this app didn't
 * produce itself.
 */
export function parseImportedFile(filename: string, content: string): string {
  if (filename.toLowerCase().endsWith('.json')) {
    try {
      const data = JSON.parse(content) as { input?: unknown };
      if (typeof data.input === 'string') return data.input;
    } catch {
      // Not valid JSON (or not this app's shape) — fall through to raw text.
    }
  }
  return content;
}
