import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { compress, estimateCostSaved, estimateTokens, LEVELS } from '../core';
import type { Level } from '../core';
import { aiCompress } from '../providers/gemini';

const AI_MODE_STORAGE_KEY = 'promptrim.aiMode';

const LEVEL_LABELS: Record<Level, string> = {
  light: 'Light',
  balanced: 'Balanced',
  aggressive: 'Aggressive',
};

interface Savings {
  pct: number;
  tokens: number;
  cost: number;
  changes: number;
  protectedRegions: number;
}

export function App() {
  const [input, setInput] = useState('');
  const [output, setOutput] = useState('');
  const [level, setLevel] = useState<Level>('balanced');
  const [aiMode, setAiMode] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [savings, setSavings] = useState<Savings | null>(null);
  const [copied, setCopied] = useState(false);
  const apiKeyRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      if (localStorage.getItem(AI_MODE_STORAGE_KEY) === 'true') setAiMode(true);
    } catch {
      // Storage can be unavailable (private mode); the default is fine.
    }
  }, []);

  const inTokens = useMemo(() => estimateTokens(input || ' '), [input]);
  const outTokens = useMemo(() => estimateTokens(output), [output]);

  const onToggleAi = useCallback((next: boolean) => {
    setAiMode(next);
    try {
      localStorage.setItem(AI_MODE_STORAGE_KEY, String(next));
    } catch {
      // Ignore storage failures; the toggle still works for this session.
    }
    if (next) queueMicrotask(() => apiKeyRef.current?.focus());
  }, []);

  const onInput = useCallback((value: string) => {
    setInput(value);
    setError('');
    setSavings(null);
  }, []);

  const onCompress = useCallback(async () => {
    const text = input.trim();
    if (!text) {
      setError('Paste a prompt first.');
      return;
    }
    if (aiMode && !apiKey) {
      setError('Enter your Gemini API key above, or uncheck "AI-powered" to use fast mode.');
      return;
    }

    setError('');
    setSavings(null);
    setOutput('');
    setBusy(true);

    try {
      let result: string;
      let changes = 0;
      let protectedRegions = 0;

      if (aiMode) {
        result = await aiCompress(text, level, apiKey);
      } else {
        const compressed = compress(text, level);
        result = compressed.output;
        changes = compressed.changes.length;
        protectedRegions = compressed.segments.filter((s) => s.kind === 'protected').length;
      }

      setOutput(result);

      const before = estimateTokens(text);
      const after = estimateTokens(result);
      if (after < before) {
        const saved = before - after;
        setSavings({
          pct: Math.round((saved / before) * 100),
          tokens: saved,
          cost: estimateCostSaved(saved),
          changes,
          protectedRegions,
        });
      } else {
        setError(
          'This prompt is already concise — minimal savings in Fast mode. Try AI mode or Aggressive level for more compression.',
        );
      }
    } catch (err) {
      setError(`Error: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }, [aiMode, apiKey, input, level]);

  const onCopy = useCallback(async () => {
    if (!output) return;
    try {
      await navigator.clipboard.writeText(output);
    } catch {
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [output]);

  const onClear = useCallback(() => {
    setInput('');
    setOutput('');
    setError('');
    setSavings(null);
  }, []);

  return (
    <>
      <div class="controls">
        <span style="font-size:0.85rem;color:var(--text-muted);font-weight:600;">Level:</span>
        <div class="level-group" role="group" aria-label="Compression level">
          {LEVELS.map((value) => (
            <button
              key={value}
              type="button"
              class={`level-btn${value === level ? ' active' : ''}`}
              aria-pressed={value === level}
              onClick={() => setLevel(value)}
            >
              {LEVEL_LABELS[value]}
            </button>
          ))}
        </div>

        <label class="api-toggle">
          <input
            type="checkbox"
            checked={aiMode}
            onChange={(e) => onToggleAi((e.currentTarget as HTMLInputElement).checked)}
          />
          AI-powered (Gemini API)
        </label>
      </div>

      <div class={`api-key-wrap${aiMode ? ' visible' : ''}`}>
        <input
          ref={apiKeyRef}
          type="password"
          placeholder="AIza..."
          autocomplete="off"
          aria-label="Gemini API key"
          value={apiKey}
          onInput={(e) => setApiKey((e.currentTarget as HTMLInputElement).value.trim())}
        />
        <span class="api-info">Used only in this session · Never sent to our servers</span>
      </div>
      <div class="api-help">
        <a
          class="hero-link"
          href="https://github.com/FabianIMV/promptrim#gemini-api-key-setup"
          target="_blank"
          rel="noopener noreferrer"
        >
          Help: Want to know how to use AI Mode?
        </a>
      </div>

      <div class={`savings${savings ? ' visible' : ''}`}>
        <div class="savings-title">Compression results</div>
        <div class="savings-row">
          <div class="saving-item">
            <div class="saving-num">{savings ? `${savings.pct}%` : '—'}</div>
            <div class="saving-label">tokens saved</div>
          </div>
          <div class="saving-item">
            <div class="saving-num">{savings ? savings.tokens.toLocaleString() : '—'}</div>
            <div class="saving-label">tokens removed</div>
          </div>
          <div class="saving-item">
            <div class="saving-num">{savings ? `$${savings.cost.toFixed(4)}` : '—'}</div>
            <div class="saving-label">est. cost saved (GPT-4o)</div>
          </div>
        </div>
        {savings && !aiMode && (
          <div class="savings-note">
            {savings.changes} rule change{savings.changes === 1 ? '' : 's'} ·{' '}
            {savings.protectedRegions} protected region
            {savings.protectedRegions === 1 ? '' : 's'} left untouched
          </div>
        )}
      </div>

      <div class="panels">
        <div class="panel">
          <div class="panel-header">
            <span class="panel-title">Original Prompt</span>
            <span class="token-badge">{inTokens.toLocaleString()} tokens</span>
          </div>
          <textarea
            aria-label="Original prompt"
            placeholder="Paste your AI prompt here — system prompts, user messages, context, instructions...&#10;&#10;Example: 'I would like you to please write me a comprehensive, detailed and extensive blog post about artificial intelligence. The post should be very thorough and cover all the important aspects...'"
            value={input}
            onInput={(e) => onInput((e.currentTarget as HTMLTextAreaElement).value)}
          />
        </div>

        <div class="panel">
          <div class="panel-header">
            <span class="panel-title">Compressed Prompt</span>
            <span class={`token-badge${output ? ' improved' : ''}`}>
              {output ? outTokens.toLocaleString() : 0} tokens
            </span>
          </div>
          <textarea
            aria-label="Compressed prompt"
            placeholder="Your compressed prompt will appear here..."
            readOnly
            value={output}
          />
        </div>
      </div>

      <div class="actions">
        <button class="btn btn-primary" type="button" disabled={busy} onClick={onCompress}>
          {busy ? (
            <>
              <span class="spinner" /> Compressing…
            </>
          ) : (
            <>
              <span>✂️</span> Compress Prompt
            </>
          )}
        </button>
        <button class="btn btn-ghost" type="button" onClick={onCopy}>
          📋 Copy Result
        </button>
        <button class="btn btn-ghost" type="button" onClick={onClear}>
          🗑️ Clear
        </button>
      </div>

      <div class={`error${error ? ' visible' : ''}`} role="alert">
        {error}
      </div>

      <div class={`copy-success${copied ? ' show' : ''}`}>✓ Copied to clipboard!</div>
    </>
  );
}
