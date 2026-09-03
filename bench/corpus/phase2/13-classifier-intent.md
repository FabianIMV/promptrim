Classify each incoming message into exactly one intent.

Allowed intents: billing, technical, sales, account, other.
Never invent an intent that is not in the list. When unsure, use other.
Do not explain your reasoning.

Also return a confidence between 0 and 1 with 2 decimal places.
If the confidence is below 0.60, set "needs_review" to true.

Output one JSON object per input line, in the same order as the input:
{"intent": "billing", "confidence": 0.92, "needs_review": false}
Return nothing else.
