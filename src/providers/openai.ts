/**
 * OpenAI Chat Completions, called straight from the browser.
 *
 * Checked against the official docs on 2026-09-03:
 *
 *  - Endpoint `POST https://api.openai.com/v1/chat/completions`, header
 *    `authorization: Bearer <key>`. CORS is allowed: a preflight answers
 *    `access-control-allow-headers: authorization,content-type` and
 *    `access-control-allow-methods: GET, OPTIONS, POST`.
 *  - **Structured output** is
 *    `response_format = { type: "json_schema", json_schema: { name, schema, strict: true } }`.
 *    Under `strict` the schema must set `additionalProperties: false` and list
 *    every property in `required` — see `schemas.ts`.
 *    https://developers.openai.com/api/docs/guides/structured-outputs
 *  - **`max_completion_tokens`, not `max_tokens`.** The GPT-5.x reasoning
 *    family rejects `max_tokens` outright, and `max_tokens` is deprecated for
 *    the rest of Chat Completions. Same family rejects `temperature`, `top_p`
 *    and the penalties, so none of them are sent.
 *  - **Models**: `gpt-5.6-sol` (flagship), `gpt-5.6-terra` (balanced),
 *    `gpt-5.6-luna` (cost-optimised, used as the default verifier).
 *    https://developers.openai.com/api/docs/models
 *  - A safety refusal comes back as `choices[0].message.refusal`, not as an
 *    HTTP error.
 */

import {
  networkError,
  parseJsonPayload,
  parseRetryAfter,
  ProviderError,
  shortDetail,
  statusMessage,
} from './types';
import type { CallOptions, ProviderClient, StructuredRequest, StructuredResponse } from './types';

const API_URL = 'https://api.openai.com/v1/chat/completions';
const LABEL = 'OpenAI';

export const OPENAI_MODELS = ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'] as const;

interface OpenAiResponse {
  model?: string;
  choices?: {
    finish_reason?: string;
    message?: { content?: string | null; refusal?: string | null };
  }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/** Exported for tests: the parameter names here are the easy thing to get wrong. */
export function buildOpenAiBody(
  request: StructuredRequest,
  model: string,
): Record<string, unknown> {
  return {
    model,
    // `max_tokens` is rejected by the GPT-5.x family; this is its replacement.
    max_completion_tokens: request.maxOutputTokens,
    messages: [
      { role: 'system', content: request.system },
      { role: 'user', content: request.user },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: request.schemaName,
        schema: request.schema,
        strict: true,
      },
    },
  };
}

export function openAiHeaders(apiKey: string): Record<string, string> {
  return {
    'content-type': 'application/json',
    authorization: `Bearer ${apiKey}`,
  };
}

/** `{ error: { message, type, code, param } }` is the documented error body. */
export function openAiErrorDetail(body: unknown): string | null {
  const error = (body as { error?: { message?: unknown } } | null)?.error;
  return shortDetail(error?.message);
}

async function readError(resp: Response): Promise<ProviderError> {
  const retryAfter = parseRetryAfter(resp.headers);
  let detail: string | null = null;
  try {
    detail = openAiErrorDetail(await resp.json());
  } catch {
    detail = null;
  }
  return new ProviderError('openai', statusMessage(LABEL, resp.status, detail, retryAfter), {
    status: resp.status,
    retryAfterSeconds: retryAfter,
  });
}

async function complete(
  request: StructuredRequest,
  { apiKey, model, signal }: CallOptions,
): Promise<StructuredResponse> {
  let resp: Response;
  try {
    resp = await fetch(API_URL, {
      method: 'POST',
      headers: openAiHeaders(apiKey),
      body: JSON.stringify(buildOpenAiBody(request, model)),
      signal,
    });
  } catch (err) {
    throw networkError('openai', LABEL, err);
  }

  if (!resp.ok) throw await readError(resp);

  const data = (await resp.json()) as OpenAiResponse;
  const choice = data.choices?.[0];
  if (choice?.message?.refusal) {
    throw new ProviderError('openai', `${LABEL} declined to process this prompt.`);
  }
  if (choice?.finish_reason === 'length') {
    throw new ProviderError(
      'openai',
      `${LABEL} hit the output limit before finishing. Try a shorter prompt.`,
    );
  }

  return {
    data: parseJsonPayload('openai', LABEL, choice?.message?.content ?? ''),
    usage: data.usage
      ? {
          inputTokens: data.usage.prompt_tokens ?? 0,
          outputTokens: data.usage.completion_tokens ?? 0,
        }
      : null,
    model: data.model ?? model,
  };
}

export const openAiProvider: ProviderClient = {
  id: 'openai',
  label: LABEL,
  models: OPENAI_MODELS,
  defaultModel: 'gpt-5.6-sol',
  defaultVerifierModel: 'gpt-5.6-luna',
  keyLabel: 'OpenAI API key',
  keyPlaceholder: 'sk-...',
  keyHelpUrl: 'https://platform.openai.com/api-keys',
  complete,
};
