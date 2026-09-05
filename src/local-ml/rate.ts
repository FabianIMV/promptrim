import type { Level } from '@promptrim/core';

/**
 * LLMLingua-2's `rate` is the fraction of tokens to KEEP — the opposite
 * framing from the regex levels, which start from "remove nothing" and add
 * cuts as the level goes up. The regex engine has a lossless tier (Light);
 * this one does not — every token it drops is a statistical guess, never a
 * declared-safe substitution — so even Light keeps a wide margin. The
 * Constraint Ledger is what makes any of these numbers usable at all: a
 * lower rate just means more for the ledger to find missing.
 */
export const LEVEL_KEEP_RATE: Record<Level, number> = {
  light: 0.85,
  balanced: 0.65,
  aggressive: 0.45,
};
