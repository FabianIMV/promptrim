import type { Rule } from './types';

const UTILIZE: Record<string, string> = {
  e: 'use',
  es: 'uses',
  ed: 'used',
  ing: 'using',
};

/**
 * Level `balanced`, part 1: phrase-level substitutions with an exact semantic
 * equivalent. Section 2 policy: never delete instruction words, only rewrite
 * verbose constructions into shorter ones that mean the same thing.
 */
export const SUBSTITUTION_RULES: Rule[] = [
  {
    id: 'sub.in-order-to',
    level: 'balanced',
    lossy: false,
    why: '"in order to" and "so as to" mean exactly "to".',
    pattern: /\b(?:in order to|so as to)\b/gi,
    replacement: 'to',
    cases: [
      {
        input: 'Read the file in order to find the bug.',
        expected: 'Read the file to find the bug.',
      },
      { input: 'In order to start, run npm ci.', expected: 'To start, run npm ci.' },
      {
        input: 'Run it to start.',
        expected: 'Run it to start.',
        note: 'negative: already minimal',
      },
    ],
  },
  {
    id: 'sub.for-the-purpose-of',
    level: 'balanced',
    lossy: false,
    why: '"for the purpose of X" means "for X".',
    pattern: /\bfor the purpose of\b/gi,
    replacement: 'for',
    cases: [
      { input: 'Used for the purpose of testing.', expected: 'Used for testing.' },
      { input: 'For the purpose of clarity, be brief.', expected: 'For clarity, be brief.' },
      {
        input: 'Used for testing.',
        expected: 'Used for testing.',
        note: 'negative: already minimal',
      },
    ],
  },
  {
    id: 'sub.because',
    level: 'balanced',
    lossy: false,
    why: 'Long causal connectives all mean "because".',
    pattern: /\b(?:due to the fact that|for the reason that|owing to the fact that)\b/gi,
    replacement: 'because',
    cases: [
      {
        input: 'Skip it due to the fact that it is slow.',
        expected: 'Skip it because it is slow.',
      },
      { input: 'Due to the fact that it fails, retry.', expected: 'Because it fails, retry.' },
      {
        input: 'Skip it because it is slow.',
        expected: 'Skip it because it is slow.',
        note: 'negative',
      },
    ],
  },
  {
    id: 'sub.if',
    level: 'balanced',
    lossy: false,
    why: '"in the event that" means "if".',
    pattern: /\bin the event that\b/gi,
    replacement: 'if',
    cases: [
      { input: 'In the event that it fails, stop.', expected: 'If it fails, stop.' },
      { input: 'Retry in the event that the API errors.', expected: 'Retry if the API errors.' },
      { input: 'Retry if the API errors.', expected: 'Retry if the API errors.', note: 'negative' },
    ],
  },
  {
    id: 'sub.now',
    level: 'balanced',
    lossy: false,
    why: '"at this point in time" means "now".',
    pattern: /\bat (?:this point in time|the present time)\b/gi,
    replacement: 'now',
    cases: [
      { input: 'Stop at this point in time.', expected: 'Stop now.' },
      { input: 'At the present time, use v2.', expected: 'Now, use v2.' },
      { input: 'Stop now.', expected: 'Stop now.', note: 'negative' },
    ],
  },
  {
    id: 'sub.about',
    level: 'balanced',
    lossy: false,
    why: 'Bureaucratic prepositional phrases all mean "about".',
    pattern: /\b(?:with regard to|with respect to|in regard to|pertaining to|in relation to)\b/gi,
    replacement: 'about',
    cases: [
      { input: 'Answer with regard to the schema.', expected: 'Answer about the schema.' },
      {
        input: 'Questions pertaining to billing go last.',
        expected: 'Questions about billing go last.',
      },
      { input: 'Answer about the schema.', expected: 'Answer about the schema.', note: 'negative' },
    ],
  },
  {
    id: 'sub.many',
    level: 'balanced',
    lossy: false,
    why: '"a large number of" means "many".',
    pattern: /\ba (?:large|significant|substantial) number of\b/gi,
    replacement: 'many',
    cases: [
      { input: 'It has a large number of fields.', expected: 'It has many fields.' },
      { input: 'A significant number of rows fail.', expected: 'Many rows fail.' },
      { input: 'It has many fields.', expected: 'It has many fields.', note: 'negative' },
    ],
  },
  {
    id: 'sub.most',
    level: 'balanced',
    lossy: false,
    why: '"the majority of" means "most".',
    pattern: /\bthe majority of\b/gi,
    replacement: 'most',
    cases: [
      { input: 'The majority of users prefer JSON.', expected: 'Most users prefer JSON.' },
      { input: 'Reject the majority of requests.', expected: 'Reject most requests.' },
      { input: 'Most users prefer JSON.', expected: 'Most users prefer JSON.', note: 'negative' },
    ],
  },
  {
    id: 'sub.although',
    level: 'balanced',
    lossy: false,
    why: '"despite the fact that" means "although".',
    pattern: /\b(?:despite|in spite of) the fact that\b/gi,
    replacement: 'although',
    cases: [
      {
        input: 'Ship it despite the fact that tests fail.',
        expected: 'Ship it although tests fail.',
      },
      {
        input: 'In spite of the fact that it works, refactor.',
        expected: 'Although it works, refactor.',
      },
      {
        input: 'Ship it although tests fail.',
        expected: 'Ship it although tests fail.',
        note: 'negative',
      },
    ],
  },
  {
    id: 'sub.can',
    level: 'balanced',
    lossy: false,
    why: '"is able to" / "has the ability to" mean "can".',
    pattern: /\b(?:has the ability to|have the ability to|is able to|are able to|am able to)\b/gi,
    replacement: 'can',
    cases: [
      { input: 'The model is able to call tools.', expected: 'The model can call tools.' },
      { input: 'Agents have the ability to retry.', expected: 'Agents can retry.' },
      {
        input: 'The model can call tools.',
        expected: 'The model can call tools.',
        note: 'negative',
      },
    ],
  },
  {
    id: 'sub.use',
    level: 'balanced',
    lossy: false,
    why: '"make use of" means "use".',
    pattern: /\bmake use of\b/gi,
    replacement: 'use',
    cases: [
      { input: 'Make use of the cache.', expected: 'Use the cache.' },
      { input: 'You should make use of tools.', expected: 'You should use tools.' },
      { input: 'Use the cache.', expected: 'Use the cache.', note: 'negative' },
    ],
  },
  {
    id: 'sub.utilize',
    level: 'balanced',
    lossy: false,
    why: '"utilize" is "use" with more tokens; inflection is preserved.',
    pattern: /\butiliz(e|es|ed|ing)\b/gi,
    replacement: (_match, suffix) => UTILIZE[suffix.toLowerCase()] ?? 'use',
    cases: [
      { input: 'Utilize the parser.', expected: 'Use the parser.' },
      {
        input: 'It utilizes the parser and utilized it before.',
        expected: 'It uses the parser and used it before.',
      },
      { input: 'Use the parser.', expected: 'Use the parser.', note: 'negative' },
    ],
  },
  {
    id: 'sub.utilization',
    level: 'balanced',
    lossy: false,
    why: '"utilization" is "use" with more tokens.',
    pattern: /\butilization\b/gi,
    replacement: 'use',
    cases: [
      { input: 'Report token utilization.', expected: 'Report token use.' },
      { input: 'Utilization must stay low.', expected: 'Use must stay low.' },
      { input: 'Report token use.', expected: 'Report token use.', note: 'negative' },
    ],
  },
  {
    id: 'sub.before',
    level: 'balanced',
    lossy: false,
    why: '"prior to" means "before".',
    pattern: /\bprior to\b/gi,
    replacement: 'before',
    cases: [
      { input: 'Validate prior to sending.', expected: 'Validate before sending.' },
      { input: 'Prior to running, install deps.', expected: 'Before running, install deps.' },
      { input: 'Validate before sending.', expected: 'Validate before sending.', note: 'negative' },
    ],
  },
  {
    id: 'sub.consider',
    level: 'balanced',
    lossy: false,
    why: '"take into account/consideration" means "consider".',
    pattern: /\btake into (?:account|consideration)\b/gi,
    replacement: 'consider',
    cases: [
      { input: 'Take into account the locale.', expected: 'Consider the locale.' },
      {
        input: 'You must take into consideration the budget.',
        expected: 'You must consider the budget.',
      },
      { input: 'Consider the locale.', expected: 'Consider the locale.', note: 'negative' },
    ],
  },
  {
    id: 'sub.help',
    level: 'balanced',
    lossy: false,
    why: '"provide assistance" means "help".',
    pattern: /\bprovide assistance\b/gi,
    replacement: 'help',
    cases: [
      { input: 'Provide assistance with the schema.', expected: 'Help with the schema.' },
      { input: 'You provide assistance with billing.', expected: 'You help with billing.' },
      { input: 'Help with the schema.', expected: 'Help with the schema.', note: 'negative' },
    ],
  },
  {
    id: 'sub.start',
    level: 'balanced',
    lossy: false,
    why: '"commence" means "start".',
    pattern: /\bcommence\b/gi,
    replacement: 'start',
    cases: [
      { input: 'Commence the audit.', expected: 'Start the audit.' },
      { input: 'Then commence step two.', expected: 'Then start step two.' },
      { input: 'Start the audit.', expected: 'Start the audit.', note: 'negative' },
    ],
  },
  {
    id: 'sub.then',
    level: 'balanced',
    lossy: false,
    why: '"subsequently" means "then".',
    pattern: /\bsubsequently\b/gi,
    replacement: 'then',
    cases: [
      { input: 'Validate, subsequently send.', expected: 'Validate, then send.' },
      { input: 'Subsequently, log the result.', expected: 'Then, log the result.' },
      { input: 'Validate, then send.', expected: 'Validate, then send.', note: 'negative' },
    ],
  },
];
