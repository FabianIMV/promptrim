/**
 * The economic model, checked against numbers worked out by hand.
 *
 * Every expected figure in this file was computed on paper from the prices in
 * `data/pricing.json` and the caching rules in `data/caching.json`; the
 * arithmetic is written out in the comments so a reviewer can redo it without
 * running the code.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { splitPrompt } from '../src/core/cache-advisor/split';
import { getModel } from '../src/core/pricing';
import {
  adviseCost,
  breakEvenCalls,
  chooseTtl,
  defaultIntervalSeconds,
  minCallsPerHour,
  scaleCompressedTokens,
} from '../src/core/cache-advisor/economics';
import type { CacheWorkload } from '../src/core/cache-advisor/economics';
import { ttlsForModel } from '../src/core/cache-advisor/rules';

const opus = getModel('claude-opus-5')!;
const sonnet = getModel('claude-sonnet-5')!;
const haiku = getModel('claude-haiku-4-5')!;
const gpt5 = getModel('gpt-5')!;
const gpt4o = getModel('gpt-4o')!;
const sol = getModel('gpt-5.6-sol')!;
const flash = getModel('gemini-2.5-flash')!;
const pro = getModel('gemini-2.5-pro')!;

const ttlOf = (id: string, model = opus) => ttlsForModel(model).find((t) => t.id === id)!;

/** 3 000-token static prefix, 500-token dynamic tail, 20% compression. */
function workload(overrides: Partial<CacheWorkload> = {}): CacheWorkload {
  return {
    originalTokens: 3500,
    compressedTokens: 2800,
    prefixTokens: 3000,
    dynamicTokens: 500,
    compressedDynamicTokens: 400,
    cacheableTodayTokens: 3000,
    callsPerDay: 10_000,
    ...overrides,
  };
}

describe('breakEvenCalls', () => {
  it('reproduces the two numbers Anthropic publishes: 2 calls at 5m, 3 at 1h', () => {
    // "caching pays off after one cache read for the 5-minute duration
    //  (1.25x write), or after two cache reads for the 1-hour duration (2x
    //  write)" — one write plus one read is 2 calls; plus two reads is 3.
    // n > (write - read) / (input - read):
    //   5m → (6.25 - 0.50) / (5 - 0.50) = 1.28 → 2
    //   1h → (10.00 - 0.50) / (5 - 0.50) = 2.11 → 3
    for (const model of [opus, sonnet, haiku]) {
      expect(breakEvenCalls(model, ttlOf('anthropic-5m', model))).toBe(2);
      expect(breakEvenCalls(model, ttlOf('anthropic-1h', model))).toBe(3);
    }
  });

  it('needs 2 calls on GPT-5.6, which charges the same 1.25x write', () => {
    // (5.00 - 0.40) / (4.00 - 0.40) = 1.28 → 2
    expect(breakEvenCalls(sol, ttlOf('openai-30m', sol))).toBe(2);
  });

  it('needs 2 calls where the write costs nothing extra', () => {
    // GPT-5: (1.25 - 0.125) / (1.25 - 0.125) = 1 → 2. The first call cannot
    // save anything: it is the one that fills the cache.
    expect(breakEvenCalls(gpt5, ttlOf('openai-5m', gpt5))).toBe(2);
    expect(breakEvenCalls(gpt4o, ttlOf('openai-5m', gpt4o))).toBe(2);
    expect(breakEvenCalls(flash, ttlOf('gemini-1h', flash))).toBe(2);
  });
});

describe('minCallsPerHour', () => {
  it('is zero where storage is not billed', () => {
    expect(minCallsPerHour(opus)).toBe(0);
    expect(minCallsPerHour(gpt5)).toBe(0);
  });

  it('is the storage rate over the per-token saving on Gemini', () => {
    // Flash: $1.00 per MTok-hour / ($0.30 - $0.03) = 3.70 calls per hour.
    expect(minCallsPerHour(flash)).toBeCloseTo(3.7037, 4);
    // Pro: $4.50 / ($1.25 - $0.125) = 4 calls per hour, exactly.
    expect(minCallsPerHour(pro)).toBeCloseTo(4, 6);
  });
});

describe('chooseTtl', () => {
  it('takes the shortest TTL that outlives the gap between calls', () => {
    expect(chooseTtl(opus, 8.64)?.id).toBe('anthropic-5m');
    expect(chooseTtl(opus, 300)?.id).toBe('anthropic-5m');
    expect(chooseTtl(opus, 301)?.id).toBe('anthropic-1h');
    expect(chooseTtl(opus, 3600)?.id).toBe('anthropic-1h');
  });

  it('returns null when no cache survives the gap', () => {
    expect(chooseTtl(opus, 3601)).toBeNull();
    expect(chooseTtl(gpt5, 3600)).toBeNull(); // pre-5.6 caches die after ~5 min idle
  });

  it('spreads calls evenly over 24 h by default', () => {
    expect(defaultIntervalSeconds(10_000)).toBeCloseTo(8.64);
    expect(defaultIntervalSeconds(288)).toBeCloseTo(300);
  });
});

describe('adviseCost — 3 000-token prefix, 10 000 calls/day, Claude Opus 5', () => {
  const advice = adviseCost(opus, workload());
  const [asIs, compressOnly, cache] = advice.scenarios;

  it('prices the as-is and compress-only scenarios per call and per month', () => {
    // 3 500 tok x $5/MTok = $0.0175 a call; x 10 000 x 30 = $5 250 a month.
    expect(asIs.costPerCall).toBeCloseTo(0.0175, 6);
    expect(asIs.monthlyCost).toBeCloseTo(5250, 4);
    // 2 800 tok x $5/MTok = $0.014 a call; x 300 000 = $4 200 a month.
    expect(compressOnly.monthlyCost).toBeCloseTo(4200, 4);
    expect(compressOnly.monthlySaving).toBeCloseTo(1050, 4);
    expect(compressOnly.savingRatio).toBeCloseTo(0.2, 6);
  });

  it('caches on the 5-minute TTL with one write a day', () => {
    // Calls are 8.64 s apart and a hit refreshes the lifetime for free, so the
    // chain never breaks: 1 write, 9 999 reads a day.
    expect(advice.cache.ttl?.id).toBe('anthropic-5m');
    expect(advice.cache.writesPerDay).toBe(1);
    expect(advice.cache.readsPerDay).toBe(9999);
    expect(advice.cache.belowMinimum).toBe(false);
    expect(advice.cache.intervalTooLong).toBe(false);
  });

  it('prices the cache scenario at $1 050.52 a month', () => {
    // write:   1/day x 3 000 x $6.25/MTok       = $0.01875/day  -> $0.5625
    // read: 9 999/day x 3 000 x $0.50/MTok      = $14.9985/day  -> $449.955
    // dynamic: 400 tok x $5/MTok x 300 000 calls               -> $600.00
    expect(advice.cache.monthlyWriteCost).toBeCloseTo(0.5625, 6);
    expect(advice.cache.monthlyReadCost).toBeCloseTo(449.955, 6);
    expect(advice.cache.monthlyStorageCost).toBe(0);
    expect(advice.cache.monthlyDynamicCost).toBeCloseTo(600, 6);
    expect(cache.monthlyCost).toBeCloseTo(1050.5175, 4);
  });

  it('recommends caching: 80% saved against 20% for compression', () => {
    expect(advice.best).toBe('cache');
    expect(cache.monthlySaving).toBeCloseTo(4199.4825, 4);
    expect(cache.savingRatio).toBeCloseTo(0.79990143, 6);
  });
});

describe('adviseCost — the cases where caching is the wrong answer', () => {
  it('says compress when the calls are hours apart', () => {
    // 10 calls a day = one every 2.4 h; the longest Anthropic cache is 1 h.
    const advice = adviseCost(opus, workload({ callsPerDay: 10 }));
    expect(advice.cache.intervalTooLong).toBe(true);
    expect(advice.cache.ttl).toBeNull();
    expect(advice.best).toBe('compress');
    // as-is 3 500 x $5/MTok x 300 = $5.25; compress $4.20; scenario (c) keeps
    // the 3 000-token prefix uncompressed and uncached: $4.50 + $0.60 = $5.10.
    expect(advice.scenarios[0].monthlyCost).toBeCloseTo(5.25, 6);
    expect(advice.scenarios[1].monthlyCost).toBeCloseTo(4.2, 6);
    expect(advice.scenarios[2].monthlyCost).toBeCloseTo(5.1, 6);
  });

  it('says compress when the prefix is under the model minimum', () => {
    // Haiku 4.5 caches nothing under 4 096 tokens; this prefix is 3 000.
    const advice = adviseCost(haiku, workload({ callsPerDay: 1000 }));
    expect(advice.cache.belowMinimum).toBe(true);
    expect(advice.cache.minCacheableTokens).toBe(4096);
    expect(advice.cache.ttl).toBeNull();
    expect(advice.best).toBe('compress');
    // as-is 3 500 x $1/MTok x 30 000 = $105; compress $84; (c) $90 + $12 = $102.
    expect(advice.scenarios[0].monthlyCost).toBeCloseTo(105, 6);
    expect(advice.scenarios[1].monthlyCost).toBeCloseTo(84, 6);
    expect(advice.scenarios[2].monthlyCost).toBeCloseTo(102, 6);
  });

  it('caches the same prefix on Opus 5, whose minimum is 512 tokens', () => {
    const advice = adviseCost(opus, workload({ callsPerDay: 1000 }));
    expect(advice.cache.belowMinimum).toBe(false);
    expect(advice.best).toBe('cache');
  });

  it('does not cache on Gemini when storage would cost more than it saves', () => {
    // 24 calls a day is one an hour, under the 3.7 reads an hour that Flash
    // storage needs to break even.
    const advice = adviseCost(flash, workload({ callsPerDay: 24 }));
    expect(advice.cache.ttl).toBeNull();
    expect(advice.best).toBe('compress');
  });
});

describe('adviseCost — Gemini 2.5 Flash pays for storage', () => {
  const advice = adviseCost(flash, workload());

  it('picks the 1-hour TTL, which needs 24 rewrites a day instead of 286', () => {
    // Gemini caches do not refresh when read, so a 5-minute cache is rebuilt
    // every 300 s. With calls 8.64 s apart, one cache serves
    // floor(3600 / 8.64) + 1 = 417 calls -> 10 000 / 417 = 23.98 writes a day.
    expect(advice.cache.ttl?.id).toBe('gemini-1h');
    expect(advice.cache.writesPerDay).toBeCloseTo(23.980815, 5);
    expect(advice.cache.readsPerDay).toBeCloseTo(9976.019185, 5);
  });

  it('prices writes, reads and storage separately', () => {
    // write:   23.980815 x 3 000 x $0.30/MTok x 30 = $0.6475
    // read:  9 976.019 x 3 000 x $0.03/MTok x 30   = $26.9353
    // store:   23.980815 caches x 1 h x 3 000 tok x $1/MTok-h x 30 = $2.1583
    // dynamic: 400 tok x $0.30/MTok x 300 000 calls                = $36.00
    expect(advice.cache.monthlyWriteCost).toBeCloseTo(0.647482, 5);
    expect(advice.cache.monthlyReadCost).toBeCloseTo(26.935252, 5);
    expect(advice.cache.monthlyStorageCost).toBeCloseTo(2.158273, 5);
    expect(advice.cache.monthlyDynamicCost).toBeCloseTo(36, 6);
    expect(advice.scenarios[2].monthlyCost).toBeCloseTo(65.741008, 4);
  });

  it('still beats compressing, by 79% against 20%', () => {
    expect(advice.scenarios[0].monthlyCost).toBeCloseTo(315, 6);
    expect(advice.scenarios[1].monthlyCost).toBeCloseTo(252, 6);
    expect(advice.best).toBe('cache');
    expect(advice.scenarios[2].savingRatio).toBeCloseTo(0.79129839, 6);
  });
});

describe('adviseCost — OpenAI GPT-5, where writing the cache costs nothing extra', () => {
  const advice = adviseCost(gpt5, workload());

  it('bills the single write at the plain input price', () => {
    // 1 write/day x 3 000 tok x $1.25/MTok x 30 = $0.1125
    expect(advice.cache.ttl?.id).toBe('openai-5m');
    expect(advice.cache.monthlyWriteCost).toBeCloseTo(0.1125, 6);
    // 9 999 reads/day x 3 000 tok x $0.125/MTok x 30 = $112.489
    expect(advice.cache.monthlyReadCost).toBeCloseTo(112.48875, 5);
    expect(advice.scenarios[2].monthlyCost).toBeCloseTo(262.60125, 4);
    expect(advice.scenarios[0].monthlyCost).toBeCloseTo(1312.5, 6);
    expect(advice.scenarios[1].monthlyCost).toBeCloseTo(1050, 6);
    expect(advice.best).toBe('cache');
  });
});

describe('adviseCost — reordering', () => {
  it('reports how many tokens the reordering adds to the prefix', () => {
    const advice = adviseCost(opus, workload({ cacheableTodayTokens: 120 }));
    expect(advice.reorderGainTokens).toBe(2880);
  });

  it('never reports a negative gain', () => {
    const advice = adviseCost(opus, workload({ cacheableTodayTokens: 4000 }));
    expect(advice.reorderGainTokens).toBe(0);
  });

  it('handles an empty workload without dividing by zero', () => {
    const advice = adviseCost(opus, {
      originalTokens: 0,
      compressedTokens: 0,
      prefixTokens: 0,
      dynamicTokens: 0,
      compressedDynamicTokens: 0,
      cacheableTodayTokens: 0,
      callsPerDay: 0,
    });
    for (const scenario of advice.scenarios) {
      expect(scenario.monthlyCost).toBe(0);
      expect(scenario.costPerCall).toBe(0);
      expect(scenario.savingRatio).toBe(0);
    }
  });
});

describe('scaleCompressedTokens', () => {
  it('applies the whole-prompt compression rate to the dynamic slice', () => {
    // AI mode returns one compressed string, so the dynamic part's share is
    // scaled: 500 tokens at 2 800/3 500 = 80% -> 400.
    expect(scaleCompressedTokens(500, 3500, 2800)).toBe(400);
    expect(scaleCompressedTokens(500, 3500, 3500)).toBe(500);
  });

  it('does not divide by zero', () => {
    expect(scaleCompressedTokens(500, 0, 0)).toBe(0);
  });
});

describe('adviseCost over the benchmark corpus', () => {
  const prompts = ['bench/corpus/phase0', 'bench/corpus/phase2'].flatMap((dir) =>
    readdirSync(dir)
      .filter((name) => name.endsWith('.md'))
      .map((name) => readFileSync(join(dir, name), 'utf8')),
  );

  it('never recommends a scenario that costs more than doing nothing', () => {
    for (const model of [opus, haiku, gpt5, sol, flash, pro]) {
      for (const text of prompts) {
        const split = splitPrompt(text);
        // A rough 4 chars/token stand-in: this test is about the shape of the
        // model, not about tokenizer accuracy.
        const size = (part: string) => Math.round(part.length / 4);
        const advice = adviseCost(model, {
          originalTokens: size(text),
          compressedTokens: Math.round(size(text) * 0.85),
          prefixTokens: size(split.reorderedPrefix),
          dynamicTokens: size(split.reorderedSuffix),
          compressedDynamicTokens: Math.round(size(split.reorderedSuffix) * 0.85),
          cacheableTodayTokens: size(split.staticPrefix),
          callsPerDay: 5000,
        });
        const chosen = advice.scenarios.find((s) => s.id === advice.best)!;
        expect(chosen.monthlyCost).toBeLessThanOrEqual(advice.scenarios[0].monthlyCost + 1e-9);
        for (const scenario of advice.scenarios) {
          expect(Number.isFinite(scenario.monthlyCost)).toBe(true);
          expect(scenario.monthlyCost).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });
});
