import { useMemo } from 'preact/hooks';
import { buildDiffItems, changeKey, ruleById } from '@promptrim/core';
import type { BlockedChange, Change, DiffItem } from '@promptrim/core';

interface Props {
  original: string;
  changes: Change[];
  /** Changes the ledger reverted before they ever reached the output (Phase 2). */
  blocked: BlockedChange[];
  /** Keys (see `changeKey`) of changes the user has turned off. */
  disabled: ReadonlySet<string>;
  onToggleChange: (key: string) => void;
  /** Turn every change from one rule on or off at once. */
  onToggleRule: (ruleId: string, nextActive: boolean) => void;
}

interface RuleSummary {
  ruleId: string;
  total: number;
  activeCount: number;
  why: string;
}

function ruleWhy(ruleId: string): string {
  return ruleById(ruleId)?.why ?? ruleId;
}

export function DiffView({
  original,
  changes,
  blocked,
  disabled,
  onToggleChange,
  onToggleRule,
}: Props) {
  const items = useMemo(
    () => buildDiffItems(original, changes, blocked, disabled),
    [original, changes, blocked, disabled],
  );

  const ruleSummaries = useMemo(() => {
    const byRule = new Map<string, RuleSummary>();
    for (const change of changes) {
      const summary = byRule.get(change.ruleId) ?? {
        ruleId: change.ruleId,
        total: 0,
        activeCount: 0,
        why: ruleWhy(change.ruleId),
      };
      summary.total += 1;
      if (!disabled.has(changeKey(change))) summary.activeCount += 1;
      byRule.set(change.ruleId, summary);
    }
    return [...byRule.values()];
  }, [changes, disabled]);

  if (changes.length === 0 && blocked.length === 0) return null;

  return (
    <section class="diffview" aria-labelledby="diff-heading">
      <header class="diffview-header">
        <h2 id="diff-heading" class="diffview-title">
          Changes
        </h2>
        <span class="diffview-legend">
          <span class="diffview-legend-item">
            <del class="diff-del" aria-hidden="true">
              removed
            </del>
          </span>
          <span class="diffview-legend-item">
            <ins class="diff-ins" aria-hidden="true">
              added
            </ins>
          </span>
          <span class="diffview-legend-item">
            <mark class="diff-undone" aria-hidden="true">
              undone
            </mark>
          </span>
          <span class="diffview-legend-item">⛔ blocked by the ledger</span>
        </span>
      </header>

      {ruleSummaries.length > 0 && (
        <ul class="diffview-rules" aria-label="Rules applied, grouped">
          {ruleSummaries.map((summary) => {
            const allOff = summary.activeCount === 0;
            return (
              <li key={summary.ruleId} class="diffview-rule">
                <code title={summary.why}>{summary.ruleId}</code>
                <span class="diffview-rule-count">
                  {summary.activeCount}/{summary.total}
                </span>
                <button
                  type="button"
                  class="diffview-rule-toggle"
                  onClick={() => onToggleRule(summary.ruleId, allOff)}
                >
                  {allOff ? 'Redo all' : 'Undo all'}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <p class="diffview-text" aria-label="Diff of the compressed prompt against the original">
        {items.map((item) => renderItem(item, onToggleChange))}
      </p>
    </section>
  );
}

function renderItem(item: DiffItem, onToggleChange: (key: string) => void) {
  if (item.kind === 'text') {
    return item.text;
  }

  if (item.kind === 'blocked') {
    const why = `Blocked by the ledger — dropping this would lose: ${item.change.constraintIds.join(', ')}`;
    return (
      <span key={item.key} class="diff-blocked" title={why}>
        <span aria-hidden="true">⛔</span>
        <span class="sr-only">Blocked: </span>
        {item.change.original}
      </span>
    );
  }

  const { change, active, key } = item;
  const why = ruleWhy(change.ruleId);
  const label = `${active ? 'Undo' : 'Redo'} change from rule ${change.ruleId}: ${why}`;

  return (
    <span key={key} class="diff-change">
      {active ? (
        <>
          {change.original !== '' && (
            <del class={`diff-del${change.lossy ? ' lossy' : ''}`}>{change.original}</del>
          )}
          {change.replacement !== '' && <ins class="diff-ins">{change.replacement}</ins>}
        </>
      ) : (
        change.original !== '' && <mark class="diff-undone">{change.original}</mark>
      )}
      <button
        type="button"
        class="diff-toggle"
        title={why}
        aria-label={label}
        onClick={() => onToggleChange(key)}
      >
        {active ? '↺' : '↻'}
      </button>
    </span>
  );
}
