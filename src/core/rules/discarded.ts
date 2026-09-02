/**
 * Legacy rules that were deliberately NOT ported from `app.js`.
 *
 * Section 0 (row 3) of docs/PLAN.md documents that the old engine deleted
 * instructions. This list is the audit trail: every entry names the legacy
 * pattern and why it is unsafe, so a future session does not "restore" it by
 * accident. It is exercised by a test that asserts none of these behaviours
 * exist in the shipped rule set.
 */
export interface DiscardedRule {
  /** The legacy construct that was removed. */
  legacy: string;
  reason: string;
  /** A prompt where the legacy rule destroyed meaning. */
  example: string;
}

export const DISCARDED_RULES: DiscardedRule[] = [
  {
    legacy: '/\\bstep[- ]by[- ]step\\s*/gi → ""',
    reason: '"step by step" is an instruction that changes model behaviour (it elicits reasoning).',
    example: 'Solve the problem step by step.',
  },
  {
    legacy: '/\\b(make sure to|ensure that|be sure to)\\b\\s*/gi → ""',
    reason: 'These introduce requirements. Removing them turns a requirement into a suggestion.',
    example: 'Make sure to validate the input before sending.',
  },
  {
    legacy: '/\\b(...|always|often)\\b\\s*/gi → ""',
    reason:
      'Frequency words are requirement strength. "Always answer in JSON" is not "Answer in JSON".',
    example: 'Always answer in JSON.',
  },
  {
    legacy: '/\\b(note that|keep in mind that|bear in mind that)\\b\\s*/gi → ""',
    reason: 'These frequently introduce a constraint the model must respect.',
    example: 'Note that ids must be UUID v4.',
  },
  {
    legacy: '/\\b(comprehensive|thorough|complete|extensive|detailed|in-depth)\\s+.../gi → ""',
    reason: 'These adjectives are output requirements about depth, not filler.',
    example: 'Write a detailed analysis.',
  },
  {
    legacy: 'duplicate-sentence dedup (split on /(?<=[.!?])\\s+/, drop repeats)',
    reason:
      'Silently deleting sentences is exactly the failure mode PromptTrim exists to prevent. Duplicate instructions are surfaced for merging in Phase 2, never dropped.',
    example: 'Answer in JSON. Do not add prose. Answer in JSON.',
  },
  {
    legacy: '/\\b(feel free to)\\b\\s*/gi → ""',
    reason: 'Removing it converts an option into a command, changing behaviour.',
    example: 'Feel free to ask a clarifying question.',
  },
  {
    legacy: '/\\b(if possible|if you can|if you are able to),?\\s*/gi → ""',
    reason: 'Same as above: it removes the conditionality of an instruction.',
    example: 'If possible, cite the source.',
  },
  {
    legacy: '/\\n?(Thanks?\\.?|Thank you\\.?)\\s*$/gi → ""',
    reason: 'Section 2 forbids deleting whole sentences; the saving is negligible.',
    example: 'Summarise the ticket.\nThank you.',
  },
  {
    legacy: '/\\b(in a (clear|concise|detailed|...) (manner|way|format))\\b/gi → ""',
    reason: 'This phrase states an output format requirement.',
    example: 'Respond in a structured format.',
  },
  {
    legacy: '/\\bthe following are\\b/gi → ""',
    reason: 'Removing the plural form leaves an ungrammatical fragment.',
    example: 'The following are the rules:',
  },
  {
    legacy: '/\\byou are (tasked|asked|requested|required) (to |with )/gi → ""',
    reason:
      'Only the "you are asked to" form is safe to drop; "required"/"requested" carry requirement strength and "tasked with" leaves a dangling gerund.',
    example: 'You are required to cite sources.',
  },
];
