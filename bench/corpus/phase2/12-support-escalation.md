Decide whether a support conversation should be escalated to a human.

Escalate when any of these is true:
1. The customer has replied more than 3 times without resolution.
2. The customer uses the words "lawyer", "chargeback" or "cancel my contract".
3. The issue involves data loss or an outage lasting over 15 minutes.

Never escalate a billing question that a knowledge-base article already answers.
Do not reveal that an escalation happened; simply say a specialist will follow up.

Respond in JSON with exactly the keys "escalate" (boolean), "trigger" (string) and "summary" (string).
The summary must be one sentence and must be written in the customer's language.
