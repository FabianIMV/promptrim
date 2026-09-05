import { describe, expect, it } from 'vitest';
import { LEVELS } from '../src/core';
import { LEVEL_KEEP_RATE } from '../src/local-ml/rate';

describe('LEVEL_KEEP_RATE', () => {
  it('has a rate for every level', () => {
    for (const level of LEVELS) {
      expect(LEVEL_KEEP_RATE[level]).toBeGreaterThan(0);
      expect(LEVEL_KEEP_RATE[level]).toBeLessThanOrEqual(1);
    }
  });

  it('keeps strictly less as the level gets more aggressive', () => {
    expect(LEVEL_KEEP_RATE.light).toBeGreaterThan(LEVEL_KEEP_RATE.balanced);
    expect(LEVEL_KEEP_RATE.balanced).toBeGreaterThan(LEVEL_KEEP_RATE.aggressive);
  });
});
