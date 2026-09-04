/**
 * The Phase 5 acceptance criterion, measured over the 30-prompt corpus of
 * Phase 2: "critical constraints preserved ≥ 98% after repair".
 *
 * **What this measures, precisely.** There are no API keys in CI, so no real
 * model runs here. The provider is a *simulator* whose losses and repairs are
 * calibrated by hand, and what the number therefore measures is the
 * pipeline's contribution: how much of a realistic loss the two-attempt repair
 * loop recovers. It is not a measurement of Claude, GPT or Gemini, and
 * docs/PLAN.md §6.6 records that the real-model number is still owed — Phase 6
 * owns the reproducible benchmark that can spend real tokens.
 *
 * The simulator is deliberately imperfect on both sides:
 *
 *  - the compressor deletes the sentence of one in every 15 critical
 *    constraints;
 *  - the repairer fumbles the first constraint of its first attempt, and
 *    there is a fixed 1-in-20 subset it can never place at all.
 *
 * Measured over the 30 prompts (386 critical constraints): **99.74%
 * preserved (385/386) after two attempts, 93.01% after one.** The assertions
 * below encode both numbers, so lowering `MAX_REPAIRS` to 1 fails this suite —
 * which is what makes it a regression test on the loop rather than a
 * tautology.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractConstraints, isCritical, restoreConstraint, verifyConstraints } from '../src/core';
import type { Constraint } from '../src/core';
import {
  compressSystemPrompt,
  formatLedger,
  runAiPipeline,
  verifyUserPrompt,
} from '../src/providers';
import type { ProviderClient, StructuredResponse } from '../src/providers';

const CORPUS_DIR = join(import.meta.dirname, '..', 'bench', 'corpus', 'phase2');

const PROMPTS: { id: string; text: string; constraints: Constraint[] }[] = readdirSync(CORPUS_DIR)
  .filter((file) => file.endsWith('.md') && file !== 'README.md')
  .sort()
  .map((file) => {
    const text = readFileSync(join(CORPUS_DIR, file), 'utf8');
    return { id: file.replace(/\.md$/, ''), text, constraints: extractConstraints(text) };
  });

/** One in every `DROP_EVERY` critical constraints is dropped by the compressor. */
const DROP_EVERY = 15;

function victimsOf(constraints: readonly Constraint[]): Constraint[] {
  return constraints.filter(isCriticalConstraint).filter((_, index) => index % DROP_EVERY === 0);
}

function isCriticalConstraint(constraint: Constraint): boolean {
  return isCritical(constraint.type);
}

/** A stable 1-in-20 subset the simulated repairer never manages to restore. */
function isUnrepairable(constraint: Constraint): boolean {
  let hash = 0;
  for (const char of constraint.id) hash = (hash * 31 + char.charCodeAt(0)) % 1000;
  return hash % 20 === 0;
}

/** Remove the sentences carrying `victims`, the way a lossy model would. */
function dropSentences(text: string, victims: readonly Constraint[]): string {
  const ranges = victims
    .map((c) => [c.sentenceStart, c.sentenceEnd] as const)
    .sort((a, b) => b[0] - a[0]);
  let out = text;
  let previousStart = Number.POSITIVE_INFINITY;
  for (const [start, end] of ranges) {
    // Several constraints can share a sentence; cut it once.
    if (end > previousStart) continue;
    out = out.slice(0, start) + out.slice(end);
    previousStart = start;
  }
  return out;
}

/**
 * A provider that compresses by deleting sentences and repairs by putting some
 * of them back. `restoreConstraint` (Phase 2) stands in for the model's
 * re-insertion so the repaired text is realistic rather than hand-written.
 */
function simulator(original: string, constraints: readonly Constraint[]) {
  let repairCalls = 0;

  const provider: ProviderClient = {
    id: 'anthropic',
    label: 'Simulated',
    models: ['claude-opus-5', 'claude-haiku-4-5'],
    defaultModel: 'claude-opus-5',
    defaultVerifierModel: 'claude-haiku-4-5',
    keyLabel: 'key',
    keyPlaceholder: '',
    keyHelpUrl: 'https://example.invalid',
    async complete(request): Promise<StructuredResponse> {
      const usage = { inputTokens: 0, outputTokens: 0 };

      if (request.schemaName === 'promptrim_compression') {
        const victims = victimsOf(constraints);
        const victimIds = new Set(victims.map((c) => c.id));
        return {
          data: {
            compressed: dropSentences(original, victims),
            kept: constraints.filter((c) => !victimIds.has(c.id)).map((c) => c.id),
            dropped: [...victimIds],
          },
          usage,
          model: 'sim',
        };
      }

      if (request.schemaName === 'promptrim_verification') {
        // An honest verifier: it agrees with the local one, which is the
        // conservative case — it adds no repairs of its own.
        const compressed = between(request.user, '<compressed>', '</compressed>');
        const report = verifyConstraints(original, compressed, constraints);
        return {
          data: {
            results: report.checks.map((check) => ({
              id: check.constraint.id,
              preserved: check.preserved,
              evidence: check.preserved ? (check.evidence ?? '') : '',
            })),
          },
          usage,
          model: 'sim',
        };
      }

      repairCalls += 1;
      const compressed = between(request.user, '<compressed>', '</compressed>');
      const asked = constraints.filter((c) => request.user.includes(`[${c.id}]`));
      // Two failure modes, both deliberate: the first attempt always fumbles
      // its first constraint (so a second attempt has work to do), and one
      // constraint in twenty is one this repairer can never place (so the
      // final rate is not a trivial 100%).
      const willRestore = asked.filter(
        (constraint, index) => !(repairCalls === 1 && index === 0) && !isUnrepairable(constraint),
      );
      let repaired = compressed;
      for (const constraint of willRestore) {
        repaired = restoreConstraint(original, repaired, constraint);
      }
      return {
        data: { compressed: repaired, reinserted: willRestore.map((c) => c.id) },
        usage,
        model: 'sim',
      };
    },
  };

  return provider;
}

function between(text: string, open: string, close: string): string {
  const start = text.indexOf(open);
  const end = text.indexOf(close);
  if (start < 0 || end < 0) return text;
  return text.slice(start + open.length, end).trim();
}

async function measure(maxRepairs: number) {
  let criticalTotal = 0;
  let criticalPreserved = 0;

  for (const entry of PROMPTS) {
    const result = await runAiPipeline(entry.text, {
      provider: simulator(entry.text, entry.constraints),
      apiKey: 'test',
      level: 'balanced',
      compressModel: 'claude-opus-5',
      verifyModel: 'claude-haiku-4-5',
      constraints: entry.constraints,
      maxRepairs,
    });
    criticalTotal += result.report.criticalTotal;
    criticalPreserved += result.report.criticalPreserved;
  }

  return { criticalTotal, criticalPreserved, rate: criticalPreserved / criticalTotal };
}

describe('AI pipeline over the Phase 2 corpus (simulated provider)', () => {
  it('has a corpus worth measuring', () => {
    expect(PROMPTS).toHaveLength(30);
    const critical = PROMPTS.reduce(
      (total, entry) => total + entry.constraints.filter((c) => isCritical(c.type)).length,
      0,
    );
    expect(critical).toBeGreaterThan(300);
  });

  it('preserves ≥ 98% of critical constraints after repair', async () => {
    const { rate, criticalTotal, criticalPreserved } = await measure(2);
    expect(criticalTotal).toBeGreaterThan(300);
    expect(
      rate,
      `${criticalPreserved}/${criticalTotal} critical constraints preserved`,
    ).toBeGreaterThanOrEqual(0.98);
  }, 60_000);

  it('would not clear the bar with a single repair attempt', async () => {
    // Guards the constant: dropping MAX_REPAIRS to 1 must fail this suite,
    // otherwise the test above proves nothing about the loop.
    const one = await measure(1);
    const two = await measure(2);
    expect(one.rate).toBeLessThan(two.rate);
    expect(one.rate).toBeLessThan(0.98);
  }, 60_000);

  it('leaves the compression call worse off than the repaired result', async () => {
    // The simulator's first pass is lossy by construction; this is the
    // baseline the loop is measured against.
    const entry = PROMPTS[0]!;
    const victims = victimsOf(entry.constraints);
    expect(victims.length).toBeGreaterThan(0);
    const lossy = dropSentences(entry.text, victims);
    const before = verifyConstraints(entry.text, lossy, entry.constraints);
    expect(before.criticalLost.length).toBeGreaterThan(0);
  });
});

describe('the ledger reaches the model', () => {
  it('names every constraint id in the compression system prompt', () => {
    for (const entry of PROMPTS.slice(0, 5)) {
      const prompt = compressSystemPrompt('aggressive', entry.constraints);
      for (const constraint of entry.constraints) {
        expect(prompt).toContain(`[${constraint.id}]`);
      }
    }
  });

  it('marks critical constraints as critical', () => {
    const entry = PROMPTS.find((p) => p.constraints.some((c) => isCritical(c.type)))!;
    const ledger = formatLedger(entry.constraints);
    const critical = entry.constraints.find((c) => isCritical(c.type))!;
    expect(ledger).toContain(`[${critical.id}] (${critical.type}, CRITICAL)`);
  });

  it('carries the protection rules that Fast mode enforces locally', () => {
    const prompt = compressSystemPrompt('aggressive', []);
    for (const fragment of [
      'fenced code',
      'quotation marks',
      'URLs',
      '{{name}}',
      'markdown tables',
    ]) {
      expect(prompt).toContain(fragment);
    }
  });

  it('gives the auditor both prompts and the ledger', () => {
    const entry = PROMPTS[0]!;
    const user = verifyUserPrompt(entry.text, 'compressed text', entry.constraints);
    expect(user).toContain('<original>');
    expect(user).toContain('<compressed>');
    expect(user).toContain('compressed text');
    expect(user).toContain(`[${entry.constraints[0]!.id}]`);
  });

  it('states the level policy the user picked', () => {
    expect(compressSystemPrompt('light', [])).toContain('LIGHT');
    expect(compressSystemPrompt('balanced', [])).toContain('BALANCED');
    expect(compressSystemPrompt('aggressive', [])).toContain('AGGRESSIVE');
  });
});
