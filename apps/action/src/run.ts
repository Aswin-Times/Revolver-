import {
  createAnthropicLlmClient,
  gitDiff,
  gitRepoContext,
  loadConfig,
  parseDiff,
  renderMarkdown,
  reviewDiff,
  reviewGateFailure,
  runCommand,
  SeveritySchema,
  usageLine,
  type LlmClient,
  type StaticPassOptions,
} from "@pr-mentor/core";
import { summaryBody } from "./comments.js";
import { EventError, prFromEvent } from "./event.js";
import type { PullRequestApi } from "./github.js";
import { planReview } from "./plan.js";

export interface ActionLog {
  info(message: string): void;
  warning(message: string): void;
  setOutput(name: string, value: string): void;
  /** Markdown for the job summary page. */
  summary(markdown: string): void;
  fail(message: string): void;
}

export interface ActionDeps {
  eventName: string;
  payload: unknown;
  /** The checked-out repository. */
  workspace: string;
  /** ANTHROPIC_API_KEY and PR_MENTOR_* settings from the action inputs. */
  env: Record<string, string | undefined>;
  api: PullRequestApi;
  log: ActionLog;
  createLlm?: (apiKey: string) => LlmClient;
  staticOptions?: StaticPassOptions;
}

const status = (error: unknown) =>
  typeof error === "object" && error !== null && "status" in error ? error.status : undefined;

/** The Action: review the PR, post only new inline comments, refresh the summary. */
export async function runAction(deps: ActionDeps): Promise<number> {
  const { log } = deps;
  let pr;
  try {
    pr = prFromEvent(
      deps.eventName,
      deps.payload,
      deps.env.PR_MENTOR_TRUSTED_BASE_CHECKOUT === "true",
    );
  } catch (error) {
    if (error instanceof EventError) {
      log.fail(error.message);
      return 1;
    }
    throw error;
  }

  if (deps.eventName === "pull_request_target") {
    const checkout = await runCommand("git", ["rev-parse", "HEAD"], {
      cwd: deps.workspace,
      timeoutMs: 10_000,
    });
    if (checkout.exitCode !== 0 || checkout.stdout.trim() !== pr.baseSha) {
      log.fail("pull_request_target requires the workspace to be checked out at the PR base SHA.");
      return 1;
    }
  }

  const config = loadConfig(deps.env);
  const threshold = deps.env.PR_MENTOR_FAIL_ON?.trim();
  const failOn = threshold ? SeveritySchema.safeParse(threshold) : undefined;
  if (failOn && !failOn.success) {
    log.fail(`fail-on must be one of ${SeveritySchema.options.join(", ")}.`);
    return 1;
  }
  const apiKey = pr.fromFork ? undefined : deps.env.ANTHROPIC_API_KEY;
  const llm = apiKey
    ? (deps.createLlm ?? ((key) => createAnthropicLlmClient({ apiKey: key })))(apiKey)
    : null;
  if (!llm) {
    log.info(
      "No anthropic-api-key given: running the static checks only (Semgrep, Gitleaks, Ruff, ESLint, missing tests).",
    );
  }

  // Diff and read files at the PR head explicitly: the checkout may be a merge commit.
  const diff = await gitDiff(deps.workspace, pr.baseSha, pr.headSha);
  const started = Date.now();
  const result = await reviewDiff(diff, gitRepoContext(deps.workspace, pr.headSha), {
    config,
    llm,
    ...(deps.staticOptions ? { static: deps.staticOptions } : {}),
  });
  const report = renderMarkdown(result);
  log.summary(report);
  log.info(usageLine(result.llm, Date.now() - started));
  log.setOutput("findings", String(result.findings.length + result.hidden.length));
  log.setOutput("cost-usd", String(result.llm.costUsd ?? 0));

  if (pr.fromFork) {
    log.warning(
      "This PR comes from a fork. The static review is in the job summary instead of PR comments.",
    );
  } else {
    try {
      const plan = planReview({
        findings: result.findings,
        files: parseDiff(diff),
        existingComments: await deps.api.listInlineComments(pr),
      });
      const posted = await deps.api.createReview(
        pr,
        `PR Mentor left ${plan.post.length} new comment${plan.post.length === 1 ? "" : "s"}. The summary comment has the full review.`,
        plan.post,
      );
      if (posted.failed > 0)
        log.warning(`${posted.failed} comment(s) couldn't be placed on the diff and were skipped.`);
      await deps.api.upsertSummary(
        pr,
        summaryBody(report, { posted: posted.posted, alreadyPosted: plan.alreadyPosted }),
      );
      log.info(
        `Posted ${posted.posted} new inline comment(s); ${plan.alreadyPosted} were already on the PR.`,
      );
    } catch (error) {
      if (status(error) !== 403) throw error;
      log.warning(
        "GitHub refused to let the workflow comment. Give the job `permissions: pull-requests: write`. The review is in the job summary.",
      );
    }
  }

  const failure = failOn?.success ? reviewGateFailure(result, failOn.data) : undefined;
  if (failure) log.fail(failure);
  return failure ? 1 : 0;
}
