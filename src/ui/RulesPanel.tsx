import { useMemo } from 'preact/hooks';
import { ALL_RULES, LEVELS } from '../core';
import type { Level } from '../core';

interface Props {
  disabledRuleIds: ReadonlySet<string>;
  onToggle: (ruleId: string) => void;
}

const LEVEL_LABELS: Record<Level, string> = {
  light: 'Light',
  balanced: 'Balanced',
  aggressive: 'Aggressive',
};

/**
 * Which rules Fast mode is allowed to use, persisted per session (Phase 3
 * task 4). Kept closed by default — most sessions never need it — via a
 * native <details>, which is keyboard-operable without extra JS.
 */
export function RulesPanel({ disabledRuleIds, onToggle }: Props) {
  const byLevel = useMemo(() => {
    const groups = new Map<Level, typeof ALL_RULES>();
    for (const level of LEVELS) groups.set(level, []);
    for (const rule of ALL_RULES) groups.get(rule.level)!.push(rule);
    return LEVELS.map((level) => ({ level, rules: groups.get(level)! }));
  }, []);

  return (
    <details class="rules-panel">
      <summary class="rules-summary">
        Rules ({ALL_RULES.length - disabledRuleIds.size}/{ALL_RULES.length} enabled)
      </summary>
      <div class="rules-body">
        <p class="rules-note">
          Disabled rules are skipped in Fast mode for every level they apply to. Saved in this
          browser.
        </p>
        {byLevel.map(({ level, rules }) => (
          <div key={level} class="rules-group">
            <h3 class="rules-group-title">{LEVEL_LABELS[level]}</h3>
            <ul class="rules-list">
              {rules.map((rule) => (
                <li key={rule.id} class="rules-item">
                  <label>
                    <input
                      type="checkbox"
                      checked={!disabledRuleIds.has(rule.id)}
                      onChange={() => onToggle(rule.id)}
                    />
                    <code>{rule.id}</code>
                    {rule.lossy && <span class="rules-lossy">lossy</span>}
                  </label>
                  <p class="rules-why">{rule.why}</p>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </details>
  );
}
