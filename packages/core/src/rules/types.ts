/** Compression levels, from most conservative to most aggressive. */
export type Level = 'light' | 'balanced' | 'aggressive';

export const LEVELS: Level[] = ['light', 'balanced', 'aggressive'];

export function levelRank(level: Level): number {
  return LEVELS.indexOf(level);
}

export type Replacement = string | ((match: string, ...groups: string[]) => string);

export interface RuleCase {
  input: string;
  expected: string;
  /** Why this case exists; required on negative cases so intent stays visible. */
  note?: string;
}

export interface Rule {
  /** Stable identifier, surfaced in the diff (Phase 3) and in the ledger (Phase 2). */
  id: string;
  /** Lowest level at which the rule runs. */
  level: Level;
  /**
   * `true` when the rewrite can drop nuance a reader might care about.
   * Section 2 policy: no `light` rule may be lossy.
   */
  lossy: boolean;
  /** Human-readable "why", shown in the UI. */
  why: string;
  /** Must carry the `g` flag; matched against text segments only. */
  pattern: RegExp;
  replacement: Replacement;
  /** Section 2 policy: at least 3 cases, positive and negative. */
  cases: RuleCase[];
}

/** Expand `$1`, `$&` and `$$` against a concrete match, without re-running the regex. */
export function expandTemplate(template: string, match: RegExpMatchArray): string {
  return template.replace(/\$(\d{1,2}|\$|&)/g, (_full, key: string) => {
    if (key === '$') return '$';
    if (key === '&') return match[0];
    return match[Number(key)] ?? '';
  });
}

export function resolveReplacement(rule: Rule, match: RegExpMatchArray): string {
  if (typeof rule.replacement === 'string') return expandTemplate(rule.replacement, match);
  const groups = match.slice(1).map((g) => g ?? '');
  return rule.replacement(match[0], ...groups);
}
