# PromptTrim ✂️

[![Live Demo](https://img.shields.io/badge/Live-Demo-6366f1?style=for-the-badge)](https://fabianimv.github.io/promptrim/)
[![GitHub stars](https://img.shields.io/github/stars/FabianIMV/promptrim?style=for-the-badge)](https://github.com/FabianIMV/promptrim/stargazers)
[![License](https://img.shields.io/github/license/FabianIMV/promptrim?style=for-the-badge)](./LICENSE)

PromptTrim is a lightweight frontend app that compresses verbose AI prompts while preserving intent.  
It helps reduce token usage and API costs for ChatGPT, Claude, Gemini, and other LLMs.

## Features

- **Fast mode (free):** Browser-only rule-based compression.
- **AI mode (Gemini):** Client-side Gemini API rewriting for deeper compression.
- **Compression levels:** Light, Balanced, Aggressive.
- **Token estimates:** Before/after token and cost savings.
- **Privacy-first:** No backend processing of your prompts.

## How Gemini works

- Gemini calls happen **directly from the browser** to `generativelanguage.googleapis.com`.
- Your API key is used only on the client side.
- PromptTrim automatically discovers available Gemini models and falls back to preferred models when needed.

## Quick start

No install required.

1. Open the live app: https://fabianimv.github.io/promptrim/
2. Paste your prompt.
3. Choose a compression level.
4. (Optional) Enable AI mode and add your Gemini API key.
5. Click **Compress Prompt**.

## Local development

This repository is a static site (`index.html` + `app.js`), so you can open it directly in the browser or serve it with any static server.

## Contributing

Issues and pull requests are welcome.  
If PromptTrim helps you, please consider giving it a ⭐ on GitHub.

## License

Released under the MIT License. See [LICENSE](./LICENSE).
