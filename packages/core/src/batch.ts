/**
 * Phase 6 — batch mode: several prompts pasted into one textarea, separated
 * by a line containing only `---`.
 *
 * The separator has to be a whole line on its own so it never fires inside a
 * markdown table divider (`|---|---|`) or a YAML/example fence a prompt
 * legitimately contains — those never appear as a bare `---` line by itself.
 */

/** Splits on a `---`-only line, trims each prompt, and drops empty ones. */
export function splitBatch(text: string): string[] {
  const lines = text.split(/\r?\n/);
  const segments: string[][] = [[]];
  for (const line of lines) {
    if (line.trim() === '---') {
      segments.push([]);
    } else {
      segments[segments.length - 1]!.push(line);
    }
  }
  return segments.map((segment) => segment.join('\n').trim()).filter((s) => s.length > 0);
}

/** True when the input contains at least one real separator with prompts on both sides. */
export function isBatch(text: string): boolean {
  return splitBatch(text).length > 1;
}

/** A short, single-line label for a batch row — never the full prompt. */
export function batchPreview(prompt: string, maxLength = 60): string {
  const flat = prompt.replace(/\s+/g, ' ').trim();
  return flat.length <= maxLength ? flat : `${flat.slice(0, maxLength - 1)}…`;
}
