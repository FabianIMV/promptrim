/**
 * The three structured-output schemas of the Phase 5 pipeline, written in the
 * subset every provider accepts, plus the per-provider adapters.
 *
 * Verified on the official docs on 2026-09-03:
 *
 *  - **Anthropic** — `output_config.format = { type: "json_schema", schema }`,
 *    GA (the old `output_format` parameter and the `structured-outputs-2025-11-13`
 *    beta header are no longer needed). Objects must carry
 *    `additionalProperties: false` and a `required` array; numeric/string
 *    constraints (`minLength`, `maximum`, …) are not supported.
 *    https://platform.claude.com/docs/en/build-with-claude/structured-outputs
 *  - **OpenAI** — `response_format = { type: "json_schema", json_schema: { name, schema, strict: true } }`
 *    on Chat Completions; `strict: true` requires `additionalProperties: false`
 *    and every property listed in `required`.
 *    https://developers.openai.com/api/docs/guides/structured-outputs
 *  - **Gemini** — `generationConfig.responseMimeType = "application/json"` plus
 *    `generationConfig.responseSchema`.
 *    https://ai.google.dev/gemini-api/docs/structured-output
 *
 * Because the intersection of the three is narrow, the schemas below use only
 * `object`, `string`, `boolean` and arrays of strings. No optional fields: on
 * OpenAI `strict` mode every property must be required anyway, so "no value"
 * is expressed as an empty string or an empty array.
 */

import type { JsonSchema } from './types';

/** Step A: the compression call. */
export const COMPRESS_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    compressed: {
      type: 'string',
      description: 'The compressed prompt, and nothing else. No preamble, no code fence.',
    },
    kept: {
      type: 'array',
      description: 'Ids of the constraints that survive verbatim or as an exact equivalent.',
      items: { type: 'string' },
    },
    dropped: {
      type: 'array',
      description: 'Ids of the constraints that did not make it into the compressed prompt.',
      items: { type: 'string' },
    },
  },
  required: ['compressed', 'kept', 'dropped'],
  additionalProperties: false,
};

/** Step B: the independent verification call. */
export const VERIFY_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    results: {
      type: 'array',
      description: 'One entry per constraint id given, in the same order.',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'The constraint id being judged.' },
          preserved: {
            type: 'boolean',
            description: 'True only when the compressed prompt still demands the same thing.',
          },
          evidence: {
            type: 'string',
            description:
              'The fragment of the compressed prompt that carries the constraint, quoted verbatim. Empty string when it is lost.',
          },
        },
        required: ['id', 'preserved', 'evidence'],
        additionalProperties: false,
      },
    },
  },
  required: ['results'],
  additionalProperties: false,
};

/** Step C: the repair call. */
export const REPAIR_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    compressed: {
      type: 'string',
      description: 'The repaired prompt: the previous compressed prompt plus the lost constraints.',
    },
    reinserted: {
      type: 'array',
      description: 'Ids of the constraints that were put back.',
      items: { type: 'string' },
    },
  },
  required: ['compressed', 'reinserted'],
  additionalProperties: false,
};

type UnknownRecord = Record<string, unknown>;

/**
 * Gemini's `responseSchema` is an OpenAPI 3.0 subset. `additionalProperties`
 * adds nothing there — `required` already lists every property of every object
 * in these schemas — so it is stripped rather than risking a 400 on a keyword
 * the OpenAPI dialect has never needed.
 */
export function toGeminiSchema(schema: JsonSchema): UnknownRecord {
  return strip(schema as unknown as UnknownRecord);
}

function strip(node: UnknownRecord): UnknownRecord {
  const out: UnknownRecord = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === 'additionalProperties') continue;
    if (Array.isArray(value)) {
      out[key] = value.map((entry) =>
        entry && typeof entry === 'object' ? strip(entry as UnknownRecord) : entry,
      );
    } else if (value && typeof value === 'object') {
      out[key] = strip(value as UnknownRecord);
    } else {
      out[key] = value;
    }
  }
  return out;
}
