// Public API of @pr-mentor/core.
export {
  CategorySchema,
  FindingSchema,
  ReferenceSchema,
  SeveritySchema,
  SourceSchema,
} from "./finding.js";
export type { Category, Finding, Reference, Severity, Source } from "./finding.js";
export { redactSecret } from "./redact.js";
export type { RepoContext } from "./repo.js";

export { DEFAULT_TOOLS, runStaticPass } from "./static/run.js";
export type { StaticPassOptions, StaticPassResult, ToolReport } from "./static/run.js";
export type { ToolName } from "./static/tool.js";

export { findTestGaps } from "./test-gap/find-gaps.js";
export { classifyFile } from "./test-gap/classify.js";
export type { FileKind } from "./test-gap/classify.js";

export { DiffParseError, parseDiff } from "./diff/parse.js";
export { filterFiles, skipReason } from "./diff/filters.js";
export { DEFAULT_LIMITS, prepareDiff } from "./diff/prepare.js";
export type { DiffLimits, DiffStats, PreparedDiff } from "./diff/prepare.js";
export type {
  DiffLine,
  FileDiff,
  FileStatus,
  Hunk,
  SkipReason,
  SkippedFile,
} from "./diff/types.js";
