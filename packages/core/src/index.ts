// Public API of @pr-mentor/core.
export {
  CategorySchema,
  FindingSchema,
  ReferenceSchema,
  SeveritySchema,
  SourceSchema,
} from "./finding.js";
export type { Category, Finding, Reference, Severity, Source } from "./finding.js";
export {
  createRedactor,
  redactKnownSecrets,
  redactSecret,
  redactSecretPatterns,
} from "./redact.js";
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

export {
  ConfigError,
  DEFAULT_CONFIG,
  EffortSchema,
  loadConfig,
  ReviewConfigSchema,
} from "./config.js";
export type { ConfigOverrides, Effort, ReviewConfig } from "./config.js";
export { addUsage, costUsd, EMPTY_USAGE, PRICING } from "./cost.js";
export type { ModelPricing, TokenUsage } from "./cost.js";

export {
  isAllowedReferenceUrl,
  REFERENCE_DOMAINS,
  sanitizePlain,
  sanitizeReferences,
  sanitizeText,
} from "./sanitize.js";
export { LlmFindingSchema, LlmReviewSchema, StaticVerdictSchema } from "./llm/schema.js";
export type { LlmFinding, LlmReview, StaticVerdict } from "./llm/schema.js";
export { validateLlmReview } from "./llm/validate.js";
export type { DroppedFinding, ValidatedReview, ValidVerdict } from "./llm/validate.js";
export { buildPrompt, numberStaticFindings, SYSTEM_PROMPT } from "./llm/prompt.js";
export type { PromptInput, ReviewPrompt, StaticItem } from "./llm/prompt.js";
export {
  AnthropicLlmClient,
  buildMessageParams,
  LlmUnavailableError,
  toLlmResponse,
} from "./llm/client.js";
export type {
  AnthropicLike,
  LlmClient,
  LlmRequest,
  LlmResponse,
  LlmStopReason,
  LlmUnavailableReason,
} from "./llm/client.js";
export { fitToBudget } from "./llm/budget.js";
export type { BudgetPlan } from "./llm/budget.js";
export { runLlmPass } from "./llm/pass.js";
export type { LlmPassInput, LlmPassResult, LlmReport } from "./llm/pass.js";
export { mergeFindings } from "./review/merge.js";
export type { MergeInput, MergeResult } from "./review/merge.js";
export { rankFindings } from "./review/rank.js";
export type { RankOptions } from "./review/rank.js";
export { verifiedRepo } from "./repo/verify.js";
export { reviewDiff } from "./review/review.js";
export type { ReviewOptions, ReviewResult } from "./review/review.js";
export { createAnthropicLlmClient } from "./llm/client.js";
export { runCommand, ToolNotFoundError } from "./static/exec.js";
export type { CommandResult, CommandRunner } from "./static/exec.js";
export { isSafeRepoPath } from "./static/workspace.js";
export { renderFinding, renderMarkdown, usageLine } from "./render.js";
