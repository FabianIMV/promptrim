# Phase 2 corpus — annotated constraints

30 system prompts with their constraints annotated by hand, used to measure the
precision and recall of `src/core/ledger/extract.ts`.

## Layout

| File | Content |
|------|---------|
| `NN-slug.md` | The prompt, exactly as the extractor sees it. |
| `NN-slug.constraints.json` | Its annotation: `{ id, category, source, constraints[] }`. |

Each annotated constraint is `{ "type": <ConstraintType>, "anchor": <substring of the prompt> }`.
Severity is not annotated: it is derived from the type by `severityFor()`.

## How the prompts were produced

They are **hand-written**, modelled on the patterns that public system prompts
use for each job (coding agents, RAG, support, extraction, moderation,
writing, tooling). They are not copies of anyone's prompt: reproducing real
prompts verbatim would put third-party text under this repository's licence for
no measurement benefit. The `source` field of every annotation says what the
prompt was modelled on.

Categories covered: `agent`, `code`, `rag`, `support`, `data`, `classification`,
`extraction`, `safety`, `writing`, `education`, `hr`, `consumer`.

## What is annotated, and what is not

The annotation is **exhaustive for the six `critical` types** — `prohibition`,
`requirement`, `format`, `quantity`, `literal`, `variable` — because those are
the ones the acceptance criterion measures and the ones that block compression
at Aggressive. The `minor` types (`instruction`, `entity`, `example`) appear in
a few files where they were obvious, but they are **not** exhaustive and are
excluded from the metric; scoring them would measure the annotation, not the
extractor.

Anchors are annotated the way the extractor is specified to anchor them: at the
marker, not at the subject. "You must cite a source" is annotated as
`must cite a source`, because the ledger's job is to notice that the *demand*
survived, and the subject in front of the marker is not part of it.

## Metric

An annotation matches an extracted constraint when the types are equal and one
anchor's normalised tokens contain the other's (`reduceToTokens` +
`containsTokens`). Containment rather than equality: the extractor may take a
wider clause than the annotator wrote, as long as the demand is inside it.

Measured by `test/ledger-corpus.test.ts` on 2026-09-03:

| type | annotated | recall | extracted | precision |
|---|---|---|---|---|
| prohibition | 92 | 100.0% | 96 | 96.9% |
| requirement | 58 | 100.0% | 76 | 81.6% |
| format | 66 | 98.5% | 87 | 81.6% |
| quantity | 23 | 91.3% | 35 | 62.9% |
| literal | 61 | 98.4% | 62 | 100.0% |
| variable | 27 | 100.0% | 30 | 100.0% |
| **total** | **327** | **98.8%** | **386** | **88.1%** |

Recall is the number the product is optimised for: a constraint the extractor
never inventoried is a constraint nobody will notice losing. Precision costs
compression (a spurious constraint can veto a legal change at Aggressive) but
never correctness, so it is held to a lower bar. The `quantity` figure is the
weakest of the six: the boundary between "a number that shapes the output"
(`format`) and "a number that is data" (`quantity`) is a labelling convention,
and both sides of it are `critical` and verified identically.

The corpus also backs two stronger assertions in the same test file:

- deleting any critical constraint's sentence — or just its anchor — from the
  output always produces a ✗, never a ✓ (no false "preserved");
- the shipped rule set needs no ledger veto on any of the 30 prompts at
  Aggressive, and loses no constraint at any level.
