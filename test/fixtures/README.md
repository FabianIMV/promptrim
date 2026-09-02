## `o200k-tokens.json`

20 texts (empty string, prose, code fences, URLs, numbers, emoji/unicode,
contractions, a long repeated string, prohibition/format instructions, SQL,
template variables) with their exact `o200k_base` token counts, generated
with Python's reference implementation:

```python
import json, tiktoken

enc = tiktoken.get_encoding('o200k_base')
texts = [...]  # see test/tokenizers-openai.test.ts for what these cover
fixtures = [{"text": t, "tokens": len(enc.encode(t))} for t in texts]
json.dump(fixtures, open('o200k-tokens.json', 'w'), ensure_ascii=False, indent=2)
```

`test/tokenizers-openai.test.ts` asserts `countOpenAiTokens` (the `js-tiktoken`
port used in the app) matches every fixture exactly.
