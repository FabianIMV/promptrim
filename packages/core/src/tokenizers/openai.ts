/**
 * Exact OpenAI token counting via `js-tiktoken`, encoding `o200k_base` — the
 * encoding shared by the GPT-4o and GPT-5 model families
 * (`getEncodingNameForModel` maps every current chat model to it).
 *
 * The o200k_base rank file is ~2.3 MB uncompressed. Both the encoder class
 * (`js-tiktoken/lite`, not the full multi-encoding package) and the rank data
 * are dynamically imported on first use and cached in module scope, so the
 * cost is paid once, lazily, on a separate chunk — never in the initial
 * bundle.
 */
// The encoder's type is inferred from the dynamic import rather than pulled in
// with a top-level `import type`. `js-tiktoken` is an ESM package with a CJS
// build behind the `require` condition; a static type-only import of its ESM
// declarations from `packages/core`'s CommonJS build needs a `resolution-mode`
// attribute (TS1541), while the `import()` below resolves to the `.cjs` entry
// on its own. Inferring costs nothing and keeps both builds happy.
function buildEncoder() {
  return Promise.all([import('js-tiktoken/lite'), import('js-tiktoken/ranks/o200k_base')]).then(
    ([{ Tiktoken }, { default: o200kBase }]) => new Tiktoken(o200kBase),
  );
}

let encoderPromise: ReturnType<typeof buildEncoder> | null = null;

function getEncoder(): ReturnType<typeof buildEncoder> {
  encoderPromise ??= buildEncoder();
  return encoderPromise;
}

/** Exact token count for OpenAI GPT-4o/GPT-5-family models (o200k_base). */
export async function countOpenAiTokens(text: string): Promise<number> {
  if (!text) return 0;
  const encoder = await getEncoder();
  return encoder.encode(text).length;
}
