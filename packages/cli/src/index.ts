export { main } from './cli';
export { runCheck } from './run';
export type { RunResult } from './run';
export { analyzeFile, apiKeyEnvName, resolveModel, totalsFor } from './analyze';
export type { AnalyzeContext, AnalyzeFileInput, FileAnalysis, Suggestion, Totals } from './analyze';
export {
  expandPatterns,
  globToRegExp,
  matchesGlob,
  staticPrefix,
  toLocalPath,
  PROMPT_EXTENSIONS,
} from './files';
export { isGitRepository, readAtRef, resolveBaseRef } from './git';
export type { BaseRef } from './git';
export {
  parseArgs,
  UsageError,
  GATES,
  REPORT_FORMATS,
  HELP,
  DEFAULT_BASE_REF,
  DEFAULT_CALLS_PER_DAY,
  DEFAULT_MODEL_ID,
} from './options';
export type { CheckOptions, Gate, ParsedArgs, ReportFormat } from './options';
export { COMMENT_MARKER, evaluateGates, render } from './report';
export type { CheckReport } from './report';
export { VERSION } from './version';
