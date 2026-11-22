import { DEFAULT_CONFIG, type ReviewConfig } from "../config.js";
import { EMPTY_USAGE } from "../cost.js";
import { prepareDiff, type DiffLimits, type DiffStats } from "../diff/prepare.js";
import type { SkippedFile } from "../diff/types.js";
import type { Finding } from "../finding.js";
import { AnthropicLlmClient, type LlmClient } from "../llm/client.js";
import { runLlmPass, type LlmReport } from "../llm/pass.js";
import type { RepoContext } from "../repo.js";
import { verifiedRepo } from "../repo/verify.js";
import { runStaticPass, type StaticPassOptions, type ToolReport } from "../static/run.js";
import type { WorkspaceSkip } from "../static/workspace.js";
import { findTestGaps } from "../test-gap/find-gaps.js";
import { mergeFindings } from "./merge.js";
import { rankFindings } from "./rank.js";

export interface ReviewOptions {
  config?: ReviewConfig;
  /** Claude client; `null` turns the LLM pass off. Defaults to the real Anthropic client. */
  llm?: LlmClient | null;
  static?: StaticPassOptions;
  limits?: Partial<DiffLimits>;
}

export interface ReviewResult {
  status: "ok" | "too_large" | "nothing_to_review";
  /** Friendly explanation when status isn't "ok". */
  message?: string;
  /** Ranked findings to show, at most config.maxComments. */
  findings: Finding[];
  /** Ranked findings beyond the cap. */
  hidden: Finding[];
  /** Static findings Claude rejected, with its reason. */
  rejected: { finding: Finding; why: string }[];
  tools: ToolReport[];
  llm: LlmReport;
  /** Files filtered out of the review (lockfiles, generated, binary, ...). */
  skippedFiles: SkippedFile[];
  /** Changed files the static tools couldn't be given (unsafe paths, tool configs). */
  notScanned: WorkspaceSkip[];
  stats: DiffStats;
}

const llmSkipped = (config: ReviewConfig, detail: string): LlmReport => ({
  status: "skipped",
  detail,
  model: config.model,
  usage: { ...EMPTY_USAGE },
  omittedFiles: [],
  confirmed: 0,
  rejected: 0,
  added: 0,
  dropped: 0,
});

/**
 * Review a pull request: prepare the diff, run the static tools and the missing-tests
 * check, let Claude confirm/reject those and add what they missed, then merge and rank.
 * Throws DiffParseError for input that isn't a diff; everything else degrades gracefully.
 */
export async function reviewDiff(
  rawDiff: string,
  repo: RepoContext,
  options: ReviewOptions = {},
): Promise<ReviewResult> {
  const config = options.config ?? DEFAULT_CONFIG;
  const prepared = prepareDiff(rawDiff, options.limits);
  const empty = {
    findings: [],
    hidden: [],
    rejected: [],
    tools: [],
    notScanned: [],
    skippedFiles: prepared.skipped,
    stats: prepared.stats,
  };

  if (prepared.status === "too_large") {
    return {
      ...empty,
      status: "too_large",
      message: prepared.message,
      llm: llmSkipped(config, "The PR is too large to review."),
    };
  }
  if (prepared.files.length === 0) {
    return {
      ...empty,
      status: "nothing_to_review",
      message:
        "There's nothing to review: every changed file was a lockfile, generated, vendored, binary or deleted.",
      llm: llmSkipped(config, "There was nothing to review."),
    };
  }

  const files = prepared.files;
  const checkedRepo = verifiedRepo(files, repo);
  const staticPass = await runStaticPass(files, checkedRepo, options.static);
  const testGaps = await findTestGaps(files, checkedRepo);
  const staticFindings = [...staticPass.findings, ...testGaps];

  const llm = options.llm === undefined ? new AnthropicLlmClient() : options.llm;
  const pass = llm
    ? await runLlmPass({ files, staticFindings, redact: staticPass.redact, config, client: llm })
    : {
        report: llmSkipped(config, "The Claude pass was turned off."),
        verdicts: [],
        staticItems: [],
        findings: [],
      };

  const merged = mergeFindings({
    staticFindings,
    staticItems: pass.staticItems,
    verdicts: pass.verdicts,
    llmFindings: pass.findings,
  });
  const { shown, hidden } = rankFindings(merged.findings, config);

  return {
    status: "ok",
    findings: shown,
    hidden,
    rejected: merged.rejected,
    tools: staticPass.tools,
    llm: pass.report,
    skippedFiles: prepared.skipped,
    notScanned: staticPass.skippedFiles,
    stats: prepared.stats,
  };
}
