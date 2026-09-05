import type { Rule } from './types';

/**
 * Level `balanced`, part 2: politeness and request framing. These are lossy —
 * they remove words — but the words removed carry no instruction. Anything that
 * carries an instruction, a requirement or an option ("ensure", "must",
 * "never", "only", "step by step", "feel free to") is in DISCARDED_RULES and is
 * never removed at any level.
 */
export const FRAME_RULES: Rule[] = [
  {
    id: 'politeness.please',
    level: 'balanced',
    lossy: true,
    why: 'Politeness markers do not change what the model is asked to do.',
    pattern: /\b(?:please|kindly),?[^\S\n]+(?=\S)/gi,
    replacement: '',
    cases: [
      { input: 'Please write a summary.', expected: 'Write a summary.' },
      { input: 'Kindly, return JSON.', expected: 'Return JSON.' },
      { input: 'Write a summary.', expected: 'Write a summary.', note: 'negative' },
      {
        input: 'Reply with the word please.',
        expected: 'Reply with the word please.',
        note: 'negative: "please" at end of sentence is content, not framing',
      },
    ],
  },
  {
    id: 'frame.polite-request',
    level: 'balanced',
    lossy: true,
    why: 'Request framing ("could you", "I would like you to") adds tokens but no instruction.',
    pattern:
      /\b(?:could you|can you|would you|i would like you to|i'd like you to|i want you to|i need you to)(?:[^\S\n]+please)?,?[^\S\n]+(?=\S)/gi,
    replacement: '',
    cases: [
      { input: 'Could you please summarise this?', expected: 'Summarise this?' },
      { input: 'I would like you to return JSON.', expected: 'Return JSON.' },
      { input: 'Summarise this.', expected: 'Summarise this.', note: 'negative' },
      {
        input: 'Ask the user if you can help.',
        expected: 'Ask the user if you can help.',
        note: 'negative: "you can" is not a request frame',
      },
    ],
  },
  {
    id: 'frame.task-is-to',
    level: 'balanced',
    lossy: true,
    why: '"Your task is to X" is a wrapper around the imperative "X".',
    pattern: /\byour (?:task|job|role|goal) is to[^\S\n]+(?=\S)/gi,
    replacement: '',
    cases: [
      { input: 'Your task is to classify the ticket.', expected: 'Classify the ticket.' },
      { input: 'Your goal is to answer in JSON.', expected: 'Answer in JSON.' },
      { input: 'Classify the ticket.', expected: 'Classify the ticket.', note: 'negative' },
      {
        input: 'Your role is customer support.',
        expected: 'Your role is customer support.',
        note: 'negative: role assignment without "to" is content',
      },
    ],
  },
  {
    id: 'frame.you-are-asked-to',
    level: 'balanced',
    lossy: true,
    why: '"You are asked to X" is a wrapper around the imperative "X".',
    pattern: /\byou are asked to[^\S\n]+(?=\S)/gi,
    replacement: '',
    cases: [
      { input: 'You are asked to reply in Spanish.', expected: 'Reply in Spanish.' },
      { input: 'You are asked to return only JSON.', expected: 'Return only JSON.' },
      { input: 'Reply in Spanish.', expected: 'Reply in Spanish.', note: 'negative' },
      {
        input: 'You are required to reply in Spanish.',
        expected: 'You are required to reply in Spanish.',
        note: 'negative: "required" is a requirement word and is never removed',
      },
    ],
  },
];

/**
 * Level `aggressive`: removals that can shift emphasis. The ledger (Phase 2)
 * will revert any of these that drops a tracked constraint; until then they are
 * limited to words that carry emphasis rather than instruction.
 */
export const AGGRESSIVE_RULES: Rule[] = [
  {
    id: 'intensifier.degree',
    level: 'aggressive',
    lossy: true,
    why: 'Degree intensifiers add emphasis, not requirements. Frequency words (always, never, often) are never removed.',
    pattern:
      /\b(?:very|really|extremely|quite|rather|fairly|somewhat|totally|absolutely|definitely|certainly|basically|essentially)[^\S\n]+(?=\S)/gi,
    replacement: '',
    cases: [
      { input: 'Be very concise.', expected: 'Be concise.' },
      { input: 'This is extremely important context.', expected: 'This is important context.' },
      { input: 'Be concise.', expected: 'Be concise.', note: 'negative' },
      {
        input: 'Always answer in JSON.',
        expected: 'Always answer in JSON.',
        note: 'negative: "always" is a requirement word, kept at every level',
      },
    ],
  },
  {
    id: 'hedge.opinion',
    level: 'aggressive',
    lossy: true,
    why: 'First-person hedges frame the request without changing it.',
    pattern:
      /\b(?:i think|i believe|i feel|i suppose|in my opinion|from my perspective),?[^\S\n]+(?=\S)/gi,
    replacement: '',
    cases: [
      { input: 'I think you should return JSON.', expected: 'You should return JSON.' },
      { input: 'In my opinion, be brief.', expected: 'Be brief.' },
      { input: 'Return JSON.', expected: 'Return JSON.', note: 'negative' },
    ],
  },
  {
    id: 'frame.as-an-ai',
    level: 'aggressive',
    lossy: true,
    why: 'Reminding the model that it is a model adds tokens and no behaviour.',
    pattern: /\bas an? (?:ai assistant|ai|assistant|language model|llm),?[^\S\n]+(?=\S)/gi,
    replacement: '',
    cases: [
      { input: 'As an AI assistant, answer briefly.', expected: 'Answer briefly.' },
      { input: 'As a language model, you cannot browse.', expected: 'You cannot browse.' },
      { input: 'Answer briefly.', expected: 'Answer briefly.', note: 'negative' },
    ],
  },
  {
    id: 'frame.important-to-note',
    level: 'aggressive',
    lossy: true,
    why: '"It is important to note that X" is a wrapper around "X". Bare "note that" is kept.',
    pattern:
      /\bit (?:is|'s) important to note that[^\S\n]+(?=\S)|\bit should be noted that[^\S\n]+(?=\S)/gi,
    replacement: '',
    cases: [
      { input: 'It is important to note that ids are UUIDs.', expected: 'Ids are UUIDs.' },
      { input: 'It should be noted that limits apply.', expected: 'Limits apply.' },
      {
        input: 'Note that ids are UUIDs.',
        expected: 'Note that ids are UUIDs.',
        note: 'negative: bare "note that" can be an instruction and is kept',
      },
    ],
  },
  {
    id: 'frame.in-this-task',
    level: 'aggressive',
    lossy: true,
    why: 'Opening throat-clearing ("In this task, ...") adds no instruction.',
    pattern: /^(?:in this task|for this (?:task|request|assignment)),?[^\S\n]*/gim,
    replacement: '',
    cases: [
      { input: 'In this task, classify the ticket.', expected: 'Classify the ticket.' },
      { input: 'For this request, answer in JSON.', expected: 'Answer in JSON.' },
      { input: 'Classify the ticket.', expected: 'Classify the ticket.', note: 'negative' },
    ],
  },
  {
    id: 'frame.the-following-is',
    level: 'aggressive',
    lossy: true,
    why: '"The following is a X:" is a label for content that immediately follows.',
    pattern: /\bthe following is (?:an?[^\S\n]+)?/gi,
    replacement: '',
    cases: [
      { input: 'The following is a list of rules:', expected: 'List of rules:' },
      { input: 'The following is the schema:', expected: 'The schema:' },
      {
        input: 'The following are the rules:',
        expected: 'The following are the rules:',
        note: 'negative: plural form is left alone, removing it breaks the sentence',
      },
    ],
  },
];
