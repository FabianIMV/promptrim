import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

// The site is published at https://fabianimv.github.io/promptrim/
export default defineConfig({
  base: '/promptrim/',
  plugins: [preact()],
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    coverage: {
      include: ['src/core/**/*.ts'],
    },
  },
});
