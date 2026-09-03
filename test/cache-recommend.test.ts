/**
 * The recommendation the Cost Advisor prints — including the one the product
 * exists to be able to give: "don't compress, reorder and cache".
 */
import { describe, expect, it } from 'vitest';
import { getModel } from '../src/core/pricing';
import { adviseCost } from '../src/core/cache-advisor/economics';
import type { CacheWorkload } from '../src/core/cache-advisor/economics';
import { recommend, usd } from '../src/core/cache-advisor/recommend';
import { splitPrompt } from '../src/core/cache-advisor/split';

const opus = getModel('claude-opus-5')!;
const haiku = getModel('claude-haiku-4-5')!;
const flash = getModel('gemini-2.5-flash')!;

const PROMPT = `You are a support agent.
Current date: 2026-09-03
Never share internal pricing.

User: {{question}}`;
const split = splitPrompt(PROMPT);

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

describe('recommend', () => {
  it('tells the user to reorder and cache when that is what wins', () => {
    const advice = adviseCost(opus, workload({ cacheableTodayTokens: 120 }));
    const rec = recommend(advice, split);
    expect(rec.scenario).toBe('cache');
    expect(rec.headline).toContain('below the breakpoint');
    expect(rec.reasons.join(' ')).toContain('grows the cacheable prefix from 120 tokens');
    expect(rec.reasons.join(' ')).toContain('call 2 onward');
  });

  it('recommends caching without reordering when there is nothing to move', () => {
    const rec = recommend(adviseCost(opus, workload()), splitPrompt('Static rules only.'));
    expect(rec.scenario).toBe('cache');
    expect(rec.headline).toContain('Cache the static prefix');
    expect(rec.headline).toContain('3,000 tokens');
  });

  it('names the model minimum when the prefix is too short to cache', () => {
    const rec = recommend(adviseCost(haiku, workload({ callsPerDay: 1000 })), split);
    expect(rec.scenario).toBe('compress');
    expect(rec.reasons[0]).toContain('4,096 tokens');
    expect(rec.reasons[0]).toContain('fails silently');
  });

  it('says the calls are too far apart when no cache survives the gap', () => {
    const rec = recommend(adviseCost(opus, workload({ callsPerDay: 10 })), split);
    expect(rec.scenario).toBe('compress');
    expect(rec.reasons[0]).toContain('2.4 h apart');
  });

  it('says when a Gemini cache would cost more in storage than it saves', () => {
    // One call an hour, under the 3.7 reads an hour Flash storage needs.
    const rec = recommend(adviseCost(flash, workload({ callsPerDay: 24 })), split);
    expect(rec.reasons[0]).toContain('cost more than it saves');
    expect(rec.scenario).toBe('compress');
  });

  it('mentions the hourly storage floor on Gemini', () => {
    const rec = recommend(adviseCost(flash, workload()), split);
    expect(rec.reasons.join(' ')).toContain('at least 4 times an hour');
  });

  it('always compares the two savings side by side', () => {
    const rec = recommend(adviseCost(opus, workload()), split);
    expect(rec.reasons.at(-1)).toContain('Compressing alone saves $1,050/month (20%)');
    expect(rec.reasons.at(-1)).toContain('caching saves $4,199/month (80%)');
  });

  it('falls back to "leave it alone" when nothing helps', () => {
    const advice = adviseCost(
      opus,
      workload({ compressedTokens: 3500, compressedDynamicTokens: 500, callsPerDay: 10 }),
    );
    const rec = recommend(advice, split);
    expect(rec.scenario).toBe('as-is');
    expect(rec.headline).toContain('Leave it as it is');
  });

  it('handles the empty state', () => {
    const advice = adviseCost(opus, {
      originalTokens: 0,
      compressedTokens: 0,
      prefixTokens: 0,
      dynamicTokens: 0,
      compressedDynamicTokens: 0,
      cacheableTodayTokens: 0,
      callsPerDay: 0,
    });
    expect(recommend(advice, split).headline).toContain('Nothing to save here yet');
  });
});

describe('usd', () => {
  it('keeps small numbers readable and rounds big ones', () => {
    expect(usd(0)).toBe('$0');
    expect(usd(0.00123)).toBe('$0.0012');
    expect(usd(4.5)).toBe('$4.50');
    expect(usd(1050.5175)).toBe('$1,051');
    expect(usd(-12.4)).toBe('-$12');
    expect(usd(-0.000001)).toBe('$0');
  });
});
