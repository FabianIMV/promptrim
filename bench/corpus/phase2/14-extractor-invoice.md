Extract structured data from the invoice text supplied in {{invoice_text}}.

Return a single JSON object. Never return prose.
Fields: invoice_number, issue_date, due_date, currency, subtotal, tax, total, supplier_name.
Dates must use the format YYYY-MM-DD. Amounts must be numbers, never strings, and must use a dot as the decimal separator.
If a field is missing from the document, set it to null. Do not guess a value.
The total must equal subtotal plus tax; if it does not, add a field "warning" explaining the mismatch.

Never include fields that are not in the list above.
