/**
 * Phase 5 — the shared provider surface.
 *
 * Every provider does exactly one thing for us: take a system prompt, a user
 * prompt and a JSON Schema, and come back with parsed JSON that matches the
 * schema. The compression pipeline (`pipeline.ts`) never talks HTTP; it talks
 * to this interface, which is what makes the two-step compress → verify →
 * repair flow provider-agnostic.
 *
 * All three implementations are plain `fetch` against the official REST
 * endpoints — no vendor SDK. The app is a static page with no backend and the
 * user's own key, so bundling three SDKs to send three JSON bodies would cost
 * bundle size for nothing. See docs/PLAN.md §6.6 for the decision.
 */

/** A JSON Schema object, in the subset all three providers accept. */
export interface JsonSchema {
  type: 'object';
  properties: Record<string, JsonSchemaNode>;
  required: string[];
  additionalProperties: false;
}

export type JsonSchemaNode =
  | { type: 'string'; description?: string }
  | { type: 'boolean'; description?: string }
  | { type: 'array'; description?: string; items: JsonSchemaNode }
  | JsonSchema;

export type ProviderId = 'anthropic' | 'openai' | 'gemini';

export interface StructuredRequest {
  system: string;
  user: string;
  /** Schema name. Required by OpenAI, ignored by the other two. */
  schemaName: string;
  schema: JsonSchema;
  maxOutputTokens: number;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface StructuredResponse {
  data: unknown;
  /** Reported by the provider when available; `null` when it is not. */
  usage: TokenUsage | null;
  /** The model that actually answered. */
  model: string;
}

export interface CallOptions {
  apiKey: string;
  model: string;
  signal?: AbortSignal;
}

export interface ProviderClient {
  id: ProviderId;
  label: string;
  /** Models offered in AI mode, most capable first. Every id must exist in `data/pricing.json`. */
  models: readonly string[];
  /** Step A (compression) default. */
  defaultModel: string;
  /** Step B (independent verification) default — deliberately a cheaper model. */
  defaultVerifierModel: string;
  keyLabel: string;
  keyPlaceholder: string;
  keyHelpUrl: string;
  complete(request: StructuredRequest, options: CallOptions): Promise<StructuredResponse>;
}

/**
 * A provider failure with a message meant for the UI.
 *
 * The API key is never part of `message`, `provider` or any other field: this
 * type is the only thing the pipeline surfaces, so keeping it key-free is what
 * keeps keys out of the DOM and out of `console.error`.
 */
export class ProviderError extends Error {
  readonly provider: ProviderId;
  readonly status: number | null;
  /** Seconds to wait, from the provider's `retry-after` header, when it sent one. */
  readonly retryAfterSeconds: number | null;

  constructor(
    provider: ProviderId,
    message: string,
    options: { status?: number | null; retryAfterSeconds?: number | null } = {},
  ) {
    super(message);
    this.name = 'ProviderError';
    this.provider = provider;
    this.status = options.status ?? null;
    this.retryAfterSeconds = options.retryAfterSeconds ?? null;
  }
}

/** Shared wording for the failures every provider can produce. */
export function statusMessage(
  provider: string,
  status: number,
  detail: string | null,
  retryAfterSeconds: number | null,
): string {
  const suffix = detail ? ` ${detail}` : '';
  switch (status) {
    case 400:
      return `${provider} rejected the request (400).${suffix}`;
    case 401:
      return `Invalid ${provider} API key.${suffix}`;
    case 403:
      return `${provider} denied access for this key.${suffix}`;
    case 404:
      return `${provider} model not found. Pick another model.${suffix}`;
    case 413:
      return `The prompt is too large for ${provider}. Compress a shorter prompt.${suffix}`;
    case 429:
      return retryAfterSeconds !== null
        ? `${provider} rate limit reached. Retry in ${retryAfterSeconds}s.${suffix}`
        : `${provider} rate limit or quota reached. Try again in a moment.${suffix}`;
    case 500:
    case 502:
      return `${provider} service error. Please retry shortly.${suffix}`;
    case 503:
    case 529:
      return `${provider} is temporarily overloaded. Please retry shortly.${suffix}`;
    default:
      return `${provider} API error ${status}.${suffix}`;
  }
}

/** `retry-after` is seconds or an HTTP date; we only surface the seconds form. */
export function parseRetryAfter(headers: Headers): number | null {
  const raw = headers.get('retry-after');
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
  const date = Date.parse(raw);
  if (Number.isNaN(date)) return null;
  return Math.max(0, Math.ceil((date - Date.now()) / 1000));
}

/**
 * Turn whatever the provider put in the body into one short sentence.
 * Long provider messages are truncated: they land in the DOM.
 */
export function shortDetail(message: unknown, max = 200): string | null {
  if (typeof message !== 'string') return null;
  const flat = message.replace(/\s+/g, ' ').trim();
  if (!flat) return null;
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

/** Network-level failures, told apart from HTTP errors so the message is useful. */
export function networkError(provider: ProviderId, label: string, err: unknown): ProviderError {
  if ((err as Error)?.name === 'AbortError') {
    return new ProviderError(provider, `${label} request cancelled.`);
  }
  return new ProviderError(
    provider,
    `Network error calling ${label}. Check your connection and try again.`,
  );
}

/** The providers return JSON as text; a model can still emit something unparseable. */
export function parseJsonPayload(provider: ProviderId, label: string, text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new ProviderError(provider, `${label} returned an empty response.`);
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    throw new ProviderError(provider, `${label} returned a response that is not valid JSON.`);
  }
}
