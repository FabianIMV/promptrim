import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * `bench/run.ts` rewrites the content between these HTML comment markers in
 * `README.md` and `index.html` on every `npm run bench`. Deleting a marker by
 * accident (e.g. while editing the surrounding copy) would silently stop the
 * benchmark table from updating and no lint/build check would notice — so
 * their presence is asserted here instead.
 */
describe('bench markers', () => {
  it('README.md has the paired BENCHMARK markers', () => {
    const readme = readFileSync(join(import.meta.dirname, '..', 'README.md'), 'utf8');
    expect(readme).toContain('<!-- BENCHMARK:README:START -->');
    expect(readme).toContain('<!-- BENCHMARK:README:END -->');
    expect(readme.indexOf('<!-- BENCHMARK:README:START -->')).toBeLessThan(
      readme.indexOf('<!-- BENCHMARK:README:END -->'),
    );
  });

  it('index.html has the paired BENCHMARK markers', () => {
    const html = readFileSync(join(import.meta.dirname, '..', 'index.html'), 'utf8');
    expect(html).toContain('<!-- BENCHMARK:LANDING:START -->');
    expect(html).toContain('<!-- BENCHMARK:LANDING:END -->');
    expect(html.indexOf('<!-- BENCHMARK:LANDING:START -->')).toBeLessThan(
      html.indexOf('<!-- BENCHMARK:LANDING:END -->'),
    );
  });

  it('es/index.html has the paired BENCHMARK markers', () => {
    const html = readFileSync(join(import.meta.dirname, '..', 'es', 'index.html'), 'utf8');
    expect(html).toContain('<!-- BENCHMARK:LANDING:START -->');
    expect(html).toContain('<!-- BENCHMARK:LANDING:END -->');
    expect(html.indexOf('<!-- BENCHMARK:LANDING:START -->')).toBeLessThan(
      html.indexOf('<!-- BENCHMARK:LANDING:END -->'),
    );
  });
});
