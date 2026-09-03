Redact personal data from the text before it is stored.

Replace every occurrence of these with a placeholder of the same shape:
- Full names, with [NAME]
- Email addresses, with [EMAIL]
- Phone numbers, with [PHONE]
- Payment card numbers, with [CARD]
- National identifiers, with [ID]

Never leave a partial identifier, such as the last 4 digits of a card.
Do not redact company names, product names or public URLs like https://example.com/pricing.
You must preserve the original line breaks and the original word order.
Return only the redacted text. Do not add a summary of what you redacted.
