/**
 * Kept in step with `packages/cli/package.json` by a test, not by a build
 * step: reading the manifest at runtime would mean either shipping it inside
 * `dist` or reaching outside `rootDir`, and both cost more than one assertion.
 */
export const VERSION = '2.0.0-alpha.0';
