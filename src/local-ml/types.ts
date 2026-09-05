/**
 * Local ML mode — Phase 8 (docs/PLAN.md), experimental.
 *
 * This module lives at `src/local-ml/`, a sibling of `src/core/` and
 * `src/providers/`, not inside `core/`. docs/PLAN.md §2 fixes `core/` as pure
 * functions with no DOM; loading an ONNX model needs `fetch`, IndexedDB (the
 * transformers.js model cache) and, for device selection, `navigator.gpu` —
 * none of which are available or meaningful outside a browser/Node runtime.
 * Keeping it out of `core/` preserves that invariant instead of quietly
 * breaking it.
 */

/** Where a compression run currently stands. */
export type LocalMlPhase = 'loading-model' | 'compressing' | 'ready';

export interface LocalMlProgress {
  phase: LocalMlPhase;
  /** Short line for the UI, mirroring `AiStep.detail`. */
  message: string;
  /** 0-100 when known (a file download reports it); `null` otherwise. */
  percent: number | null;
}

/** The one capability this module needs from `@atjsh/llmlingua-2`. */
export interface LocalMlEngine {
  /** `rate` is the fraction of tokens to KEEP, per the library's own contract. */
  compress(text: string, rate: number): Promise<string>;
}
