/**
 * Turns the numbers into an explicit recommendation — including the one the
 * product exists to be able to give: "don't compress, reorder and cache".
 */

import type { CostAdvice, ScenarioId } from './economics';
import type { PromptSplit } from './split';

export interface Recommendation {
  scenario: ScenarioId;
  headline: string;
  /** Supporting facts, already phrased for display. */
  reasons: string[];
}

export function usd(value: number): string {
  const abs = Math.abs(value);
  if (abs < 0.00005) return '$0';
  const sign = value < 0 ? '-' : '';
  if (abs < 0.01) return `${sign}$${abs.toFixed(4)}`;
  if (abs < 10) return `${sign}$${abs.toFixed(2)}`;
  return `${sign}$${Math.round(abs).toLocaleString('en-US')}`;
}

function pct(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

function tokens(count: number): string {
  return `${Math.round(count).toLocaleString('en-US')} tokens`;
}

export function recommend(advice: CostAdvice, split: PromptSplit): Recommendation {
  const [asIs, compressOnly, cache] = advice.scenarios;
  const reasons: string[] = [];
  const ttlLabel = advice.cache.ttl?.label ?? 'the cache lifetime';

  if (advice.cache.belowMinimum) {
    reasons.push(
      `${advice.model.label} caches nothing under ${tokens(advice.cache.minCacheableTokens ?? 0)}; your static prefix is ${tokens(advice.workload.prefixTokens)}. The provider fails silently here — no error, just no cache hit.`,
    );
  } else if (advice.cache.intervalTooLong) {
    reasons.push(
      `Your calls are about ${humanInterval(advice.workload.intervalSeconds)} apart and no ${advice.rules.label} cache lives that long, so the prefix would be cold on every call. Scenario (c) below is the reordering without a cache.`,
    );
  } else if (advice.cache.ttl === null) {
    reasons.push(
      `At this call rate a cache would cost more than it saves on ${advice.rules.label}, so scenario (c) below prices the prefix as ordinary input.`,
    );
  } else {
    reasons.push(
      `Caching pays for itself from call ${advice.breakEvenCalls} onward within one ${ttlLabel}, and you make about ${Math.round(advice.workload.callsPerDay).toLocaleString('en-US')} a day.`,
    );
    if (advice.minCallsPerHour > 0) {
      reasons.push(
        `${advice.rules.label} bills cache storage by the hour, so the prefix has to be read at least ${Math.ceil(advice.minCallsPerHour)} times an hour to beat sending it uncached.`,
      );
    }
  }

  if (advice.reorderGainTokens > 0) {
    reasons.push(
      `Reordering grows the cacheable prefix from ${tokens(advice.workload.cacheableTodayTokens)} to ${tokens(advice.workload.prefixTokens)}: ${split.invalidators.length} per-request item${split.invalidators.length === 1 ? '' : 's'} sit above the breakpoint today.`,
    );
  }

  reasons.push(
    `Compressing alone saves ${usd(compressOnly.monthlySaving)}/month (${pct(compressOnly.savingRatio)}); reordering and caching saves ${usd(cache.monthlySaving)}/month (${pct(cache.savingRatio)}).`,
  );

  if (advice.best === 'cache') {
    const headline =
      advice.reorderGainTokens > 0
        ? `Don't just compress — move ${split.invalidators.length} per-request line${split.invalidators.length === 1 ? '' : 's'} below the breakpoint and cache the ${tokens(advice.workload.prefixTokens)} above it.`
        : `Cache the static prefix (${tokens(advice.workload.prefixTokens)}). That is where the money is, not in compression.`;
    return { scenario: 'cache', headline, reasons };
  }

  if (advice.best === 'compress') {
    return {
      scenario: 'compress',
      headline: `Compress: ${usd(compressOnly.monthlySaving)}/month (${pct(compressOnly.savingRatio)}). Caching is not worth it for this prompt.`,
      reasons,
    };
  }

  return {
    scenario: 'as-is',
    headline:
      asIs.monthlyCost === 0
        ? 'Nothing to save here yet — add a prompt and a realistic call volume.'
        : 'Leave it as it is: neither compressing nor caching would make this prompt cheaper.',
    reasons,
  };
}

function humanInterval(seconds: number): string {
  if (!Number.isFinite(seconds)) return 'a very long time';
  if (seconds < 90) return `${Math.round(seconds)} s`;
  if (seconds < 5400) return `${Math.round(seconds / 60)} min`;
  return `${(seconds / 3600).toFixed(1)} h`;
}
