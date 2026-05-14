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
Optional Gemini-powered rewriting for deeper semantic compression.

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

PromptTrim uses the Gemini API directly from the browser.

- No proxy server
- No backend processing
- No stored prompts
- Your API key stays client-side

The app automatically detects available Gemini models and falls back when necessary.

---

## Gemini API Key Setup

AI Mode requires your own **Google AI Studio Gemini API key**.

1. Open Google AI Studio: https://aistudio.google.com/
2. Sign in and create an API key.
3. In PromptTrim, enable **AI-powered (Gemini API)**.
4. Paste your API key into the API key field.

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

- Vanilla JavaScript
- Static HTML/CSS
- Gemini API (optional, browser-side)
- GitHub Pages

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
