import { formatUsd, MAX_CALLS, MIN_CALLS } from '../providers';
import type { AiCostEstimate, AiStep, ProviderClient, ProviderId } from '../providers';
import { getModel } from '../core';

interface Props {
  providers: readonly ProviderClient[];
  provider: ProviderClient;
  onProviderChange: (id: ProviderId) => void;
  compressModel: string;
  onCompressModelChange: (model: string) => void;
  verifyModel: string;
  onVerifyModelChange: (model: string) => void;
  apiKey: string;
  onApiKeyChange: (key: string) => void;
  remember: boolean;
  onRememberChange: (remember: boolean) => void;
  estimate: AiCostEstimate | null;
  steps: AiStep[] | null;
  keyInputRef: { current: HTMLInputElement | null };
}

const STEP_LABELS: Record<AiStep['name'], string> = {
  compress: 'Compress',
  verify: 'Verify',
  repair: 'Repair',
};

const STEP_MARKS: Record<AiStep['status'], string> = {
  pending: '○',
  running: '◐',
  done: '✓',
  skipped: '–',
  failed: '✗',
};

function modelLabel(id: string): string {
  return getModel(id)?.label ?? id;
}

export function AiPanel({
  providers,
  provider,
  onProviderChange,
  compressModel,
  onCompressModelChange,
  verifyModel,
  onVerifyModelChange,
  apiKey,
  onApiKeyChange,
  remember,
  onRememberChange,
  estimate,
  steps,
  keyInputRef,
}: Props) {
  return (
    <section class="ai-panel" aria-labelledby="ai-panel-heading">
      <h2 id="ai-panel-heading" class="ai-panel-title">
        AI mode — compress, verify, repair
      </h2>

      <div class="ai-row">
        <label class="cost-field">
          <span>Provider</span>
          <select
            aria-label="AI provider"
            value={provider.id}
            onChange={(e) =>
              onProviderChange((e.currentTarget as HTMLSelectElement).value as ProviderId)
            }
          >
            {providers.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label}
              </option>
            ))}
          </select>
        </label>

        <label class="cost-field">
          <span>Compression model</span>
          <select
            aria-label="Compression model"
            value={compressModel}
            onChange={(e) => onCompressModelChange((e.currentTarget as HTMLSelectElement).value)}
          >
            {provider.models.map((id) => (
              <option key={id} value={id}>
                {modelLabel(id)}
              </option>
            ))}
          </select>
        </label>

        <label class="cost-field">
          <span>Verifier model</span>
          <select
            aria-label="Verifier model"
            value={verifyModel}
            onChange={(e) => onVerifyModelChange((e.currentTarget as HTMLSelectElement).value)}
          >
            {provider.models.map((id) => (
              <option key={id} value={id}>
                {modelLabel(id)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div class="ai-row">
        <label class="cost-field ai-key-field">
          <span>{provider.keyLabel}</span>
          <input
            ref={(node) => {
              keyInputRef.current = node as HTMLInputElement | null;
            }}
            type="password"
            autocomplete="off"
            spellcheck={false}
            placeholder={provider.keyPlaceholder}
            aria-label={provider.keyLabel}
            value={apiKey}
            onInput={(e) => onApiKeyChange((e.currentTarget as HTMLInputElement).value.trim())}
          />
        </label>
        <label class="ai-remember">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => onRememberChange((e.currentTarget as HTMLInputElement).checked)}
          />
          Remember in this browser
        </label>
        <span class="api-info">
          {remember
            ? 'Stored in sessionStorage — cleared when you close this tab.'
            : 'Kept in memory only · never stored, never sent anywhere but the provider.'}{' '}
          <a href={provider.keyHelpUrl} target="_blank" rel="noopener noreferrer">
            Get a key
          </a>
        </span>
      </div>

      <p class="ai-estimate">
        {estimate ? (
          <>
            <strong>This compression costs about {formatUsd(estimate.minUsd)}</strong> — {MIN_CALLS}{' '}
            calls ({estimate.compressModel.label} + {estimate.verifyModel.label}),{' '}
            {estimate.inputTokens.toLocaleString()} in / ~{estimate.outputTokens.toLocaleString()}{' '}
            out{estimate.exact ? '' : ' (estimated)'}. Up to {formatUsd(estimate.maxUsd)} if all{' '}
            {MAX_CALLS} calls run (2 repairs + re-verification).
          </>
        ) : (
          'Paste a prompt to see what the compression call itself would cost.'
        )}
      </p>

      {steps && (
        <ol class="ai-steps" aria-label="Pipeline progress">
          {steps.map((step) => (
            <li key={step.name} class={`ai-step ${step.status}`}>
              <span class="ai-step-mark" aria-hidden="true">
                {STEP_MARKS[step.status]}
              </span>
              <span class="ai-step-name">{STEP_LABELS[step.name]}</span>
              <span class="ai-step-detail">
                <span class="sr-only">{step.status}: </span>
                {step.detail}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
