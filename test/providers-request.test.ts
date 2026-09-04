/**
 * These tests pin the wire format of the three providers.
 *
 * Every expectation below corresponds to something that was read on the
 * official documentation on 2026-09-03 (the URLs are in each provider file).
 * They are deliberately literal: a rename here is a silent 400 in someone's
 * browser, and there is no integration test that would catch it — the app has
 * no server and the tests have no API keys.
 */
import { describe, expect, it } from 'vitest';
import {
  anthropicErrorDetail,
  anthropicHeaders,
  ANTHROPIC_MODELS,
  buildAnthropicBody,
  supportsEffort,
} from '../src/providers/anthropic';
import {
  buildOpenAiBody,
  openAiErrorDetail,
  openAiHeaders,
  OPENAI_MODELS,
} from '../src/providers/openai';
import { buildGeminiBody, geminiErrorDetail, GEMINI_MODELS } from '../src/providers/gemini';
import { COMPRESS_SCHEMA, toGeminiSchema, VERIFY_SCHEMA } from '../src/providers/schemas';
import { parseRetryAfter, ProviderError, shortDetail, statusMessage } from '../src/providers/types';
import type { StructuredRequest } from '../src/providers/types';
import { PROVIDERS } from '../src/providers';
import { getModel } from '../src/core';

const REQUEST: StructuredRequest = {
  system: 'system prompt',
  user: 'user prompt',
  schemaName: 'promptrim_compression',
  schema: COMPRESS_SCHEMA,
  maxOutputTokens: 4096,
};

describe('Anthropic request shape', () => {
  it('sends the documented headers, including direct browser access', () => {
    const headers = anthropicHeaders('sk-ant-secret');
    expect(headers['anthropic-version']).toBe('2023-06-01');
    expect(headers['anthropic-dangerous-direct-browser-access']).toBe('true');
    expect(headers['x-api-key']).toBe('sk-ant-secret');
    expect(headers['content-type']).toBe('application/json');
    // Anthropic authenticates with x-api-key, never with a bearer token.
    expect(headers.authorization).toBeUndefined();
  });

  it('puts structured output under output_config.format, not output_format', () => {
    const body = buildAnthropicBody(REQUEST, 'claude-opus-5') as {
      output_config: { format: { type: string; schema: unknown } };
      output_format?: unknown;
    };
    expect(body.output_config.format.type).toBe('json_schema');
    expect(body.output_config.format.schema).toBe(COMPRESS_SCHEMA);
    expect(body.output_format).toBeUndefined();
  });

  it('uses max_tokens and a top-level system field', () => {
    const body = buildAnthropicBody(REQUEST, 'claude-opus-5') as Record<string, unknown>;
    expect(body.max_tokens).toBe(4096);
    expect(body.system).toBe('system prompt');
    expect(body.messages).toEqual([{ role: 'user', content: 'user prompt' }]);
  });

  it('never sends a thinking budget or a sampling parameter (400 on current models)', () => {
    const body = buildAnthropicBody(REQUEST, 'claude-opus-5') as Record<string, unknown>;
    expect(body.thinking).toBeUndefined();
    expect(body.temperature).toBeUndefined();
    expect(body.top_p).toBeUndefined();
  });

  it('sends effort only to the models that accept it', () => {
    expect(supportsEffort('claude-opus-5')).toBe(true);
    expect(supportsEffort('claude-sonnet-5')).toBe(true);
    // The models table lists "Default effort: Not supported" for Haiku 4.5.
    expect(supportsEffort('claude-haiku-4-5')).toBe(false);

    const opus = buildAnthropicBody(REQUEST, 'claude-opus-5') as {
      output_config: { effort?: string };
    };
    const haiku = buildAnthropicBody(REQUEST, 'claude-haiku-4-5') as {
      output_config: { effort?: string };
    };
    expect(opus.output_config.effort).toBe('medium');
    expect(haiku.output_config.effort).toBeUndefined();
  });

  it('reads the documented error body', () => {
    expect(
      anthropicErrorDetail({ type: 'error', error: { type: 'not_found_error', message: 'nope' } }),
    ).toBe('nope');
    expect(anthropicErrorDetail({})).toBeNull();
  });
});

describe('OpenAI request shape', () => {
  it('authenticates with a bearer token', () => {
    const headers = openAiHeaders('sk-secret');
    expect(headers.authorization).toBe('Bearer sk-secret');
  });

  it('uses max_completion_tokens, never the rejected max_tokens', () => {
    const body = buildOpenAiBody(REQUEST, 'gpt-5.6-sol') as Record<string, unknown>;
    expect(body.max_completion_tokens).toBe(4096);
    expect(body.max_tokens).toBeUndefined();
  });

  it('omits the sampling parameters the GPT-5.x family rejects', () => {
    const body = buildOpenAiBody(REQUEST, 'gpt-5.6-sol') as Record<string, unknown>;
    for (const key of ['temperature', 'top_p', 'presence_penalty', 'frequency_penalty']) {
      expect(body[key]).toBeUndefined();
    }
  });

  it('sends a strict json_schema response_format with a name', () => {
    const body = buildOpenAiBody(REQUEST, 'gpt-5.6-sol') as {
      response_format: {
        type: string;
        json_schema: { name: string; strict: boolean; schema: unknown };
      };
    };
    expect(body.response_format.type).toBe('json_schema');
    expect(body.response_format.json_schema.name).toBe('promptrim_compression');
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(body.response_format.json_schema.schema).toBe(COMPRESS_SCHEMA);
  });

  it('carries the system prompt as a system message', () => {
    const body = buildOpenAiBody(REQUEST, 'gpt-5.6-sol') as {
      messages: { role: string; content: string }[];
    };
    expect(body.messages[0]).toEqual({ role: 'system', content: 'system prompt' });
    expect(body.messages[1]).toEqual({ role: 'user', content: 'user prompt' });
  });

  it('reads the documented error body', () => {
    expect(openAiErrorDetail({ error: { message: 'Incorrect API key provided' } })).toBe(
      'Incorrect API key provided',
    );
  });
});

describe('Gemini request shape', () => {
  it('uses systemInstruction, responseMimeType and responseSchema', () => {
    const body = buildGeminiBody(REQUEST) as {
      systemInstruction: { parts: { text: string }[] };
      generationConfig: { responseMimeType: string; responseSchema: Record<string, unknown> };
    };
    expect(body.systemInstruction.parts[0]!.text).toBe('system prompt');
    expect(body.generationConfig.responseMimeType).toBe('application/json');
    expect(body.generationConfig.responseSchema.type).toBe('object');
  });

  it('strips additionalProperties, which the OpenAPI subset does not need', () => {
    const schema = toGeminiSchema(VERIFY_SCHEMA);
    expect(JSON.stringify(schema)).not.toContain('additionalProperties');
    // …and keeps everything the schema actually constrains.
    expect(JSON.stringify(schema)).toContain('preserved');
    expect(JSON.stringify(schema)).toContain('required');
  });

  it('reads the documented error body', () => {
    expect(geminiErrorDetail({ error: { code: 429, message: 'Quota exceeded' } })).toBe(
      'Quota exceeded',
    );
  });
});

describe('schemas satisfy the strictest provider (OpenAI strict mode)', () => {
  const schemas = { COMPRESS_SCHEMA, VERIFY_SCHEMA };

  for (const [name, schema] of Object.entries(schemas)) {
    it(`${name}: every object lists all properties as required and forbids extras`, () => {
      walk(schema, (node) => {
        if (node.type !== 'object') return;
        expect(node.additionalProperties).toBe(false);
        expect([...(node.required as string[])].sort()).toEqual(
          Object.keys(node.properties as object).sort(),
        );
      });
    });

    it(`${name}: uses no keyword outside the common subset`, () => {
      const forbidden = ['minLength', 'maxLength', 'minimum', 'maximum', 'pattern', 'multipleOf'];
      const json = JSON.stringify(schema);
      for (const keyword of forbidden) expect(json).not.toContain(keyword);
    });
  }
});

describe('error wording', () => {
  it('maps the statuses that matter to a user', () => {
    expect(statusMessage('Anthropic', 401, null, null)).toContain('Invalid Anthropic API key');
    expect(statusMessage('OpenAI', 429, null, 12)).toContain('Retry in 12s');
    expect(statusMessage('OpenAI', 429, null, null)).toContain('rate limit');
    expect(statusMessage('Gemini', 503, null, null)).toContain('overloaded');
    expect(statusMessage('Gemini', 418, null, null)).toContain('418');
  });

  it('reads retry-after as seconds or as a date', () => {
    expect(parseRetryAfter(new Headers({ 'retry-after': '30' }))).toBe(30);
    expect(parseRetryAfter(new Headers())).toBeNull();
    const soon = new Date(Date.now() + 20_000).toUTCString();
    expect(parseRetryAfter(new Headers({ 'retry-after': soon }))).toBeGreaterThan(0);
  });

  it('truncates a long provider message before it reaches the DOM', () => {
    const long = 'x'.repeat(500);
    expect(shortDetail(long)!.length).toBeLessThanOrEqual(200);
    expect(shortDetail('  spaced   out  ')).toBe('spaced out');
    expect(shortDetail(undefined)).toBeNull();
  });

  it('never carries an API key', () => {
    // The key is only ever a header value; nothing builds a message from it.
    const error = new ProviderError('openai', statusMessage('OpenAI', 401, null, null));
    expect(error.message).not.toContain('sk-');
    expect(JSON.stringify({ ...error, message: error.message })).not.toContain('sk-');
  });
});

describe('provider registry', () => {
  it('offers only models that data/pricing.json can price', () => {
    for (const provider of PROVIDERS) {
      for (const id of provider.models) {
        const model = getModel(id);
        expect(model, `${id} is missing from data/pricing.json`).toBeDefined();
        expect(model!.provider).toBe(provider.id);
      }
      expect(provider.models).toContain(provider.defaultModel);
      expect(provider.models).toContain(provider.defaultVerifierModel);
    }
  });

  it('defaults Anthropic to claude-opus-5, as docs/PLAN.md Phase 5 asks', () => {
    const anthropic = PROVIDERS.find((p) => p.id === 'anthropic')!;
    expect(anthropic.defaultModel).toBe('claude-opus-5');
    expect([...ANTHROPIC_MODELS]).toEqual(['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5']);
  });

  it('verifies with a cheaper model than it compresses with', () => {
    for (const provider of PROVIDERS) {
      const compress = getModel(provider.defaultModel)!;
      const verify = getModel(provider.defaultVerifierModel)!;
      expect(verify.input_per_mtok).toBeLessThanOrEqual(compress.input_per_mtok);
    }
  });

  it('lists the model ids read from each provider on 2026-09-03', () => {
    expect([...OPENAI_MODELS]).toEqual(['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna']);
    expect(GEMINI_MODELS[0]).toBe('gemini-3.8-flash');
  });
});

type SchemaNode = Record<string, unknown> & { type?: string };

function walk(node: unknown, visit: (node: SchemaNode) => void): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const entry of node) walk(entry, visit);
    return;
  }
  visit(node as SchemaNode);
  for (const value of Object.values(node)) walk(value, visit);
}
