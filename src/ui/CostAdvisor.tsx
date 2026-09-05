import type {
  CacheReadyResult,
  CostAdvice,
  DynamicMarker,
  PromptSplit,
  Recommendation,
  Scenario,
} from '@promptrim/core';
import { usd } from '@promptrim/core';

interface Props {
  advice: CostAdvice;
  recommendation: Recommendation;
  split: PromptSplit;
  /** Non-null once the user asks for the reordered version. */
  cacheReady: CacheReadyResult | null;
  onGenerate: () => void;
  onCopyCacheReady: () => void;
}

const MARKER_LABELS: Record<DynamicMarker['kind'], string> = {
  section: 'Per-request section',
  variable: 'Template variable',
  date: 'Date / timestamp',
  identifier: 'Per-request id',
};

function tokens(count: number): string {
  return Math.round(count).toLocaleString('en-US');
}

/** "1 write", "24 writes", "0.04 writes" — a per-day rate that can be fractional. */
function rate(value: number, noun: string): string {
  const rounded =
    value >= 10
      ? Math.round(value).toLocaleString('en-US')
      : Number.isInteger(value)
        ? String(value)
        : value.toFixed(value < 1 ? 2 : 1);
  return `${rounded} ${noun}${value === 1 ? '' : 's'}`;
}

function savingLabel(scenario: Scenario): string {
  if (scenario.id === 'as-is') return 'baseline';
  const pct = Math.round(scenario.savingRatio * 100);
  if (pct <= 0) return 'no saving';
  return `−${pct}%`;
}

export function CostAdvisor({
  advice,
  recommendation,
  split,
  cacheReady,
  onGenerate,
  onCopyCacheReady,
}: Props) {
  const { cache, model, rules } = advice;

  return (
    <section class="advisor" aria-labelledby="advisor-heading">
      <header class="advisor-header">
        <h2 id="advisor-heading" class="advisor-title">
          Cost Advisor
        </h2>
        <span class="advisor-sub">
          {model.label} · {tokens(advice.workload.callsPerDay)} calls/day · prices verified{' '}
          {model.last_verified}
        </span>
      </header>

      <p class={`advisor-verdict ${recommendation.scenario}`}>{recommendation.headline}</p>
      <ul class="advisor-reasons">
        {recommendation.reasons.map((reason) => (
          <li key={reason}>{reason}</li>
        ))}
      </ul>

      <div class="advisor-scroll">
        <table class="advisor-table">
          <caption class="sr-only">Projected monthly input cost for three strategies</caption>
          <thead>
            <tr>
              <th scope="col">Scenario</th>
              <th scope="col">Input tokens / call</th>
              <th scope="col">Cost / call</th>
              <th scope="col">Cost / month</th>
              <th scope="col">vs today</th>
            </tr>
          </thead>
          <tbody>
            {advice.scenarios.map((scenario) => (
              <tr key={scenario.id} class={scenario.id === advice.best ? 'best' : undefined}>
                <th scope="row">
                  {scenario.label}
                  {scenario.id === advice.best && <span class="advisor-pick">recommended</span>}
                </th>
                <td>{tokens(scenario.inputTokensPerCall)}</td>
                <td>${scenario.costPerCall.toFixed(5)}</td>
                <td>{usd(scenario.monthlyCost)}</td>
                <td class={scenario.savingRatio > 0 ? 'good' : undefined}>
                  {savingLabel(scenario)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p class="advisor-note">
        {cache.ttl ? (
          <>
            Cache plan: {cache.ttl.label} on {rules.label} · {rate(cache.writesPerDay, 'write')} and{' '}
            {rate(cache.readsPerDay, 'read')} a day
            {cache.monthlyStorageCost > 0 && (
              <> · storage {usd(cache.monthlyStorageCost)}/month</>
            )}.{' '}
            {rules.control === 'automatic'
              ? 'OpenAI matches the prefix for you — you only have to keep it first and unchanged.'
              : rules.breakpoint_hint}
          </>
        ) : (
          <>No cache is used in scenario (c): {rules.breakpoint_hint}</>
        )}{' '}
        <a href={rules.docs_url} target="_blank" rel="noopener noreferrer">
          {rules.label} caching docs
        </a>
      </p>

      {split.invalidators.length > 0 && (
        <div class="advisor-group">
          <h3 class="advisor-group-title">
            Silent cache invalidators{' '}
            <span class="advisor-group-count">{split.invalidators.length}</span>
          </h3>
          <p class="advisor-note">
            These sit inside the block you would cache and change between calls, so the prefix never
            matches. Nothing errors — you simply pay full price every time.
          </p>
          <ul class="advisor-list">
            {split.invalidators.map((marker) => (
              <li key={`${marker.start}:${marker.text}`}>
                <span class="advisor-mark" aria-hidden="true">
                  ⚠
                </span>
                <span>
                  <code>{marker.text}</code> · line {marker.line + 1} · {MARKER_LABELS[marker.kind]}
                  <em class="advisor-why">{marker.why}</em>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div class="advisor-actions">
        <button type="button" class="btn btn-ghost" onClick={onGenerate}>
          🧱 Generate cache-ready version
        </button>
        {cacheReady && (
          <button type="button" class="btn btn-ghost" onClick={onCopyCacheReady}>
            📋 Copy cache-ready prompt
          </button>
        )}
      </div>

      {cacheReady && (
        <div class="advisor-group">
          {cacheReady.notes.map((note) => (
            <p key={note} class="advisor-note">
              {note}
            </p>
          ))}
          <textarea
            class="advisor-output"
            aria-label="Cache-ready prompt"
            readOnly
            rows={12}
            value={cacheReady.text}
          />
        </div>
      )}
    </section>
  );
}
