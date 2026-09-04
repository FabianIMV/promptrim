/**
 * Gemini `generateContent`, called straight from the browser.
 *
 * Checked against the official docs on 2026-09-03:
 *
 *  - Endpoint `POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`,
 *    header `x-goog-api-key`. CORS is allowed: a preflight answers
 *    `access-control-allow-headers: x-goog-api-key,content-type`.
 *  - **Structured output** is `generationConfig.responseMimeType = "application/json"`
 *    plus `generationConfig.responseSchema` (camelCase on REST).
 *    https://ai.google.dev/gemini-api/docs/structured-output
 *  - **Models**: `gemini-3.8-flash` (current stable Flash, the default here)
 *    plus the 2.5 pair the app already knew about; `gemini-2.5-flash` is the
 *    default verifier. The Flash-Lite models are deliberately absent: Google
 *    does not publish their minimum cacheable prefix, which the Cost Advisor
 *    of Phase 4 requires for every priced model.
 *    https://ai.google.dev/gemini-api/docs/models
 *  - The system prompt goes in `systemInstruction`, not in `contents`.
 *
 * `orderModels`, `getGeminiModels` and `formatGeminiFailure` are the model
 * discovery and error wording ported from the legacy `app.js` in Phase 0. They
 * survive Phase 5 because they still serve the target-model picker and the
 * token counter; what Phase 5 removes is the old one-shot "make it shorter"
 * call, replaced by the compress → verify → repair pipeline.
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
import { toGeminiSchema } from './schemas';

export type CompressionLevel = 'light' | 'balanced' | 'aggressive';

const LABEL = 'Gemini';
const API_ROOT = 'https://generativelanguage.googleapis.com/v1beta';

export const GEMINI_MODELS = ['gemini-3.8-flash', 'gemini-2.5-pro', 'gemini-2.5-flash'] as const;

/**
 * Preferred models in priority order for discovery. Exact names are tried
 * first; versioned or preview variants (e.g. gemini-3-flash-preview) follow
 * immediately after their base name so priority is preserved even when Google
 * only publishes dated snapshots.
 */
export const PREFERRED_MODELS = ['gemini-3.8-flash', 'gemini-2.5-flash', 'gemini-2.5-pro'] as const;

interface ModelListResponse {
  models?: { name?: string; supportedGenerationMethods?: string[] }[];
}

/** Order the caller's available models by preference. Pure; unit-tested. */
export function orderModels(available: readonly string[]): string[] {
  const preferred = [...PREFERRED_MODELS];
  if (!available.length) return preferred;

  const exactSet = new Set(available);
  const byPrefix = new Map<string, string[]>();
  for (const model of available) {
    const prefix = preferred.find((p) => model.startsWith(`${p}-`));
    if (!prefix) continue;
    const list = byPrefix.get(prefix) ?? [];
    list.push(model);
    byPrefix.set(prefix, list);
  }

  const matched = new Set<string>();
  const result: string[] = [];
  for (const prefix of preferred) {
    if (exactSet.has(prefix)) {
      result.push(prefix);
      matched.add(prefix);
    }
    for (const model of byPrefix.get(prefix) ?? []) {
      result.push(model);
      matched.add(model);
    }
  }
  for (const model of available) {
    if (!matched.has(model)) result.push(model);
  }
  return result;
}

export async function getGeminiModels(apiKey: string): Promise<string[]> {
  try {
    const resp = await fetch(`${API_ROOT}/models`, { headers: { 'x-goog-api-key': apiKey } });
    if (!resp.ok) return [...PREFERRED_MODELS];

    const data = (await resp.json()) as ModelListResponse;
    const available = (data.models ?? [])
      .filter((m) => (m.supportedGenerationMethods ?? []).includes('generateContent'))
      .map((m) => (m.name ?? '').replace(/^models\//, ''))
      .filter(Boolean);

    return orderModels(available);
  } catch (err) {
    console.warn('Gemini model discovery failed, using fallback models.', err);
    return [...PREFERRED_MODELS];
  }
}

interface ModelError {
  model: string;
  message: string;
}

/** Collapse per-model failures into one user-facing message. Pure; unit-tested. */
export function formatGeminiFailure(errors: readonly ModelError[]): string {
  if (!errors.length) return 'Gemini request failed for all configured models.';
  const unique = [...new Set(errors.map((e) => e.message))];
  if (unique.length === 1) return unique[0]!;
  return errors.map((e) => `${e.model}: ${e.message}`).join(' | ');
}

interface GenerateContentResponse {
  modelVersion?: string;
  promptFeedback?: { blockReason?: string; blockReasonMessage?: string };
  candidates?: { finishReason?: string; content?: { parts?: { text?: string }[] } }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
}

/** Exported for tests: `responseMimeType`/`responseSchema` casing is REST-specific. */
export function buildGeminiBody(request: StructuredRequest): Record<string, unknown> {
  return {
    systemInstruction: { parts: [{ text: request.system }] },
    contents: [{ role: 'user', parts: [{ text: request.user }] }],
    generationConfig: {
      maxOutputTokens: request.maxOutputTokens,
      responseMimeType: 'application/json',
      responseSchema: toGeminiSchema(request.schema),
    },
  };
}

/** `{ error: { code, message, status } }` is the documented error body. */
export function geminiErrorDetail(body: unknown): string | null {
  const error = (body as { error?: { message?: unknown } } | null)?.error;
  return shortDetail(error?.message);
}

async function readError(resp: Response): Promise<ProviderError> {
  const retryAfter = parseRetryAfter(resp.headers);
  let detail: string | null = null;
  try {
    detail = geminiErrorDetail(await resp.json());
  } catch {
    detail = null;
  }
  return new ProviderError('gemini', statusMessage(LABEL, resp.status, detail, retryAfter), {
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
    resp = await fetch(`${API_ROOT}/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(buildGeminiBody(request)),
      signal,
    });
  } catch (err) {
    throw networkError('gemini', LABEL, err);
  }

  if (!resp.ok) throw await readError(resp);

  const data = (await resp.json()) as GenerateContentResponse;
  const blockReason = data.promptFeedback?.blockReason;
  if (blockReason) {
    throw new ProviderError(
      'gemini',
      data.promptFeedback?.blockReasonMessage ?? `${LABEL} blocked the request (${blockReason}).`,
    );
  }

  const candidate = data.candidates?.[0];
  if (candidate?.finishReason === 'MAX_TOKENS') {
    throw new ProviderError(
      'gemini',
      `${LABEL} hit the output limit before finishing. Try a shorter prompt.`,
    );
  }

  const text = (candidate?.content?.parts ?? []).map((part) => part.text ?? '').join('');

  return {
    data: parseJsonPayload('gemini', LABEL, text),
    usage: data.usageMetadata
      ? {
          inputTokens: data.usageMetadata.promptTokenCount ?? 0,
          outputTokens: data.usageMetadata.candidatesTokenCount ?? 0,
        }
      : null,
    model: data.modelVersion ?? model,
  };
}

export const geminiProvider: ProviderClient = {
  id: 'gemini',
  label: 'Google Gemini',
  models: GEMINI_MODELS,
  defaultModel: 'gemini-3.8-flash',
  defaultVerifierModel: 'gemini-2.5-flash',
  keyLabel: 'Gemini API key',
  keyPlaceholder: 'AIza...',
  keyHelpUrl: 'https://aistudio.google.com/app/apikey',
  complete,
};
