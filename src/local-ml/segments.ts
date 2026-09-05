import { segment } from '../core';

/**
 * Segment-aware application of an ML compressor.
 *
 * LLMLingua-2 drops tokens by statistical importance, with no notion of a
 * protected region — left to itself it would compress code fences, quoted
 * strings and template variables exactly like prose. This is the piece that
 * makes the "always passes through protected regions" half of docs/PLAN.md
 * Phase 8 task 2 true: it reuses the same segmenter as `compress()`
 * (`src/core/segment.ts`) and only ever hands `compressSegment` the `text`
 * segments, copying every `protected` one through untouched. The other half
 * — the ledger — is layered on top in `pipeline.ts`, since the ledger
 * verifies whole-prompt output, not individual segments.
 */

/** Segments shorter than this are not worth a model call — a lone connector
 * word between two protected regions ("to ", " the ") has nothing to cut and
 * risks the model returning an empty string for a fragment with no sentence
 * shape. */
const MIN_SEGMENT_CHARS = 20;

export type SegmentCompressor = (text: string) => Promise<string>;

export async function compressProtectedAware(
  input: string,
  compressSegment: SegmentCompressor,
): Promise<string> {
  const parts: string[] = [];
  for (const seg of segment(input)) {
    if (seg.kind === 'protected' || seg.text.trim().length < MIN_SEGMENT_CHARS) {
      parts.push(seg.text);
      continue;
    }
    const result = await compressSegment(seg.text);
    // An unsupervised model returning nothing for a real segment would be a
    // worse outcome than not compressing it at all — never let a segment
    // vanish outright. Whitespace-only differences at the seams are left
    // as-is; even so, the ledger below is the actual safety net, not this.
    parts.push(result.trim() === '' ? seg.text : result);
  }
  return parts.join('');
}
