import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

const ROOT = dirname(fileURLToPath(import.meta.url));

// The site is published at https://fabianimv.github.io/promptrim/
export default defineConfig({
  base: '/promptrim/',
  plugins: [preact()],
  build: {
    target: 'es2022',
    sourcemap: true,
    // The o200k_base tokenizer rank file (~2.3 MB) is intentionally lazy —
    // dynamically imported only when OpenAI token counting runs, never part
    // of the initial bundle. Raise the warning limit so that expected,
    // code-split chunk doesn't produce build noise.
    chunkSizeWarningLimit: 2500,
    rollupOptions: {
      // Two static SEO shells (English root, Spanish /es/) mounting the same
      // Preact app — see docs/PLAN.md Phase 6 task 5. Vite mirrors each
      // input's path under dist/, so `es/index.html` lands at `dist/es/`.
      input: {
        main: resolve(ROOT, 'index.html'),
        es: resolve(ROOT, 'es/index.html'),
      },
    },
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    coverage: {
      include: ['src/core/**/*.ts'],
    },
  },
});
