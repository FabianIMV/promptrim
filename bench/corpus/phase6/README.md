# Phase 6 corpus — everyday verbose prompts

`bench/corpus/phase0/` and `bench/corpus/phase2/` are regression fixtures:
phase 0 deliberately hides filler *inside* protected regions to prove it is
never touched, and phase 2 is annotated system prompts written to measure the
constraint extractor, not to be wordy. Benchmarking compression on either one
alone under-states what Fast mode does on what people actually paste — a
one-off request, not a production system prompt.

These 10 prompts are hand-written in the voice of a typical chat request:
padded with politeness framing, hedges, and bureaucratic phrasing a person
types without thinking about it. They are not copied from anyone; each is
original, modelled on common everyday asks (blog posts, code review, email,
meeting notes, docs, support replies, itineraries, resumes, product copy,
data summaries). `bench/run.ts` includes this directory alongside phase 0 and
phase 2 so the published benchmark reflects both extremes — prompts engineered
to resist compression, and prompts that were never engineered at all — rather
than only the one that happens to compress the least.
