import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

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
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    coverage: {
      include: ['src/core/**/*.ts'],
    },
  },
});
