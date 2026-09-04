import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  allModels,
  buildLedger,
  changeKey,
  compress,
  costForTokens,
  countTokensForModel,
  extractConstraints,
  getModel,
  LEVELS,
  projectDiff,
  projectedMonthlyCost,
  restoreConstraint,
} from '../core';
import type {
  BlockedChange,
  Change,
  Constraint,
  Ledger,
  Level,
  ModelPricing,
  TokenCountResult,
} from '../core';
import {
  DEFAULT_PROVIDER_ID,
  estimateAiCost,
  formatUsd,
  getProvider,
  loadKeys,
  PROVIDERS,
  runAiPipeline,
  saveKey,
  setRemembering,
  isRemembering,
} from '../providers';
import type { AiCostEstimate, AiStep, AiVerdict, ProviderId } from '../providers';
import { AiPanel } from './AiPanel';
import { DiffView } from './DiffView';
import { LedgerPanel } from './LedgerPanel';
import { RulesPanel } from './RulesPanel';

const AI_MODE_STORAGE_KEY = 'promptrim.aiMode';
const DISABLED_RULES_STORAGE_KEY = 'promptrim.disabledRules';
const DEFAULT_MODEL_ID = 'claude-sonnet-5';
const DEFAULT_CALLS_PER_DAY = 1000;
/** Long enough that typing does not trigger a tokenizer run per keystroke. */
const ESTIMATE_DEBOUNCE_MS = 400;

const LEVEL_LABELS: Record<Level, string> = {
  light: 'Light',
  balanced: 'Balanced',
  aggressive: 'Aggressive',
};

const PROVIDER_LABELS: Record<ModelPricing['provider'], string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  gemini: 'Google Gemini',
};

const MODELS_BY_PROVIDER = allModels().reduce<Record<string, ModelPricing[]>>((acc, model) => {
  (acc[model.provider] ??= []).push(model);
  return acc;
}, {});

const NO_TOKENS: TokenCountResult = { tokens: 0, exact: false };

interface Savings {
  pct: number;
  tokens: number;
  costPerCall: number;
  monthlyCost: number;
}

/** What the last run produced, so that "Restore" and the diff view can recompute against it. */
interface Run {
  source: string;
  changes: Change[];
  protectedRegions: number;
  constraints: Constraint[] | null;
}

/** What the AI pipeline reported about its own run. */
interface AiOutcome {
  verdicts: Record<string, AiVerdict>;
  repairs: number;
  calls: number;
  spentUsd: number | null;
}

export function App() {
  const [input, setInput] = useState('');
  const [output, setOutput] = useState('');
  const [level, setLevel] = useState<Level>('balanced');
  const [aiMode, setAiMode] = useState(false);
  const [providerId, setProviderId] = useState<ProviderId>(DEFAULT_PROVIDER_ID);
  const [apiKeys, setApiKeys] = useState<Partial<Record<ProviderId, string>>>({});
  const [remember, setRemember] = useState(false);
  const [compressModel, setCompressModel] = useState(
    getProvider(DEFAULT_PROVIDER_ID)!.defaultModel,
  );
  const [verifyModel, setVerifyModel] = useState(
    getProvider(DEFAULT_PROVIDER_ID)!.defaultVerifierModel,
  );
  const [aiSteps, setAiSteps] = useState<AiStep[] | null>(null);
  const [aiEstimate, setAiEstimate] = useState<AiCostEstimate | null>(null);
  const [aiOutcome, setAiOutcome] = useState<AiOutcome | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [savings, setSavings] = useState<Savings | null>(null);
  const [copied, setCopied] = useState(false);
  const [targetModelId, setTargetModelId] = useState(DEFAULT_MODEL_ID);
  const [callsPerDay, setCallsPerDay] = useState(DEFAULT_CALLS_PER_DAY);
  const [inTokenResult, setInTokenResult] = useState<TokenCountResult>(NO_TOKENS);
  const [outTokenResult, setOutTokenResult] = useState<TokenCountResult>(NO_TOKENS);
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [blocked, setBlocked] = useState<BlockedChange[]>([]);
  const [run, setRun] = useState<Run | null>(null);
  const [disabledChangeKeys, setDisabledChangeKeys] = useState<Set<string>>(new Set());
  const [disabledRuleIds, setDisabledRuleIds] = useState<Set<string>>(new Set());
  const apiKeyRef = useRef<HTMLInputElement | null>(null);

  const provider = getProvider(providerId) ?? PROVIDERS[0]!;
  const apiKey = apiKeys[providerId] ?? '';
  const targetModel = useMemo(() => getModel(targetModelId) ?? allModels()[0]!, [targetModelId]);
  /**
   * Token counting can use the user's key, but only the one belonging to the
   * target model's own provider — never a key for a different vendor.
   */
  const countingKey = apiKeys[targetModel.provider as ProviderId] || undefined;

  useEffect(() => {
    try {
      if (localStorage.getItem(AI_MODE_STORAGE_KEY) === 'true') setAiMode(true);
      const stored = localStorage.getItem(DISABLED_RULES_STORAGE_KEY);
      if (stored) setDisabledRuleIds(new Set(JSON.parse(stored) as string[]));
    } catch {
      // Storage can be unavailable (private mode), or hold something that is
      // not valid JSON; the default (nothing disabled) is fine either way.
    }
    // Keys are only ever restored when the user opted in during this session.
    if (isRemembering()) {
      setRemember(true);
      setApiKeys(loadKeys());
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    countTokensForModel(input, targetModel, countingKey).then((result) => {
      if (!cancelled) setInTokenResult(result);
    });
    return () => {
      cancelled = true;
    };
  }, [input, targetModel, countingKey]);

  useEffect(() => {
    let cancelled = false;
    countTokensForModel(output, targetModel, countingKey).then((result) => {
      if (!cancelled) setOutTokenResult(result);
    });
    return () => {
      cancelled = true;
    };
  }, [output, targetModel, countingKey]);

  /** What the pipeline itself would cost, shown before the user runs it. */
  useEffect(() => {
    if (!aiMode || !input.trim()) {
      setAiEstimate(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      estimateAiCost({
        text: input,
        constraints: extractConstraints(input),
        level,
        provider: provider.id,
        compressModelId: compressModel,
        verifyModelId: verifyModel,
        apiKey: apiKey || undefined,
      })
        .then((estimate) => {
          if (!cancelled) setAiEstimate(estimate);
        })
        .catch(() => {
          if (!cancelled) setAiEstimate(null);
        });
    }, ESTIMATE_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [aiMode, input, level, provider, compressModel, verifyModel, apiKey]);

  const onToggleAi = useCallback((next: boolean) => {
    setAiMode(next);
    try {
      localStorage.setItem(AI_MODE_STORAGE_KEY, String(next));
    } catch {
      // Ignore storage failures; the toggle still works for this session.
    }
    if (next) queueMicrotask(() => apiKeyRef.current?.focus());
  }, []);

  const onProviderChange = useCallback((id: ProviderId) => {
    const next = getProvider(id);
    if (!next) return;
    setProviderId(id);
    setCompressModel(next.defaultModel);
    setVerifyModel(next.defaultVerifierModel);
    setAiSteps(null);
  }, []);

  const onApiKeyChange = useCallback(
    (key: string) => {
      setApiKeys((prev) => ({ ...prev, [providerId]: key }));
      saveKey(providerId, key);
    },
    [providerId],
  );

  const onRememberChange = useCallback(
    (next: boolean) => {
      setRemember(next);
      setRemembering(next, apiKeys);
    },
    [apiKeys],
  );

  const onInput = useCallback((value: string) => {
    setInput(value);
    setError('');
    setSavings(null);
    setLedger(null);
    setBlocked([]);
    setRun(null);
    setAiSteps(null);
    setAiOutcome(null);
    setDisabledChangeKeys(new Set());
  }, []);

  /** Token savings of `result` against `source`, recomputed after a restore. */
  const refreshSavings = useCallback(
    async (source: string, result: string) => {
      const [before, after] = await Promise.all([
        countTokensForModel(source, targetModel, countingKey),
        countTokensForModel(result, targetModel, countingKey),
      ]);
      if (after.tokens >= before.tokens || before.tokens === 0) {
        setSavings(null);
        return false;
      }
      const saved = before.tokens - after.tokens;
      setSavings({
        pct: Math.round((saved / before.tokens) * 100),
        tokens: saved,
        costPerCall: costForTokens(saved, targetModel.input_per_mtok),
        monthlyCost: projectedMonthlyCost(saved, targetModel.input_per_mtok, callsPerDay),
      });
      return true;
    },
    [targetModel, countingKey, callsPerDay],
  );

  const onRestore = useCallback(
    (constraint: Constraint) => {
      if (!run) return;
      const restored = restoreConstraint(run.source, output, constraint);
      setOutput(restored);
      setLedger(
        buildLedger(run.source, restored, run.constraints ? { constraints: run.constraints } : {}),
      );
      void refreshSavings(run.source, restored);
    },
    [output, run, refreshSavings],
  );

  /** Recompute output, ledger and savings for a new set of undone change keys. */
  const applyDisabledChanges = useCallback(
    (next: Set<string>) => {
      if (!run) return;
      setDisabledChangeKeys(next);
      const result = projectDiff(run.source, run.changes, next);
      setOutput(result);
      setLedger(
        buildLedger(run.source, result, run.constraints ? { constraints: run.constraints } : {}),
      );
      void refreshSavings(run.source, result);
    },
    [run, refreshSavings],
  );

  const onToggleChange = useCallback(
    (key: string) => {
      const next = new Set(disabledChangeKeys);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      applyDisabledChanges(next);
    },
    [disabledChangeKeys, applyDisabledChanges],
  );

  const onToggleRule = useCallback(
    (ruleId: string, nextActive: boolean) => {
      if (!run) return;
      const next = new Set(disabledChangeKeys);
      for (const change of run.changes) {
        if (change.ruleId !== ruleId) continue;
        const key = changeKey(change);
        if (nextActive) next.delete(key);
        else next.add(key);
      }
      applyDisabledChanges(next);
    },
    [run, disabledChangeKeys, applyDisabledChanges],
  );

  const onToggleRuleEnabled = useCallback((ruleId: string) => {
    setDisabledRuleIds((prev) => {
      const next = new Set(prev);
      if (next.has(ruleId)) next.delete(ruleId);
      else next.add(ruleId);
      try {
        localStorage.setItem(DISABLED_RULES_STORAGE_KEY, JSON.stringify([...next]));
      } catch {
        // Ignore storage failures; the toggle still works for this session.
      }
      return next;
    });
  }, []);

  const onCompress = useCallback(async () => {
    const text = input.trim();
    if (!text) {
      setError('Paste a prompt first.');
      return;
    }
    if (aiMode && !apiKey) {
      setError(
        `Enter your ${provider.keyLabel} above, or uncheck "AI mode" to compress locally with Fast mode.`,
      );
      return;
    }

    setError('');
    setSavings(null);
    setOutput('');
    setLedger(null);
    setBlocked([]);
    setAiOutcome(null);
    setDisabledChangeKeys(new Set());
    setBusy(true);

    try {
      let result: string;
      let nextRun: Run = { source: text, changes: [], protectedRegions: 0, constraints: null };
      let nextLedger: Ledger;

      if (aiMode) {
        const aiRun = await runAiPipeline(text, {
          provider,
          apiKey,
          level,
          compressModel,
          verifyModel,
          onProgress: setAiSteps,
        });
        result = aiRun.output;
        nextRun = { ...nextRun, constraints: aiRun.constraints };
        nextLedger = {
          constraints: aiRun.constraints,
          report: aiRun.report,
          duplicates: aiRun.duplicates,
        };
        setAiOutcome({
          verdicts: aiRun.verdicts,
          repairs: aiRun.repairs,
          calls: aiRun.calls,
          spentUsd: spentUsd(aiRun.usage, compressModel),
        });
      } else {
        setAiSteps(null);
        const compressed = compress(text, level, { disabledRuleIds: [...disabledRuleIds] });
        result = compressed.output;
        nextRun = {
          source: text,
          changes: compressed.changes,
          protectedRegions: compressed.segments.filter((s) => s.kind === 'protected').length,
          constraints: compressed.constraints,
        };
        setBlocked(compressed.blocked);
        nextLedger = buildLedger(
          text,
          result,
          compressed.constraints ? { constraints: compressed.constraints } : {},
        );
      }

      setOutput(result);
      setRun(nextRun);
      setLedger(nextLedger);

      const saved = await refreshSavings(text, result);
      if (!saved) {
        setError(
          aiMode
            ? 'The model could not make this prompt shorter without losing constraints.'
            : 'This prompt is already concise — minimal savings in Fast mode. Try AI mode or Aggressive level for more compression.',
        );
      }
    } catch (err) {
      setError(`Error: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }, [
    aiMode,
    apiKey,
    provider,
    compressModel,
    verifyModel,
    input,
    level,
    refreshSavings,
    disabledRuleIds,
  ]);

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
    setLedger(null);
    setBlocked([]);
    setRun(null);
    setAiSteps(null);
    setAiOutcome(null);
    setDisabledChangeKeys(new Set());
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
          AI mode (Anthropic · OpenAI · Gemini)
        </label>

        <RulesPanel disabledRuleIds={disabledRuleIds} onToggle={onToggleRuleEnabled} />
      </div>

      <div class="cost-row">
        <label class="cost-field">
          <span>Target model</span>
          <select
            aria-label="Target model for token counting and cost"
            value={targetModelId}
            onChange={(e) => setTargetModelId((e.currentTarget as HTMLSelectElement).value)}
          >
            {(Object.keys(MODELS_BY_PROVIDER) as ModelPricing['provider'][]).map((entry) => (
              <optgroup key={entry} label={PROVIDER_LABELS[entry]}>
                {MODELS_BY_PROVIDER[entry]!.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <label class="cost-field">
          <span>Calls / day</span>
          <input
            type="number"
            min="1"
            step="1"
            aria-label="Calls per day"
            value={callsPerDay}
            onInput={(e) => {
              const value = Number((e.currentTarget as HTMLInputElement).value);
              setCallsPerDay(Number.isFinite(value) && value > 0 ? value : 1);
            }}
          />
        </label>
        <span class="cost-hint">
          Prices verified {targetModel.last_verified} ·{' '}
          <a href={targetModel.source_url} target="_blank" rel="noopener noreferrer">
            source
          </a>
        </span>
      </div>

      {aiMode && (
        <AiPanel
          providers={PROVIDERS}
          provider={provider}
          onProviderChange={onProviderChange}
          compressModel={compressModel}
          onCompressModelChange={setCompressModel}
          verifyModel={verifyModel}
          onVerifyModelChange={setVerifyModel}
          apiKey={apiKey}
          onApiKeyChange={onApiKeyChange}
          remember={remember}
          onRememberChange={onRememberChange}
          estimate={aiEstimate}
          steps={aiSteps}
          keyInputRef={apiKeyRef}
        />
      )}

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
            <div class="saving-num">{savings ? `$${savings.costPerCall.toFixed(5)}` : '—'}</div>
            <div class="saving-label">saved per call ({targetModel.label})</div>
          </div>
          <div class="saving-item">
            <div class="saving-num">{savings ? `$${savings.monthlyCost.toFixed(2)}` : '—'}</div>
            <div class="saving-label">saved / month @ {callsPerDay.toLocaleString()}/day</div>
          </div>
        </div>
        {savings && !aiMode && run && (
          <div class="savings-note">
            {run.changes.length} rule change{run.changes.length === 1 ? '' : 's'} ·{' '}
            {run.protectedRegions} protected region
            {run.protectedRegions === 1 ? '' : 's'} left untouched
          </div>
        )}
        {savings && aiMode && aiOutcome && (
          <div class="savings-note">
            {aiOutcome.calls} API call{aiOutcome.calls === 1 ? '' : 's'} · {aiOutcome.repairs}{' '}
            repair{aiOutcome.repairs === 1 ? '' : 's'}
            {aiOutcome.spentUsd !== null ? ` · this run cost ${formatUsd(aiOutcome.spentUsd)}` : ''}
          </div>
        )}
      </div>

      {ledger && (
        <LedgerPanel
          ledger={ledger}
          blocked={blocked}
          onRestore={onRestore}
          verdicts={aiOutcome?.verdicts}
        />
      )}

      {run && !aiMode && (
        <DiffView
          original={run.source}
          changes={run.changes}
          blocked={blocked}
          disabled={disabledChangeKeys}
          onToggleChange={onToggleChange}
          onToggleRule={onToggleRule}
        />
      )}

      <div class="panels">
        <div class="panel">
          <div class="panel-header">
            <span class="panel-title">Original Prompt</span>
            <span class="token-badge">
              {inTokenResult.tokens.toLocaleString()} tokens
              {inTokenResult.exact ? '' : ' (est.)'}
            </span>
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
              {output ? outTokenResult.tokens.toLocaleString() : 0} tokens
              {output && !outTokenResult.exact ? ' (est.)' : ''}
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

/**
 * What the run actually cost, from the token usage the providers reported.
 * The verifier runs on a different model, but its share is a rounding error
 * next to the compression call, so the compression model's rate is used for
 * the whole run rather than pretending to a precision we do not have.
 */
function spentUsd(
  usage: { inputTokens: number; outputTokens: number },
  compressModelId: string,
): number | null {
  const model = getModel(compressModelId);
  if (!model || (usage.inputTokens === 0 && usage.outputTokens === 0)) return null;
  return (
    costForTokens(usage.inputTokens, model.input_per_mtok) +
    costForTokens(usage.outputTokens, model.output_per_mtok)
  );
}
