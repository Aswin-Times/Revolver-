import { getOctokit } from "@actions/github";
import type { InlineComment } from "./comments.js";
import type { PrRef } from "./event.js";
import { isSummary, readFingerprint } from "./fingerprint.js";

/** Everything the Action needs from GitHub. Tests drive the real client with a fake fetch. */
export interface PullRequestApi {
  /** Bodies of review comments PR Mentor posted earlier (identified by their marker). */
  listCommentBodies(pr: PrRef): Promise<string[]>;
  createReview(
    pr: PrRef,
    body: string,
    comments: InlineComment[],
  ): Promise<{ posted: number; failed: number }>;
  /** Create the summary comment, or edit the one from an earlier run. */
  upsertSummary(pr: PrRef, body: string): Promise<void>;
}

const status = (error: unknown) =>
  typeof error === "object" && error !== null && "status" in error ? error.status : undefined;

const toApi = (c: InlineComment) => ({
  path: c.path,
  line: c.line,
  side: c.side,
  ...(c.startLine !== undefined ? { start_line: c.startLine, start_side: "RIGHT" as const } : {}),
  body: c.body,
});

export function createGitHubApi(
  token: string,
  options: { fetch?: typeof fetch } = {},
): PullRequestApi {
  const octokit = getOctokit(token, options.fetch ? { request: { fetch: options.fetch } } : {});

  return {
    async listCommentBodies(pr) {
      const comments = await octokit.paginate(octokit.rest.pulls.listReviewComments, {
        owner: pr.owner,
        repo: pr.repo,
        pull_number: pr.number,
        per_page: 100,
      });
      return comments.map((c) => c.body).filter((body) => readFingerprint(body) !== undefined);
    },

    async createReview(pr, body, comments) {
      if (comments.length === 0) return { posted: 0, failed: 0 };
      const target = {
        owner: pr.owner,
        repo: pr.repo,
        pull_number: pr.number,
        commit_id: pr.headSha,
      };
      try {
        await octokit.rest.pulls.createReview({
          ...target,
          event: "COMMENT",
          body,
          comments: comments.map(toApi),
        });
        return { posted: comments.length, failed: 0 };
      } catch (error) {
        if (status(error) !== 422) throw error;
      }
      // One comment GitHub can't place makes it reject the whole review: post them one by one.
      let posted = 0;
      let failed = 0;
      for (const comment of comments) {
        try {
          await octokit.rest.pulls.createReviewComment({ ...target, ...toApi(comment) });
          posted++;
        } catch (error) {
          if (status(error) !== 422) throw error;
          failed++;
        }
      }
      return { posted, failed };
    },

    async upsertSummary(pr, body) {
      const comments = await octokit.paginate(octokit.rest.issues.listComments, {
        owner: pr.owner,
        repo: pr.repo,
        issue_number: pr.number,
        per_page: 100,
      });
      const existing = comments.find((c) => isSummary(c.body ?? ""));
      if (existing) {
        await octokit.rest.issues.updateComment({
          owner: pr.owner,
          repo: pr.repo,
          comment_id: existing.id,
          body,
        });
      } else {
        await octokit.rest.issues.createComment({
          owner: pr.owner,
          repo: pr.repo,
          issue_number: pr.number,
          body,
        });
      }
    },
  };
}
