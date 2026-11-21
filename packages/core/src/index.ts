// Public API of @pr-mentor/core.
export {
  CategorySchema,
  FindingSchema,
  ReferenceSchema,
  SeveritySchema,
  SourceSchema,
} from "./finding.js";
export type { Category, Finding, Reference, Severity, Source } from "./finding.js";

export { DiffParseError, parseDiff } from "./diff/parse.js";
export { filterFiles, skipReason } from "./diff/filters.js";
export type {
  DiffLine,
  FileDiff,
  FileStatus,
  Hunk,
  SkipReason,
  SkippedFile,
} from "./diff/types.js";
