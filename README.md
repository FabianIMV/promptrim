# PromptTrim ✂️

> Minify prompts before sending them to expensive LLMs.

PromptTrim compresses verbose prompts into shorter equivalents while preserving intent, helping reduce token usage, API cost, and context window waste.

Built for ChatGPT, Claude, Gemini, and other LLM workflows.

[![Live Demo](https://img.shields.io/badge/Live-Demo-6366f1?style=for-the-badge)](https://fabianimv.github.io/promptrim/)
[![GitHub stars](https://img.shields.io/github/stars/FabianIMV/promptrim?style=for-the-badge)](https://github.com/FabianIMV/promptrim/stargazers)
[![License](https://img.shields.io/github/license/FabianIMV/promptrim?style=for-the-badge)](./LICENSE)

---

<!-- Replace with your actual screenshot: drag image into GitHub editor or use: -->
<!-- ![PromptTrim screenshot](assets/screenshot.png) -->
<img width="1388" height="1204" alt="promptrim-example" src="https://github.com/user-attachments/assets/0ebfe732-15c0-45f2-b0ea-aaed491beed5" />


---

## Why PromptTrim?

As LLMs become more capable, prompts are getting:
- longer
- more repetitive
- more expensive

PromptTrim helps reduce unnecessary token overhead before prompts reach the model.

**No signup. No install. Just paste and compress.**

### Real example

| | Before | After |
|---|---|---|
| Tokens | 578 | 148 |
| Tokens removed | — | 430 |
| Est. cost saved | — | $0.0011 (GPT-4o) |
| Compression | Verbose | Balanced mode |

Same intent. 74% fewer tokens.

---

## Features

### ✂️ Prompt Compression
Shrink prompts while preserving meaning and structure.

### ⚡ Fast Local Mode
Rule-based browser compression with zero API calls.

### 🤖 AI Compression Mode
Optional model-powered rewriting on Anthropic, OpenAI or Google — with a second
model auditing the result and an automatic repair pass.

### 📉 Token & Cost Estimates
See token reduction and estimated API savings instantly.

### 🔒 Privacy First
No backend. No prompt storage. Everything runs client-side. Your API key never leaves your browser.

### 🎚 Compression Levels
Choose between Light, Balanced, or Aggressive.

---

## Live App

🔗 https://fabianimv.github.io/promptrim/

No signup. No install. Just paste and compress.

---

## How AI Mode Works

AI Mode calls the provider you choose straight from the browser — no proxy, no
backend, no stored prompts. It is a three-step pipeline, not a "make it shorter"
wrapper:

1. **Compress.** The system prompt carries the protection rules (code, quoted
   literals, URLs, template variables, tables, examples) *and* the constraint
   ledger extracted from your prompt. The model answers with structured JSON.
2. **Verify.** A second call — by default a cheaper model — receives the
   original, the compressed version and the ledger, and reports per constraint
   whether it survived, with evidence.
3. **Repair.** If a critical constraint is missing, a third call puts back only
   the missing ones, at most twice. Whatever still fails is shown as ✗ with a
   manual **Restore** button.

The local verifier from the constraint ledger always owns the ✓/✗ column; the
model's opinion is displayed as evidence next to it, never in place of it.
Before running, the app shows what the pipeline itself will cost.

| Provider | Models offered | Default | Verifier |
|----------|----------------|---------|----------|
| Anthropic | Claude Opus 5, Sonnet 5, Haiku 4.5 | `claude-opus-5` | `claude-haiku-4-5` |
| OpenAI | GPT-5.6 Sol, Terra, Luna | `gpt-5.6-sol` | `gpt-5.6-luna` |
| Google | Gemini 3.8 Flash, 2.5 Pro, 2.5 Flash | `gemini-3.8-flash` | `gemini-2.5-flash` |

---

## API Key Setup

AI Mode uses **your own key** for the provider you pick:

- **Anthropic** — https://platform.claude.com/settings/keys
- **OpenAI** — https://platform.openai.com/api-keys
- **Google AI Studio** — https://aistudio.google.com/app/apikey

Paste it into the key field in AI Mode. By default the key lives **in memory
only**: it is never written to disk, never put in the URL, and never logged.
Ticking *"Remember in this browser"* stores it in `sessionStorage`, which is
cleared when you close the tab; un-ticking it wipes what was stored. Nothing is
ever written to `localStorage`.

If you do not provide a key, PromptTrim still works in Fast Mode (no API key needed).

---

## Use Cases

- Reducing LLM API costs
- Fitting prompts into context windows
- Compressing agent/system prompts
- Optimizing long AI workflows
- Cleaning verbose AI-generated prompts
- Making prompts cheaper for production

---

## Tech Stack

- Vite + TypeScript + [Preact](https://preactjs.com/)
- Compression engine as pure functions in `src/core/` (no DOM), covered by Vitest
- Anthropic, OpenAI and Gemini REST APIs (optional, browser-side, bring your own key)
- GitHub Pages, built and deployed by GitHub Actions

---

## Development

```bash
npm ci
npm run dev     # local dev server
npm run lint    # ESLint + Prettier
npm test        # Vitest
npm run build   # type-check + production build into dist/
```

Layout:

| Path | What lives there |
|------|------------------|
| `src/core/segment.ts` | Marks code, strings, URLs, JSON, tables, variables and examples as protected regions |
| `src/core/rules/` | Compression rules, each with `id`, `level`, `lossy`, a readable "why" and its own test cases |
| `src/core/compress.ts` | Applies rules outside protected regions and returns a list of `Change`s |
| `src/providers/` | Browser-side LLM providers (Anthropic, OpenAI, Gemini) and the compress → verify → repair pipeline |
| `src/ui/` | Preact components mounted into the static SEO page |
| `bench/corpus/` | Prompts used as regression fixtures |
| `docs/PLAN.md` | Phased plan and status table |

`src/core/rules/discarded.ts` records the legacy rules that were deliberately
**not** ported (anything that deleted instructions such as "step by step",
"ensure", "always" or whole sentences), with the reason for each.

---

## Roadmap

- [ ] OpenAI API mode
- [ ] Prompt diff viewer
- [ ] Batch compression

---

## Contributing

Issues and pull requests are welcome.

If PromptTrim saves you tokens, consider giving the repo a ⭐

---

## License

MIT License — see [LICENSE](./LICENSE)
