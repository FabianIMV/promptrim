/**
 * The economics of "compress vs cache", per provider.
 *
 * Every number here comes from `data/pricing.json` (prices) and
 * `data/caching.json` (behaviour), both verified against the providers' own
 * documentation. Nothing is a rule of thumb.
 *
 * The one modelling choice worth stating up front: a cached prefix is only
 * cheap while it stays warm, so the *interval between calls* — not the volume —
 * decides whether caching works at all. Anthropic and OpenAI refresh the
 * lifetime for free on every hit, so with calls closer together than the TTL a
 * single write covers the whole day. Gemini's explicit caches expire on their
 * TTL whether or not they are read, so they are rewritten once per window and
 * billed for storage in between.
 *
 * Pure functions, no DOM.
 */

import type { ModelPricing } from '../pricing';
import { cacheReadPricePerMtok, cacheWritePricePerMtok, costForTokens } from '../pricing';
import type { CacheTtl, ProviderCacheRules } from './rules';
import { minCacheableTokens, providerCacheRules, ttlsForModel } from './rules';

export const DAYS_PER_MONTH = 30;
/** A scenario has to beat the current bill by this much before it is recommended. */
export const MEANINGFUL_SAVING_RATIO = 0.005;
const SECONDS_PER_DAY = 86_400;

export interface CacheWorkload {
  /** Prompt as it stands today, in tokens. */
  originalTokens: number;
  /** Same prompt after compression, in tokens. */
  compressedTokens: number;
  /** Static prefix once invalidators move below the breakpoint (scenario c). */
  prefixTokens: number;
  /** Everything after that breakpoint, uncompressed. */
  dynamicTokens: number;
  /** Everything after that breakpoint, compressed. */
  compressedDynamicTokens: number;
  /** What the prompt would cache today, before any reordering. */
  cacheableTodayTokens: number;
  callsPerDay: number;
  /** Seconds between two consecutive calls. Defaults to an even spread over 24 h. */
  intervalSeconds?: number;
}

export type ScenarioId = 'as-is' | 'compress' | 'cache';

export interface Scenario {
  id: ScenarioId;
  label: string;
  /** Average input tokens billed per call (cache reads counted as tokens). */
  inputTokensPerCall: number;
  /** Average cost of one call's input, in USD. */
  costPerCall: number;
  monthlyCost: number;
  /** Monthly saving against the `as-is` scenario, in USD. Negative means worse. */
  monthlySaving: number;
  /** Saving as a fraction of the `as-is` monthly cost, in [-∞, 1]. */
  savingRatio: number;
}

export interface CacheScenarioDetail {
  /** TTL the scenario uses, or `null` when caching turned out not to be worth it. */
  ttl: CacheTtl | null;
  writesPerDay: number;
  readsPerDay: number;
  /** USD per month spent writing the prefix into the cache. */
  monthlyWriteCost: number;
  /** USD per month spent reading it back. */
  monthlyReadCost: number;
  /** USD per month of cache storage (Gemini only). */
  monthlyStorageCost: number;
  /** USD per month for the dynamic part, which is never cached. */
  monthlyDynamicCost: number;
  /** True when the prefix is under the model's minimum and nothing is cached. */
  belowMinimum: boolean;
  minCacheableTokens: number | undefined;
  /** True when no TTL survives the gap between calls. */
  intervalTooLong: boolean;
}

/**
 * Calls needed over one cache lifetime before caching is cheaper than not
 * caching: the smallest n with `write + (n-1)·read < n·input`.
 *
 * Anthropic states the answer for its own multipliers — "caching pays off after
 * one cache read for the 5-minute duration (1.25x write), or after two cache
 * reads for the 1-hour duration (2x write)" — which is 2 and 3 requests. This
 * function reproduces those two numbers from the prices alone.
 */
export function breakEvenCalls(model: ModelPricing, ttl?: CacheTtl): number {
  const input = model.input_per_mtok;
  const read = cacheReadPricePerMtok(model);
  const write = cacheWritePricePerMtok(model, ttl?.id);
  if (read >= input) return Infinity;
  return Math.floor((write - read) / (input - read)) + 1;
}

/**
 * Calls per hour a storage-billed cache (Gemini) needs before it saves money:
 * storage is charged per hour whether or not anyone reads the cache, so
 * `R·read + storage < R·input`. Returns 0 when storage is not billed.
 */
export function minCallsPerHour(model: ModelPricing): number {
  const storage = model.cache_storage_per_mtok_hour;
  if (!storage) return 0;
  const input = model.input_per_mtok;
  const read = cacheReadPricePerMtok(model);
  if (read >= input) return Infinity;
  return storage / (input - read);
}

/**
 * Size of the dynamic part after compression, assumed to compress at the same
 * rate as the whole prompt.
 *
 * Fast mode does not need this — the compressor is a pure function, so the
 * dynamic slice can simply be compressed for real. It exists for AI mode, where
 * the only compressed text available is the one the model returned for the
 * whole prompt.
 */
export function scaleCompressedTokens(
  dynamicTokens: number,
  originalTokens: number,
  compressedTokens: number,
): number {
  if (originalTokens <= 0) return 0;
  return Math.round(dynamicTokens * (compressedTokens / originalTokens));
}

/** Even spread of `callsPerDay` over 24 h, in seconds. */
export function defaultIntervalSeconds(callsPerDay: number): number {
  return callsPerDay > 0 ? SECONDS_PER_DAY / callsPerDay : Infinity;
}

/**
 * The cheapest TTL that still covers the gap between calls, or `null` when
 * every call would land on a cold cache.
 */
export function chooseTtl(
  model: Pick<ModelPricing, 'id' | 'provider'>,
  intervalSeconds: number,
): CacheTtl | null {
  const options = [...ttlsForModel(model)].sort((a, b) => a.seconds - b.seconds);
  return options.find((ttl) => intervalSeconds <= ttl.seconds) ?? null;
}

/**
 * How many calls one cache write serves.
 *
 * With free refresh-on-hit the chain never breaks while calls stay closer
 * together than the TTL, so one write covers the day (`Infinity` here, turned
 * into a single daily cold start by the caller). Without it the cache dies on
 * its TTL and covers the calls that fit in one window.
 */
function callsPerWrite(rules: ProviderCacheRules, ttl: CacheTtl, intervalSeconds: number): number {
  if (intervalSeconds > ttl.seconds) return 1;
  if (rules.refresh_on_hit) return Infinity;
  return Math.floor(ttl.seconds / intervalSeconds) + 1;
}

interface CacheOption {
  ttl: CacheTtl | null;
  writesPerDay: number;
  readsPerDay: number;
  monthlyWriteCost: number;
  monthlyReadCost: number;
  monthlyStorageCost: number;
  monthlyPrefixCost: number;
}

/** Not caching at all: the prefix is billed as ordinary input on every call. */
function withoutCache(model: ModelPricing, prefixTokens: number, callsPerDay: number): CacheOption {
  const monthly = costForTokens(prefixTokens, model.input_per_mtok) * callsPerDay * DAYS_PER_MONTH;
  return {
    ttl: null,
    writesPerDay: callsPerDay,
    readsPerDay: 0,
    monthlyWriteCost: monthly,
    monthlyReadCost: 0,
    monthlyStorageCost: 0,
    monthlyPrefixCost: monthly,
  };
}

/** Cost of keeping the prefix in a cache with this TTL, for a month. */
function withCache(
  model: ModelPricing,
  rules: ProviderCacheRules,
  ttl: CacheTtl,
  prefixTokens: number,
  callsPerDay: number,
  intervalSeconds: number,
): CacheOption {
  const covered = callsPerWrite(rules, ttl, intervalSeconds);
  const writesPerDay = covered === Infinity ? 1 : callsPerDay / covered;
  const readsPerDay = Math.max(0, callsPerDay - writesPerDay);
  const monthlyWriteCost =
    costForTokens(prefixTokens, cacheWritePricePerMtok(model, ttl.id)) *
    writesPerDay *
    DAYS_PER_MONTH;
  const monthlyReadCost =
    costForTokens(prefixTokens, cacheReadPricePerMtok(model)) * readsPerDay * DAYS_PER_MONTH;
  const monthlyStorageCost =
    rules.storage_billed && model.cache_storage_per_mtok_hour
      ? costForTokens(prefixTokens, model.cache_storage_per_mtok_hour) *
        writesPerDay *
        (ttl.seconds / 3600) *
        DAYS_PER_MONTH
      : 0;
  return {
    ttl,
    writesPerDay,
    readsPerDay,
    monthlyWriteCost,
    monthlyReadCost,
    monthlyStorageCost,
    monthlyPrefixCost: monthlyWriteCost + monthlyReadCost + monthlyStorageCost,
  };
}

export interface CostAdvice {
  model: ModelPricing;
  rules: ProviderCacheRules;
  workload: Required<CacheWorkload>;
  scenarios: [Scenario, Scenario, Scenario];
  cache: CacheScenarioDetail;
  /** Cheapest scenario. */
  best: ScenarioId;
  breakEvenCalls: number;
  /** Only meaningful when the provider bills storage; 0 otherwise. */
  minCallsPerHour: number;
  /** Tokens the reordering would add to the cacheable prefix. */
  reorderGainTokens: number;
}

/**
 * Cost of the three scenarios the Cost Advisor compares, in USD per month:
 * (a) leave the prompt alone, (b) compress it, (c) reorder so the static block
 * is a cacheable prefix, cache it, and compress only the dynamic part.
 */
export function adviseCost(model: ModelPricing, workload: CacheWorkload): CostAdvice {
  const rules = providerCacheRules(model.provider);
  const intervalSeconds = workload.intervalSeconds ?? defaultIntervalSeconds(workload.callsPerDay);
  const filled: Required<CacheWorkload> = { ...workload, intervalSeconds };
  const { callsPerDay, prefixTokens } = filled;

  const input = model.input_per_mtok;
  const monthlyCalls = callsPerDay * DAYS_PER_MONTH;

  const asIsMonthly = costForTokens(filled.originalTokens, input) * monthlyCalls;
  const compressMonthly = costForTokens(filled.compressedTokens, input) * monthlyCalls;

  const min = minCacheableTokens(model);
  const belowMinimum = min !== undefined && prefixTokens < min;
  const intervalTooLong = chooseTtl(model, intervalSeconds) === null;

  // Every TTL the model offers is priced out and the cheapest one wins, with
  // "don't cache" always in the running. Picking the shortest TTL that outlives
  // the gap between calls is right for Anthropic (a longer TTL costs more to
  // write) but wrong for Gemini, where the write price is the same for every
  // TTL and a longer one simply means fewer rewrites.
  const options: CacheOption[] = [withoutCache(model, prefixTokens, callsPerDay)];
  if (!belowMinimum) {
    for (const ttl of ttlsForModel(model)) {
      options.push(withCache(model, rules, ttl, prefixTokens, callsPerDay, intervalSeconds));
    }
  }
  const chosen = options.reduce((a, b) => (b.monthlyPrefixCost < a.monthlyPrefixCost ? b : a));
  const { ttl, writesPerDay, readsPerDay, monthlyWriteCost, monthlyReadCost, monthlyStorageCost } =
    chosen;

  const monthlyDynamicCost = costForTokens(filled.compressedDynamicTokens, input) * monthlyCalls;
  const cacheMonthly = chosen.monthlyPrefixCost + monthlyDynamicCost;

  const scenario = (
    id: ScenarioId,
    label: string,
    monthlyCost: number,
    inputTokensPerCall: number,
  ): Scenario => ({
    id,
    label,
    inputTokensPerCall,
    costPerCall: monthlyCalls > 0 ? monthlyCost / monthlyCalls : 0,
    monthlyCost,
    monthlySaving: asIsMonthly - monthlyCost,
    savingRatio: asIsMonthly > 0 ? (asIsMonthly - monthlyCost) / asIsMonthly : 0,
  });

  // The same tokens still travel on every call; caching changes what they cost,
  // not how many there are.
  const cacheTokensPerCall = prefixTokens + filled.compressedDynamicTokens;

  const scenarios: [Scenario, Scenario, Scenario] = [
    scenario('as-is', 'Leave it as it is', asIsMonthly, filled.originalTokens),
    scenario('compress', 'Compress only', compressMonthly, filled.compressedTokens),
    scenario(
      'cache',
      'Reorder + cache (compress the dynamic part)',
      cacheMonthly,
      cacheTokensPerCall,
    ),
  ];

  // Ties and rounding noise go to the simpler scenario: restructuring a prompt
  // has a real cost in effort and risk, so a scenario only "wins" when it is
  // cheaper by more than half a percent of the current bill.
  let best = scenarios[0];
  for (const candidate of scenarios.slice(1)) {
    if (candidate.monthlyCost < best.monthlyCost - asIsMonthly * MEANINGFUL_SAVING_RATIO) {
      best = candidate;
    }
  }

  return {
    model,
    rules,
    workload: filled,
    scenarios,
    cache: {
      ttl,
      writesPerDay,
      readsPerDay,
      monthlyWriteCost,
      monthlyReadCost,
      monthlyStorageCost,
      monthlyDynamicCost,
      belowMinimum,
      minCacheableTokens: min,
      intervalTooLong,
    },
    best: best.id,
    breakEvenCalls: breakEvenCalls(model, ttl ?? undefined),
    minCallsPerHour: minCallsPerHour(model),
    reorderGainTokens: Math.max(0, filled.prefixTokens - filled.cacheableTodayTokens),
  };
}
