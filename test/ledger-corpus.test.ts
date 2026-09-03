import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compress } from '../src/core/compress';
import { findProtectedRanges } from '../src/core/segment';
import { LEVELS } from '../src/core/rules';
import {
  containsTokens,
  CONSTRAINT_TYPES,
  CRITICAL_TYPES,
  extractConstraints,
  reduceToTokens,
  verifyConstraints,
} from '../src/core/ledger';
import type { Constraint, ConstraintType } from '../src/core/ledger';

const CORPUS_DIR = join(import.meta.dirname, '..', 'bench', 'corpus', 'phase2');

interface Annotation {
  id: string;
  category: string;
  source: string;
  constraints: { type: ConstraintType; anchor: string }[];
}

interface Entry {
  annotation: Annotation;
  prompt: string;
  constraints: Constraint[];
}

const ENTRIES: Entry[] = readdirSync(CORPUS_DIR)
  .filter((f) => f.endsWith('.constraints.json'))
  .sort()
  .map((file) => {
    const annotation = JSON.parse(readFileSync(join(CORPUS_DIR, file), 'utf8')) as Annotation;
    const prompt = readFileSync(join(CORPUS_DIR, `${annotation.id}.md`), 'utf8');
    return { annotation, prompt, constraints: extractConstraints(prompt) };
  });

/**
 * An annotation matches an extracted constraint when the types agree and one
 * anchor contains the other, compared on the ledger's own normalised tokens.
 * Containment (rather than equality) is what the product needs: the extractor
 * may take a wider clause than the annotator wrote, as long as the demand is
 * inside it.
 */
function matches(gold: { type: ConstraintType; anchor: string }, found: Constraint): boolean {
  if (gold.type !== found.type) return false;
  const a = reduceToTokens(gold.anchor);
  const b = reduceToTokens(found.anchor);
  return containsTokens(b, a) || containsTokens(a, b);
}

const criticalOf = <T extends { type: ConstraintType }>(items: T[]): T[] =>
  items.filter((c) => CRITICAL_TYPES.includes(c.type));

describe('phase-2 corpus: shape', () => {
  it('ships at least 30 annotated prompts', () => {
    expect(ENTRIES.length).toBeGreaterThanOrEqual(30);
  });

  it('covers more than one kind of prompt', () => {
    const categories = new Set(ENTRIES.map((e) => e.annotation.category));
    expect(categories.size).toBeGreaterThanOrEqual(6);
  });

  for (const { annotation, prompt } of ENTRIES) {
    describe(annotation.id, () => {
      it('has a non-empty prompt and a documented provenance', () => {
        expect(prompt.trim().length).toBeGreaterThan(100);
        expect(annotation.source.length).toBeGreaterThan(10);
      });

      it('annotates only known types and non-empty anchors', () => {
        expect(annotation.constraints.length).toBeGreaterThan(0);
        for (const c of annotation.constraints) {
          expect(CONSTRAINT_TYPES).toContain(c.type);
          expect(prompt, `${annotation.id}: ${c.anchor}`).toContain(c.anchor);
        }
      });
    });
  }
});

/**
 * docs/PLAN.md, Phase 2 acceptance: "recall >= 90% on `critical` constraints
 * over the annotated corpus". Precision is measured and asserted at a lower
 * bar: over-reporting a constraint costs a little compression, under-reporting
 * one costs the product's whole promise.
 */
describe('phase-2 corpus: extractor accuracy on critical constraints', () => {
  let truePositives = 0;
  let goldTotal = 0;
  let foundTotal = 0;
  let matchedFound = 0;
  const perType = new Map<ConstraintType, { gold: number; hit: number }>();

  for (const { annotation, constraints } of ENTRIES) {
    const gold = criticalOf(annotation.constraints);
    const found = criticalOf(constraints);
    goldTotal += gold.length;
    foundTotal += found.length;
    for (const g of gold) {
      const hit = found.some((f) => matches(g, f));
      if (hit) truePositives++;
      const bucket = perType.get(g.type) ?? { gold: 0, hit: 0 };
      bucket.gold++;
      if (hit) bucket.hit++;
      perType.set(g.type, bucket);
    }
    for (const f of found) {
      if (gold.some((g) => matches(g, f))) matchedFound++;
    }
  }

  it('measures a corpus large enough to mean something', () => {
    expect(goldTotal).toBeGreaterThanOrEqual(250);
  });

  it('reaches at least 90% recall on critical constraints', () => {
    expect(truePositives / goldTotal).toBeGreaterThanOrEqual(0.9);
  });

  it('keeps precision on critical constraints above 70%', () => {
    expect(matchedFound / foundTotal).toBeGreaterThanOrEqual(0.7);
  });

  for (const type of CRITICAL_TYPES) {
    it(`reaches at least 80% recall on ${type} constraints`, () => {
      const bucket = perType.get(type);
      expect(bucket, `no ${type} constraints annotated`).toBeDefined();
      expect(bucket!.hit / bucket!.gold).toBeGreaterThanOrEqual(0.8);
    });
  }
});

/**
 * The acceptance criterion that matters most: "0 false `preserved` when the
 * sentence was deleted". Every critical constraint in the corpus is removed
 * from the output, one at a time, and must come back as ✗.
 */
describe('phase-2 corpus: a deleted constraint is never reported as preserved', () => {
  for (const { annotation, prompt, constraints } of ENTRIES) {
    const critical = criticalOf(constraints);

    it(`${annotation.id}: reports every deleted sentence as lost (${critical.length} constraints)`, () => {
      const survivors: string[] = [];
      for (const constraint of critical) {
        const withoutSentence =
          prompt.slice(0, constraint.sentenceStart) + prompt.slice(constraint.sentenceEnd);
        if (verifyConstraints(prompt, withoutSentence, [constraint]).clean) {
          survivors.push(`${constraint.id} ${JSON.stringify(constraint.anchor)}`);
        }
      }
      expect(survivors).toEqual([]);
    });

    it(`${annotation.id}: reports every deleted anchor as lost`, () => {
      const survivors: string[] = [];
      for (const constraint of critical) {
        const withoutAnchor = prompt.slice(0, constraint.start) + prompt.slice(constraint.end);
        if (verifyConstraints(prompt, withoutAnchor, [constraint]).clean) {
          survivors.push(`${constraint.id} ${JSON.stringify(constraint.anchor)}`);
        }
      }
      expect(survivors).toEqual([]);
    });
  }
});

describe('phase-2 corpus: compression stays inside the ledger', () => {
  for (const { annotation, prompt } of ENTRIES) {
    it.each(LEVELS)(`${annotation.id}: no constraint is lost at %s`, (level) => {
      const { output } = compress(prompt, level);
      const report = verifyConstraints(prompt, output, extractConstraints(prompt));
      expect(report.criticalLost.map((c) => c.constraint.anchor)).toEqual([]);
    });

    it(`${annotation.id}: the shipped rules need no ledger veto at aggressive`, () => {
      // The rule set is safe by construction (Section 2 policy); a blocked
      // change here would mean a rule started deleting instruction content.
      expect(compress(prompt, 'aggressive').blocked).toEqual([]);
    });

    it(`${annotation.id}: protected regions are reproduced verbatim`, () => {
      const output = compress(prompt, 'aggressive').output;
      for (const range of findProtectedRanges(prompt)) {
        expect(output, `${annotation.id} @ ${range.kind}`).toContain(
          prompt.slice(range.start, range.end),
        );
      }
    });
  }
});
