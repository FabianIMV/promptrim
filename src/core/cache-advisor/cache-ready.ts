/**
 * "Generate cache-ready version": the same prompt, reordered so that the static
 * block comes first and a comment marks where the cache breakpoint goes.
 *
 * Nothing is rewritten or dropped — lines are only moved — because this is a
 * cost transformation, not a compression one. The invariant the tests hold it
 * to is that every original line survives, exactly once.
 */

import type { ModelPricing, Provider } from '../pricing';
import { splitPrompt } from './split';
import type { PromptSplit } from './split';
import type { CacheTtl } from './rules';

export interface CacheReadyResult {
  text: string;
  /** The breakpoint comment inserted between prefix and suffix. */
  marker: string;
  /** Lines moved out of the static block, in original order. */
  movedLines: string[];
  /** Short, display-ready explanations of what was done and what is left to do. */
  notes: string[];
  split: PromptSplit;
}

const MARKERS: Record<Provider, (ttl: CacheTtl | null) => string> = {
  anthropic: (ttl) =>
    `<!-- PromptTrim: cache breakpoint. Put cache_control {"type": "ephemeral"${
      ttl?.id === 'anthropic-1h' ? ', "ttl": "1h"' : ''
    }} on the last content block above this line. -->`,
  openai: () =>
    '<!-- PromptTrim: cache breakpoint. Everything above is the static prefix OpenAI reuses automatically — keep it byte-identical between calls. -->',
  gemini: (ttl) =>
    `<!-- PromptTrim: cache breakpoint. Create an explicit cache (ttl "${
      ttl ? `${ttl.seconds}s` : '3600s'
    }") holding everything above this line. -->`,
};

/**
 * Reorder `text` into a cacheable prefix, a breakpoint marker and the
 * per-request remainder.
 */
export function buildCacheReady(
  text: string,
  model: Pick<ModelPricing, 'provider'>,
  options: { ttl?: CacheTtl | null; split?: PromptSplit } = {},
): CacheReadyResult {
  const split = options.split ?? splitPrompt(text);
  const marker = MARKERS[model.provider](options.ttl ?? null);

  const movedLines = split.invalidators
    .map((m) => m.line)
    .filter((line, i, all) => all.indexOf(line) === i)
    .sort((a, b) => a - b)
    .map((line) => text.split('\n')[line] ?? '');

  const parts = [split.reorderedPrefix, marker, split.reorderedSuffix].filter(
    (part) => part.trim() !== '',
  );

  const notes: string[] = [];
  if (movedLines.length > 0) {
    notes.push(
      `Moved ${movedLines.length} per-request line${movedLines.length === 1 ? '' : 's'} below the breakpoint; they were cutting the cacheable prefix short.`,
    );
  }
  if (split.invalidators.some((m) => m.kind === 'variable')) {
    notes.push(
      'Template variables were treated as per-request. If one holds the same value on every call, inline it above the breakpoint to cache more.',
    );
  }
  if (split.reorderedPrefix.trim() === '') {
    notes.push('No static block was found: this prompt is dynamic from the first line.');
  }

  return { text: parts.join('\n\n'), marker, movedLines, notes, split };
}
