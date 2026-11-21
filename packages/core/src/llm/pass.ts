import type { Effort, ReviewConfig } from "../config.js";
import { addUsage, costUsd, EMPTY_USAGE, type TokenUsage } from "../cost.js";
import type { FileDiff } from "../diff/types.js";
import type { Finding } from "../finding.js";
import { fitToBudget } from "./budget.js";
import { LlmUnavailableError, type LlmClient, type LlmRequest } from "./client.js";
import { buildPrompt, numberStaticFindings, type StaticItem } from "./prompt.js";
import { LlmReviewSchema, type LlmReview } from "./schema.js";
import { validateLlmReview, type ValidVerdict } from "./validate.js";

export interface LlmPassInput {
  /** Reviewable files (already filtered by prepareDiff). */
  files: FileDiff[];
  /** Static and test-gap findings for Claude to confirm or reject. */
  staticFindings: Finding[];
  /** From runStaticPass: hides secrets before anything is sent to Anthropic. */
  redact: (text: string) => string;
  config: ReviewConfig;
  client: LlmClient;
}

export interface LlmReport {
  status: "ran" | "skipped" | "declined" | "failed";
  /** Why it was skipped, declined or failed, for the report. */
  detail?: string;
  model: string;
  servedBy?: string;
  /** Summed over every attempt. */
  usage: TokenUsage;
  costUsd?: number;
  /** Files left out of Claude's prompt to stay within the token budget. */
  omittedFiles: string[];
  summary?: string;
  confirmed: number;
  rejected: number;
  added: number;
  /** Findings Claude returned that pointed outside the diff or were otherwise unusable. */
  dropped: number;
}

export interface LlmPassResult {
  report: LlmReport;
  verdicts: ValidVerdict[];
  /** The ids Claude saw for each static finding. */
  staticItems: StaticItem[];
  findings: Finding[];
}

const LOWER_EFFORT: Partial<Record<Effort, Effort>> = {
  max: "xhigh",
  xhigh: "high",
  high: "medium",
  medium: "low",
};

const MAX_ATTEMPTS = 2;

function parseReview(text: string): LlmReview | undefined {
  try {
    const parsed = LlmReviewSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The LLM pass: fit the prompt into the token budget, ask Claude, and validate the answer.
 * Never throws: whatever goes wrong, the review carries on with the static findings and
 * the report says why Claude's part is missing.
 */
export async function runLlmPass(input: LlmPassInput): Promise<LlmPassResult> {
  const { config, client } = input;
  let usage: TokenUsage = { ...EMPTY_USAGE };
  let servedBy: string | undefined;
  let omittedFiles: string[] = [];

  const report = (status: LlmReport["status"], extra: Partial<LlmReport> = {}): LlmReport => {
    const cost = servedBy || usage.inputTokens > 0 ? costUsd(servedBy ?? config.model, usage) : 0;
    return {
      status,
      model: config.model,
      ...(servedBy ? { servedBy } : {}),
      usage,
      ...(cost === undefined ? {} : { costUsd: cost }),
      omittedFiles,
      confirmed: 0,
      rejected: 0,
      added: 0,
      dropped: 0,
      ...extra,
    };
  };
  const without = (status: LlmReport["status"], detail: string): LlmPassResult => ({
    report: report(status, { detail }),
    verdicts: [],
    staticItems: [],
    findings: [],
  });

  if (input.files.length === 0)
    return without("skipped", "There were no files for Claude to review.");

  const requestFor = (files: FileDiff[]) => {
    const paths = new Set(files.map((f) => f.path));
    const staticItems = numberStaticFindings(input.staticFindings.filter((f) => paths.has(f.file)));
    const prompt = buildPrompt({
      files,
      staticItems,
      redact: input.redact,
      maxFindings: config.maxComments,
    });
    const request: LlmRequest = {
      model: config.model,
      effort: config.effort,
      maxTokens: config.budget.maxOutputTokens,
      system: prompt.system,
      user: prompt.user,
    };
    return { staticItems, request };
  };

  try {
    const plan = await fitToBudget(
      input.files,
      (files) => client.countTokens(requestFor(files).request),
      config.budget.maxInputTokens,
    );
    if (!plan) {
      return without(
        "skipped",
        `This PR is too big for Claude's token budget (${config.budget.maxInputTokens.toLocaleString("en-US")} input tokens), so only the static checks ran.`,
      );
    }
    omittedFiles = plan.omitted.map((f) => f.path);
    const built = requestFor(plan.files);
    let request = built.request;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const response = await client.complete(request);
      usage = addUsage(usage, response.usage);
      servedBy = response.servedBy;

      if (response.stopReason === "refusal") {
        const category = response.refusalCategory ? ` (category: ${response.refusalCategory})` : "";
        return without(
          "declined",
          `Claude declined to review this change${category}. The static checks still ran.`,
        );
      }

      if (response.stopReason === "max_tokens") {
        const lower = LOWER_EFFORT[request.effort];
        if (!lower || attempt === MAX_ATTEMPTS) {
          return without(
            "failed",
            "Claude's answer didn't fit the output budget (budget.maxOutputTokens), so only the static checks ran.",
          );
        }
        // Thinking uses the output budget, so think less rather than spend more.
        request = { ...request, effort: lower };
        continue;
      }

      const review = response.stopReason === "end_turn" ? parseReview(response.text) : undefined;
      if (!review) {
        if (attempt === MAX_ATTEMPTS) {
          return without(
            "failed",
            "Claude's answer wasn't a valid review, so only the static checks ran.",
          );
        }
        continue;
      }

      const validated = validateLlmReview(
        review,
        plan.files,
        built.staticItems.map((i) => i.id),
      );
      return {
        report: report("ran", {
          summary: validated.summary,
          confirmed: validated.verdicts.filter((v) => v.verdict === "confirm").length,
          rejected: validated.verdicts.filter((v) => v.verdict === "reject").length,
          added: validated.findings.length,
          dropped: validated.dropped.length,
        }),
        verdicts: validated.verdicts,
        staticItems: built.staticItems,
        findings: validated.findings,
      };
    }
    return without("failed", "Claude didn't return a usable review.");
  } catch (error) {
    if (error instanceof LlmUnavailableError) {
      const skipped = error.reason === "no-credentials" || error.reason === "auth-failed";
      return without(skipped ? "skipped" : "failed", error.message);
    }
    const message = error instanceof Error ? error.message : String(error);
    return without("failed", `The Claude pass failed unexpectedly: ${message}`);
  }
}
