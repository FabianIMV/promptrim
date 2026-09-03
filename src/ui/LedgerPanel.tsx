import { useMemo } from 'preact/hooks';
import { CONSTRAINT_TYPES, TYPE_LABELS } from '../core';
import type { BlockedChange, Constraint, ConstraintCheck, ConstraintType, Ledger } from '../core';

interface Props {
  ledger: Ledger;
  /** Changes the ledger reverted, so the user can see why Aggressive stopped. */
  blocked: BlockedChange[];
  onRestore: (constraint: Constraint) => void;
}

const MAX_ANCHOR_CHARS = 90;

export function LedgerPanel({ ledger, blocked, onRestore }: Props) {
  const { report, duplicates } = ledger;

  const groups = useMemo(() => {
    const byType = new Map<ConstraintType, ConstraintCheck[]>();
    for (const check of report.checks) {
      const list = byType.get(check.constraint.type) ?? [];
      list.push(check);
      byType.set(check.constraint.type, list);
    }
    return CONSTRAINT_TYPES.filter((type) => byType.has(type)).map((type) => ({
      type,
      checks: byType.get(type)!,
    }));
  }, [report]);

  if (report.total === 0) return null;

  const allKept = report.lost.length === 0;

  return (
    <section class="ledger" aria-labelledby="ledger-heading">
      <header class="ledger-header">
        <h2 id="ledger-heading" class="ledger-title">
          Verification
        </h2>
        <span class={`ledger-count${allKept ? ' ok' : ' bad'}`}>
          {report.preserved}/{report.total} constraints preserved
        </span>
        <span class="ledger-sub">
          {report.criticalPreserved}/{report.criticalTotal} critical
        </span>
      </header>

      {allKept ? (
        <p class="ledger-note">
          Every constraint found in your prompt is still present in the compressed version.
        </p>
      ) : (
        <p class="ledger-note bad">
          {report.lost.length} constraint{report.lost.length === 1 ? '' : 's'} could not be found in
          the output. Restore the ones you need.
        </p>
      )}

      {groups.map((group) => (
        <div key={group.type} class="ledger-group">
          <h3 class="ledger-group-title">
            {TYPE_LABELS[group.type]}{' '}
            <span class="ledger-group-count">
              {group.checks.filter((c) => c.preserved).length}/{group.checks.length}
            </span>
          </h3>
          <ul class="ledger-list">
            {group.checks.map((check) => (
              <li key={check.constraint.id} class={check.preserved ? 'kept' : 'lost'}>
                <span class="ledger-mark" aria-hidden="true">
                  {check.preserved ? '✓' : '✗'}
                </span>
                <span class="ledger-anchor" title={check.evidence ?? check.constraint.label}>
                  <span class="sr-only">{check.preserved ? 'Preserved: ' : 'Lost: '}</span>
                  {truncate(check.constraint.anchor)}
                </span>
                {!check.preserved && (
                  <button
                    type="button"
                    class="ledger-restore"
                    onClick={() => onRestore(check.constraint)}
                  >
                    Restore
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}

      {blocked.length > 0 && (
        <div class="ledger-group">
          <h3 class="ledger-group-title">Blocked by the ledger</h3>
          <p class="ledger-note">
            {blocked.length} change{blocked.length === 1 ? ' was' : 's were'} reverted because
            {blocked.length === 1 ? ' it' : ' they'} would have dropped a critical constraint.
          </p>
          <ul class="ledger-list">
            {blocked.map((change) => (
              <li key={`${change.ruleId}:${change.start}`} class="blocked">
                <span class="ledger-mark" aria-hidden="true">
                  ⛔
                </span>
                <span class="ledger-anchor">
                  <code>{change.ruleId}</code> · {truncate(change.original)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {duplicates.length > 0 && (
        <div class="ledger-group">
          <h3 class="ledger-group-title">Possible duplicated instructions</h3>
          <p class="ledger-note">
            The same demand appears more than once. Nothing was merged — review and decide.
          </p>
          <ul class="ledger-list">
            {duplicates.map((group) => (
              <li key={group.members[0]!.id} class="duplicate">
                <span class="ledger-mark" aria-hidden="true">
                  ⧉
                </span>
                <span class="ledger-anchor">
                  {group.members.length} statements ·{' '}
                  {group.members.map((m) => truncate(m.anchor, 40)).join('  ⟷  ')}
                  <em class="ledger-suggestion">Suggested wording: {truncate(group.suggestion)}</em>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function truncate(text: string, max = MAX_ANCHOR_CHARS): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}
