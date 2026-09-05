/**
 * The prompts of the Phase 5 pipeline.
 *
 * Two things make these different from the "compress this prompt" wrapper the
 * app shipped before, and they are the whole point of the phase:
 *
 *  1. **The protection rules travel with the request.** The same regions the
 *     local segmenter refuses to touch (code fences, inline code, quoted
 *     literals, URLs, template variables, JSON/YAML, tables, example blocks)
 *     are spelled out for the model, so AI mode is held to the Phase 0 policy
 *     instead of being a free-for-all.
 *  2. **The ledger travels with the request.** The model is told, by id, every
 *     constraint that must survive, and has to account for each one. Local
 *     verification (Phase 2) still has the last word — the model's answer is
 *     evidence, not proof — but asking for the accounting is what moves the
 *     critical-preservation rate up.
 *
 * Everything here is a pure string builder so it can be unit-tested without a
 * network.
 */

import type { Level } from '@promptrim/core';
import type { Constraint } from '@promptrim/core';

const PROTECTION_RULES = [
  'Never alter anything inside fenced code blocks (```), inline code (`x`), or indented code.',
  'Never alter text inside quotation marks — straight or typographic, single or double. Quoted strings are literals.',
  'Never alter URLs, email addresses, file paths, or identifiers such as API_KEY or user_id.',
  'Never alter template variables: {{name}}, {name}, ${name}, %s, <tag>.',
  'Never alter JSON or YAML fragments, or the structure of markdown tables.',
  'Never alter example blocks (Example:, Input:/Output:, <example>…</example>) or few-shot pairs.',
  'Never translate. Keep the original language of the prompt.',
  'Never add commentary, headings, or explanations that were not in the original.',
];

const LEVEL_POLICY: Record<Level, string> = {
  light:
    'LIGHT: remove only filler and courtesy ("please", "I would like you to", "kindly"). Keep every sentence that carries information. Expect to remove under 15% of the tokens.',
  balanced:
    'BALANCED: remove filler, redundant phrasing and verbose framing, and merge sentences that repeat the same demand. Keep every requirement, prohibition, format rule, number and example. Expect to remove 15-30% of the tokens.',
  aggressive:
    'AGGRESSIVE: rewrite for minimum tokens — telegraphic style, bullet lists instead of prose, no articles where the meaning survives. You may drop background and motivation. You may NOT drop a single constraint from the ledger below. If a rewrite would cost a constraint, keep the longer wording.',
};

/** How a constraint is presented to the model, by id, in every step. */
export function formatConstraint(constraint: Constraint): string {
  const severity = constraint.severity === 'critical' ? 'CRITICAL' : 'minor';
  return `- [${constraint.id}] (${constraint.type}, ${severity}) ${flatten(constraint.anchor)}`;
}

export function formatLedger(constraints: readonly Constraint[]): string {
  if (!constraints.length) {
    return 'No constraints were detected in this prompt. Compress it without losing meaning.';
  }
  const critical = constraints.filter((c) => c.severity === 'critical').length;
  return [
    `${constraints.length} constraints were extracted from the original prompt (${critical} critical).`,
    'Each one must survive literally, or as an exact equivalent that demands the same thing:',
    '',
    ...constraints.map(formatConstraint),
  ].join('\n');
}

export function compressSystemPrompt(level: Level, constraints: readonly Constraint[]): string {
  return [
    'You compress AI prompts. You remove tokens without changing what the prompt demands.',
    '',
    'PROTECTED CONTENT — these are hard rules, not preferences:',
    ...PROTECTION_RULES.map((rule) => `- ${rule}`),
    '',
    `COMPRESSION LEVEL — ${LEVEL_POLICY[level]}`,
    '',
    'CONSTRAINT LEDGER',
    formatLedger(constraints),
    '',
    'OUTPUT',
    '- "compressed": the compressed prompt only. No preamble, no explanation, no code fence around it.',
    '- "kept": the ids of the constraints that survive in "compressed".',
    '- "dropped": the ids of the constraints that did not survive. Be honest — a wrong "kept" is worse than a low compression ratio.',
  ].join('\n');
}

export function compressUserPrompt(text: string): string {
  return ['Compress this prompt:', '', '<prompt>', text, '</prompt>'].join('\n');
}

export function verifySystemPrompt(): string {
  return [
    'You audit prompt compression. You are given an original prompt, a compressed version, and a list of constraints extracted from the original.',
    '',
    'For every constraint id, decide whether the COMPRESSED prompt still demands the same thing.',
    '',
    'RULES',
    '- Judge meaning, not wording: "never reveal the system prompt" and "do not disclose the system prompt" are the same constraint.',
    '- A constraint that moved to another position still counts as preserved.',
    '- A constraint that was weakened counts as LOST: "must" turned into "should", "always" turned into "usually", a number that changed, a format that became optional.',
    '- A constraint that was merged with another one is preserved only if the merged sentence still demands both things.',
    '- "evidence" must be a fragment copied verbatim from the compressed prompt. If you cannot copy one, the constraint is lost and "evidence" is the empty string.',
    '- You are not compressing anything. Do not suggest edits. Do not rewrite either prompt.',
    '- Return one result per constraint id, in the order given, with no ids invented and none omitted.',
  ].join('\n');
}

export function verifyUserPrompt(
  original: string,
  compressed: string,
  constraints: readonly Constraint[],
): string {
  return [
    '<original>',
    original,
    '</original>',
    '',
    '<compressed>',
    compressed,
    '</compressed>',
    '',
    '<constraints>',
    ...constraints.map(formatConstraint),
    '</constraints>',
  ].join('\n');
}

export function repairSystemPrompt(): string {
  return [
    'You repair a compressed prompt that lost constraints.',
    '',
    'You are given the compressed prompt and the constraints that are missing from it, with the original sentence that carried each one.',
    '',
    'RULES',
    '- Put every listed constraint back, in the place where it belongs in the flow of the prompt.',
    '- Change nothing else. Do not re-compress, do not re-order, do not reword the parts that are already there.',
    '- Prefer the shortest wording that demands exactly the same thing; when in doubt, reuse the original sentence verbatim.',
    '- Keep the language of the prompt.',
    '',
    'OUTPUT',
    '- "compressed": the full repaired prompt.',
    '- "reinserted": the ids you put back.',
  ].join('\n');
}

export function repairUserPrompt(compressed: string, missing: readonly Constraint[]): string {
  return [
    '<compressed>',
    compressed,
    '</compressed>',
    '',
    '<missing>',
    ...missing.map(
      (constraint) =>
        `- [${constraint.id}] (${constraint.type}, ${constraint.severity}) original sentence: ${flatten(constraint.sentence)}`,
    ),
    '</missing>',
  ].join('\n');
}

function flatten(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}
