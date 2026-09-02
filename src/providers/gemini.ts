/**
 * Gemini provider — ported from the legacy `app.js` (lines 246-377), keeping its
 * model discovery and error handling, now typed and DOM-free.
 *
 * Phase 5 replaces the single "make it shorter" call with the two-step
 * compress → verify → repair pipeline behind a shared provider interface. Until
 * then this is deliberately the same behaviour the old app had.
 */

export type CompressionLevel = 'light' | 'balanced' | 'aggressive';

export const GEMINI_REQUEST_TIMEOUT_MS = 25_000;

const GEMINI_STATUS_MESSAGES: Record<number, string> = {
  400: 'Bad request sent to Gemini API.',
  401: 'Invalid Gemini API key.',
  403: 'Gemini API access denied for this key/project.',
  404: 'Gemini model not available.',
  429: 'Gemini API rate limit reached. Try again in a moment.',
  500: 'Gemini service error. Please retry shortly.',
  503: 'Gemini service temporarily unavailable.',
};

export const SYSTEM_PROMPTS: Record<CompressionLevel, string> = {
  light:
    'Rewrite this AI prompt more concisely. Remove filler words and minor redundancies. Keep all details and examples. Output only the rewritten prompt, nothing else.',
  balanced:
    'Compress this AI prompt to save tokens. Remove filler words, redundant phrasing, and verbose language. Preserve all key requirements, constraints, and context. Output only the compressed prompt, nothing else.',
  aggressive:
    'Aggressively compress this AI prompt to the minimum tokens needed. Remove everything non-essential: pleasantries, filler words, verbose phrasing, redundant context. Keep only the core task, key constraints, and critical context. Output only the compressed prompt, nothing else — no preamble, no explanation.',
};

/**
 * Preferred models in priority order. Exact names are tried first; versioned or
 * preview variants (e.g. gemini-2.5-flash-preview-04-17) follow immediately
 * after their base name so priority is preserved even when Google only
 * publishes dated snapshots.
 */
export const PREFERRED_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-2.5-pro',
  'gemini-1.5-flash',
  'gemini-1.5-pro',
] as const;

const API_ROOT = 'https://generativelanguage.googleapis.com/v1beta';

interface ModelListResponse {
  models?: { name?: string; supportedGenerationMethods?: string[] }[];
}

interface GenerateContentResponse {
  promptFeedback?: { blockReason?: string; blockReasonMessage?: string };
  candidates?: { finishReason?: string; content?: { parts?: { text?: string }[] } }[];
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

async function parseGeminiError(resp: Response): Promise<string> {
  const fallback = GEMINI_STATUS_MESSAGES[resp.status] ?? `API error ${resp.status}`;
  try {
    const json = (await resp.json()) as { error?: { message?: string } };
    return json.error?.message ?? fallback;
  } catch {
    return fallback;
  }
}

export async function aiCompress(
  text: string,
  level: CompressionLevel,
  apiKey: string,
): Promise<string> {
  const models = await getGeminiModels(apiKey);
  const errors: ModelError[] = [];

  for (const model of models) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), GEMINI_REQUEST_TIMEOUT_MS);
    try {
      const resp = await fetch(`${API_ROOT}/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM_PROMPTS[level] }] },
          generationConfig: { maxOutputTokens: 2048 },
          contents: [{ role: 'user', parts: [{ text }] }],
        }),
        signal: controller.signal,
      });

      if (!resp.ok) {
        errors.push({ model, message: await parseGeminiError(resp) });
        continue;
      }

      const data = (await resp.json()) as GenerateContentResponse;
      const blockReason = data.promptFeedback?.blockReason;
      if (blockReason) {
        errors.push({
          model,
          message:
            data.promptFeedback?.blockReasonMessage ??
            `Gemini blocked the request (${blockReason}).`,
        });
        continue;
      }

      const candidate = data.candidates?.[0];
      const output = (candidate?.content?.parts ?? [])
        .map((p) => p.text ?? '')
        .join('')
        .trim();
      if (!output) {
        errors.push({
          model,
          message: candidate?.finishReason
            ? `Gemini did not return text (finish reason: ${candidate.finishReason}).`
            : 'Gemini returned no text. Check your key, prompt content, and model availability.',
        });
        continue;
      }
      return output;
    } catch (err) {
      errors.push({
        model,
        message:
          (err as Error)?.name === 'AbortError'
            ? `Gemini API request timed out after ${Math.round(GEMINI_REQUEST_TIMEOUT_MS / 1000)} seconds.`
            : 'Network error calling Gemini API. Please check your connection and try again.',
      });
    } finally {
      clearTimeout(timeoutId);
    }
  }

  throw new Error(formatGeminiFailure(errors));
}
