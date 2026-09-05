/**
 * Loads the on-device LLMLingua-2 model and wraps it behind `LocalMlEngine`.
 *
 * Everything here is dynamically imported (`@atjsh/llmlingua-2`,
 * `@huggingface/transformers`, the `js-tiktoken` rank data it needs
 * internally) and cached in module scope after the first call, the same
 * pattern `src/core/tokenizers/openai.ts` already uses for the o200k rank
 * file: the cost is paid once, lazily, on its own chunk, and only when this
 * mode is actually selected — never in the initial bundle.
 */
import type { ProgressInfo } from '@huggingface/transformers';
import type { LocalMlEngine, LocalMlProgress } from './types';

/**
 * TinyBERT, per docs/PLAN.md Phase 8 task 1: the smallest of the four models
 * `@atjsh/llmlingua-2` ships (~57 MB vs. 99 MB-2.2 GB for the others), the
 * right trade-off for a model a visitor downloads over the open web before
 * they can compress a single prompt.
 */
const MODEL_REPO = 'atjsh/llmlingua-2-js-tinybert-meetingbank';

export interface TransformerJsConfig {
  device: 'webgpu' | 'wasm' | 'cpu';
  dtype: 'fp32';
}

/**
 * Browsers: WebGPU when available (`navigator.gpu`), WASM otherwise — both
 * portable per the library's own README table. Node (the benchmark script)
 * has no `navigator` and passes its own `{ device: 'cpu' }` explicitly rather
 * than hitting this default.
 */
function defaultDevice(): TransformerJsConfig {
  const hasWebGpu = typeof navigator !== 'undefined' && 'gpu' in navigator;
  return { device: hasWebGpu ? 'webgpu' : 'wasm', dtype: 'fp32' };
}

function toProgress(info: ProgressInfo): LocalMlProgress {
  switch (info.status) {
    case 'initiate':
      return { phase: 'loading-model', message: `Fetching ${info.file}…`, percent: null };
    case 'progress':
      return {
        phase: 'loading-model',
        message: `Downloading ${info.file}`,
        percent: info.progress,
      };
    case 'done':
      return { phase: 'loading-model', message: `${info.file} ready`, percent: 100 };
    default:
      return { phase: 'loading-model', message: 'Preparing the local model…', percent: null };
  }
}

let enginePromise: Promise<LocalMlEngine> | null = null;

export function loadLocalMlEngine(
  onProgress?: (progress: LocalMlProgress) => void,
  transformerJSConfig: TransformerJsConfig = defaultDevice(),
): Promise<LocalMlEngine> {
  enginePromise ??= (async () => {
    const [{ LLMLingua2 }, { Tiktoken }, { default: o200kBase }] = await Promise.all([
      import('@atjsh/llmlingua-2'),
      import('js-tiktoken/lite'),
      import('js-tiktoken/ranks/o200k_base'),
    ]);
    const oaiTokenizer = new Tiktoken(o200kBase);
    const progress_callback = onProgress
      ? (info: ProgressInfo) => onProgress(toProgress(info))
      : undefined;

    const { promptCompressor } = await LLMLingua2.WithBERTMultilingual(MODEL_REPO, {
      transformerJSConfig,
      oaiTokenizer,
      pretrainedTokenizerOptions: progress_callback ? { progress_callback } : null,
      modelSpecificOptions: progress_callback ? { progress_callback } : null,
    });

    onProgress?.({ phase: 'ready', message: 'Model loaded.', percent: 100 });
    return {
      compress: (text: string, rate: number) => promptCompressor.compress_prompt(text, { rate }),
    };
  })();
  return enginePromise;
}
