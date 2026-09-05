/**
 * Diff view — built from `Change[]`, never from comparing strings.
 *
 * `compress()` already carries the exact offsets, rule id and lossy flag of
 * every rewrite; the diff is a straight projection of that list against the
 * original text, plus the changes the ledger reverted (`BlockedChange[]`),
 * which live in the same coordinate space (offsets into the original) even
 * though they were never applied. Comparing the two output strings instead
 * would lose the rule that produced each change and could not tell a revert
 * apart from a coincidentally-identical rewrite.
 *
 * `projectDiff` re-derives the displayed output when the user turns a change
 * off: since it is `applyChanges` over a subset of the same `Change[]`, an
 * "undo all" always reproduces the original byte for byte — the identity is
 * structural, not something the UI has to get right on its own.
 */

import { applyChanges } from './compress';
import type { BlockedChange, Change } from './compress';

/** Stable within one `CompressResult`: changes are non-overlapping, so `start` alone would do, but the full key stays legible in the DOM and in tests. */
export function changeKey(change: Change): string {
  return `${change.ruleId}:${change.start}:${change.end}`;
}

export interface TextItem {
  kind: 'text';
  start: number;
  end: number;
  text: string;
}

export interface ChangeItem {
  kind: 'change';
  key: string;
  change: Change;
  /** `false` once the user has turned this change off. */
  active: boolean;
}

export interface BlockedItem {
  kind: 'blocked';
  key: string;
  change: BlockedChange;
}

export type DiffItem = TextItem | ChangeItem | BlockedItem;

/**
 * Re-derive the compressed output for a subset of `changes`: the ones whose
 * key is in `disabled` are treated as undone. An empty `changes` array, or
 * `disabled` covering every key, both reduce to `original` — `applyChanges`
 * with nothing to apply returns its input unchanged.
 */
export function projectDiff(
  original: string,
  changes: readonly Change[],
  disabled: ReadonlySet<string>,
): string {
  const active = changes.filter((c) => !disabled.has(changeKey(c)));
  return applyChanges(original, active);
}

/**
 * Interleave `original` with `changes` (each tagged active/undone per
 * `disabled`) and `blocked` (always inactive — the ledger reverted them
 * before they ever reached the output) into a single ordered sequence a diff
 * view can render directly. `changes` and `blocked` are both drawn from the
 * same non-overlapping selection inside `compress()`, so the merge never has
 * to resolve overlaps.
 */
export function buildDiffItems(
  original: string,
  changes: readonly Change[],
  blocked: readonly BlockedChange[] = [],
  disabled: ReadonlySet<string> = new Set(),
): DiffItem[] {
  const marked: (ChangeItem | BlockedItem)[] = [
    ...changes.map((change): ChangeItem => ({
      kind: 'change',
      key: changeKey(change),
      change,
      active: !disabled.has(changeKey(change)),
    })),
    ...blocked.map((change): BlockedItem => ({
      kind: 'blocked',
      key: `blocked:${changeKey(change)}`,
      change,
    })),
  ].sort((a, b) => a.change.start - b.change.start);

  const items: DiffItem[] = [];
  let cursor = 0;
  for (const item of marked) {
    if (item.change.start > cursor) {
      items.push({
        kind: 'text',
        start: cursor,
        end: item.change.start,
        text: original.slice(cursor, item.change.start),
      });
    }
    items.push(item);
    cursor = Math.max(cursor, item.change.end);
  }
  if (cursor < original.length) {
    items.push({ kind: 'text', start: cursor, end: original.length, text: original.slice(cursor) });
  }
  return items;
}
