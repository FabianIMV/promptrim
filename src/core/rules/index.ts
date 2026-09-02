import type { Level, Rule } from './types';
import { levelRank } from './types';
import { LOSSLESS_RULES } from './lossless';
import { SUBSTITUTION_RULES } from './substitutions';
import { AGGRESSIVE_RULES, FRAME_RULES } from './frames';

/**
 * Rule order is priority order: when two rules match overlapping spans, the one
 * that appears first here wins. Longer, more specific framings are listed
 * before the shorter fragments they contain.
 */
export const ALL_RULES: Rule[] = [
  ...FRAME_RULES,
  ...AGGRESSIVE_RULES,
  ...SUBSTITUTION_RULES,
  ...LOSSLESS_RULES,
];

export function rulesForLevel(level: Level, all: Rule[] = ALL_RULES): Rule[] {
  const max = levelRank(level);
  return all.filter((r) => levelRank(r.level) <= max);
}

export function ruleById(id: string, all: Rule[] = ALL_RULES): Rule | undefined {
  return all.find((r) => r.id === id);
}

export { LOSSLESS_RULES, SUBSTITUTION_RULES, FRAME_RULES, AGGRESSIVE_RULES };
export { DISCARDED_RULES } from './discarded';
export type { DiscardedRule } from './discarded';
export * from './types';
