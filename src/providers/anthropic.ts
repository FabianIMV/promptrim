/**
 * Anthropic Messages API, called straight from the browser.
 *
 * Everything below was checked against the official docs on 2026-09-03:
 *
 *  - Endpoint `POST https://api.anthropic.com/v1/messages`, headers `x-api-key`,
 *    `anthropic-version: 2023-06-01`, `content-type: application/json`.
 *  - **Direct browser access** needs `anthropic-dangerous-direct-browser-access: true`.
 *    Confirmed on the wire as well: a CORS preflight to `/v1/messages` answers
 *    `access-control-allow-headers: x-api-key,anthropic-version,content-type,anthropic-dangerous-direct-browser-access`.
 *    The "dangerous" in the name is about embedding *your* key in a page; here
 *    the key is the visitor's own and never leaves their browser.
 *  - **Structured output** is `output_config.format = { type: "json_schema", schema }`.
 *    It is GA: no beta header, and the older top-level `output_format` is
 *    deprecated. The JSON comes back as a normal `text` content block.
 *    https://platform.claude.com/docs/en/build-with-claude/structured-outputs
 *  - **Models**: `claude-opus-5` (default here, per docs/PLAN.md §3 Phase 5),
 *    `claude-sonnet-5`, `claude-haiku-4-5` (alias of `claude-haiku-4-5-20251001`).
 *  - **Effort**: `output_config.effort` defaults to `high` on Opus 5 and
 *    Sonnet 5 and is *not supported* on Haiku 4.5 — sending it there is an
 *    error, hence `SUPPORTS_EFFORT`.
 *    https://platform.claude.com/docs/en/about-claude/models/overview
 *  - 429 carries `retry-after`; 529 is the overload status.
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

const API_URL = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';
const LABEL = 'Anthropic';

export const ANTHROPIC_MODELS = ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5'] as const;

/**
 * `output_config.effort` is rejected on Haiku 4.5 ("Default effort: Not
 * supported" in the models table), so it is only sent to the models that take it.
 */
const SUPPORTS_EFFORT = new Set<string>(['claude-opus-5', 'claude-sonnet-5']);

export function supportsEffort(model: string): boolean {
  return SUPPORTS_EFFORT.has(model);
}

interface AnthropicResponse {
  model?: string;
  stop_reason?: string;
  content?: { type?: string; text?: string }[];
  usage?: { input_tokens?: number; output_tokens?: number };
}

/**
 * Build the request body. Exported for tests: this is where the documented
 * parameter names live, and a typo here is a silent 400 in the browser.
 */
export function buildAnthropicBody(
  request: StructuredRequest,
  model: string,
): Record<string, unknown> {
  const outputConfig: Record<string, unknown> = {
    format: { type: 'json_schema', schema: request.schema },
  };
  // Compression is a rewriting task, not a research task: the default `high`
  // burns thinking tokens the user pays for with no measurable gain on the
  // corpus. `medium` is the lowest level that still respects the ledger.
  if (supportsEffort(model)) outputConfig.effort = 'medium';

  return {
    model,
    max_tokens: request.maxOutputTokens,
    system: request.system,
    messages: [{ role: 'user', content: request.user }],
    output_config: outputConfig,
  };
}

export function anthropicHeaders(apiKey: string): Record<string, string> {
  return {
    'content-type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': API_VERSION,
    'anthropic-dangerous-direct-browser-access': 'true',
  };
}

/** `{ type: "error", error: { type, message } }` is the documented error body. */
export function anthropicErrorDetail(body: unknown): string | null {
  const error = (body as { error?: { message?: unknown } } | null)?.error;
  return shortDetail(error?.message);
}

async function readError(resp: Response): Promise<ProviderError> {
  const retryAfter = parseRetryAfter(resp.headers);
  let detail: string | null = null;
  try {
    detail = anthropicErrorDetail(await resp.json());
  } catch {
    detail = null;
  }
  return new ProviderError('anthropic', statusMessage(LABEL, resp.status, detail, retryAfter), {
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
      headers: anthropicHeaders(apiKey),
      body: JSON.stringify(buildAnthropicBody(request, model)),
      signal,
    });
  } catch (err) {
    throw networkError('anthropic', LABEL, err);
  }

  if (!resp.ok) throw await readError(resp);

  const data = (await resp.json()) as AnthropicResponse;
  if (data.stop_reason === 'refusal') {
    throw new ProviderError('anthropic', `${LABEL} declined to process this prompt.`);
  }
  if (data.stop_reason === 'max_tokens') {
    throw new ProviderError(
      'anthropic',
      `${LABEL} hit the output limit before finishing. Try a shorter prompt.`,
    );
  }

  const text = (data.content ?? [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('');

  return {
    data: parseJsonPayload('anthropic', LABEL, text),
    usage: data.usage
      ? {
          inputTokens: data.usage.input_tokens ?? 0,
          outputTokens: data.usage.output_tokens ?? 0,
        }
      : null,
    model: data.model ?? model,
  };
}

export const anthropicProvider: ProviderClient = {
  id: 'anthropic',
  label: LABEL,
  models: ANTHROPIC_MODELS,
  defaultModel: 'claude-opus-5',
  defaultVerifierModel: 'claude-haiku-4-5',
  keyLabel: 'Anthropic API key',
  keyPlaceholder: 'sk-ant-...',
  keyHelpUrl: 'https://platform.claude.com/settings/keys',
  complete,
};
