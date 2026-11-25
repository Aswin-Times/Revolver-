import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCommand } from "@pr-mentor/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ExistingInlineComment, InlineComment } from "../src/comments.js";
import { readFingerprint, SUMMARY_MARKER } from "../src/fingerprint.js";
import type { PullRequestApi } from "../src/github.js";
import { runAction, type ActionDeps } from "../src/run.js";

let repo: string;
let baseSha: string;
let headSha: string;
const git = async (...args: string[]) => {
  const r = await runCommand("git", args, { cwd: repo, timeoutMs: 30_000 });
  if (r.exitCode !== 0) throw new Error(r.stderr);
  return r.stdout.trim();
};

beforeAll(async () => {
  repo = mkdtempSync(join(tmpdir(), "pr-mentor-action-"));
  await git("init", "-q", "-b", "main");
  await git("config", "user.email", "t@example.com");
  await git("config", "user.name", "t");
  await git("config", "core.autocrlf", "false");
  writeFileSync(join(repo, "README.md"), "# Shop\n");
  await git("add", "-A");
  await git("commit", "-q", "-m", "base");
  baseSha = await git("rev-parse", "HEAD");
  writeFileSync(
    join(repo, "pricing.py"),
    "def apply_discount(price, percent):\n    if percent > 100:\n        raise ValueError('too big')\n    return price * (100 - percent) / 100\n",
  );
  await git("add", "-A");
  await git("commit", "-q", "-m", "add pricing");
  headSha = await git("rev-parse", "HEAD");
  // Simulate actions/checkout leaving the base checked out: the Action must use headSha, not HEAD.
  await git("checkout", "-q", baseSha);
}, 60_000);

afterAll(() => rmSync(repo, { recursive: true, force: true }));

function fakeApi(existing: ExistingInlineComment[] = []) {
  const reviews: { body: string; comments: InlineComment[] }[] = [];
  const summaries: string[] = [];
  const api: PullRequestApi = {
    listInlineComments: () => Promise.resolve(existing),
    createReview: (_pr, body, comments) => {
      if (comments.length > 0) reviews.push({ body, comments });
      return Promise.resolve({ posted: comments.length, failed: 0 });
    },
    upsertSummary: (_pr, body) => {
      summaries.push(body);
      return Promise.resolve();
    },
  };
  return { api, reviews, summaries };
}

function deps(overrides: Partial<ActionDeps> = {}) {
  const log = {
    info: [] as string[],
    warnings: [] as string[],
    outputs: {} as Record<string, string>,
    summary: [] as string[],
    failed: [] as string[],
  };
  const d: ActionDeps = {
    eventName: "pull_request",
    payload: {
      pull_request: {
        number: 3,
        base: { sha: baseSha },
        head: { sha: headSha, repo: { full_name: "class/shop" } },
      },
      repository: { name: "shop", owner: { login: "class" }, full_name: "class/shop" },
    },
    workspace: repo,
    env: {},
    api: fakeApi().api,
    staticOptions: { registry: [] },
    log: {
      info: (m) => log.info.push(m),
      warning: (m) => log.warnings.push(m),
      setOutput: (k, v) => (log.outputs[k] = v),
      summary: (md) => log.summary.push(md),
      fail: (m) => log.failed.push(m),
    },
    ...overrides,
  };
  return { d, log };
}

describe("runAction", () => {
  it("reviews base...head, posts new inline comments and the summary, and sets outputs", async () => {
    const gh = fakeApi();
    const { d, log } = deps({ api: gh.api });
    expect(await runAction(d)).toBe(0);
    expect(gh.reviews).toHaveLength(1);
    expect(gh.reviews[0]?.comments.map((c) => [c.path, c.line])).toEqual([["pricing.py", 1]]);
    expect(gh.summaries[0]).toContain(SUMMARY_MARKER);
    expect(log.summary[0]).toContain("# PR Mentor review");
    expect(log.outputs).toMatchObject({ findings: "1", "cost-usd": "0" });
    expect(log.info.join("\n")).toMatch(/static checks only/i);
  });

  it("posts nothing new on a second run, but still refreshes the summary", async () => {
    const first = fakeApi();
    await runAction(deps({ api: first.api }).d);
    const comments = first.reviews.flatMap((r) => r.comments);
    expect(comments.every((c) => readFingerprint(c.body))).toBe(true);

    const second = fakeApi(comments);
    expect(await runAction(deps({ api: second.api }).d)).toBe(0);
    expect(second.reviews).toEqual([]);
    expect(second.summaries[0]).toContain(
      "0 new inline comments on this push (1 already posted earlier)",
    );
  });

  it("doesn't try to comment on a PR from a fork (read-only token); the job summary still has the review", async () => {
    const gh = fakeApi();
    const { d, log } = deps({ api: gh.api });
    const payload = d.payload as { pull_request: { head: { repo: { full_name: string } } } };
    payload.pull_request.head.repo.full_name = "bob/shop";
    expect(await runAction(d)).toBe(0);
    expect(gh.reviews).toEqual([]);
    expect(gh.summaries).toEqual([]);
    expect(log.warnings.join("\n")).toMatch(/fork/i);
    expect(log.summary[0]).toContain("# PR Mentor review");
  });

  it("fails with a clear message when triggered by something other than a pull request", async () => {
    const { d, log } = deps({ eventName: "push" });
    expect(await runAction(d)).toBe(1);
    expect(log.failed[0]).toContain("push");
  });

  it("requires opt-in and the exact base checkout for pull_request_target", async () => {
    const eventName = "pull_request_target";
    expect(await runAction(deps({ eventName }).d)).toBe(1);

    const env = { PR_MENTOR_TRUSTED_BASE_CHECKOUT: "true" };
    const trusted = deps({ eventName, env });
    expect(await runAction(trusted.d)).toBe(0);
    expect(trusted.log.outputs.findings).toBe("1");

    const wrongCheckout = deps({ eventName, env });
    const payload = wrongCheckout.d.payload as { pull_request: { base: { sha: string } } };
    payload.pull_request.base.sha = headSha;
    expect(await runAction(wrongCheckout.d)).toBe(1);
    expect(wrongCheckout.log.failed[0]).toMatch(/PR base SHA/);
  });

  it("fails the check when a finding reaches fail-on", async () => {
    expect(await runAction(deps({ env: { PR_MENTOR_FAIL_ON: "medium" } }).d)).toBe(1);
    expect(await runAction(deps({ env: { PR_MENTOR_FAIL_ON: "high" } }).d)).toBe(0);
  });

  it("rejects invalid thresholds and fails a gated review when a scanner fails", async () => {
    const invalid = deps({ env: { PR_MENTOR_FAIL_ON: "urgent" } });
    expect(await runAction(invalid.d)).toBe(1);
    expect(invalid.log.failed[0]).toMatch(/fail-on must be/);

    const broken = deps({
      env: { PR_MENTOR_FAIL_ON: "critical" },
      staticOptions: {
        registry: [
          {
            name: "ruff",
            appliesTo: () => true,
            run: () => Promise.reject(new Error("failed")),
          },
        ],
      },
    });
    expect(await runAction(broken.d)).toBe(1);
    expect(broken.log.failed[0]).toMatch(/Incomplete checks: ruff/);
  });

  it("explains missing permissions instead of crashing when GitHub refuses the comments", async () => {
    const refusing: PullRequestApi = {
      ...fakeApi().api,
      listInlineComments: () =>
        Promise.reject(
          Object.assign(new Error("Resource not accessible by integration"), { status: 403 }),
        ),
    };
    const { d, log } = deps({ api: refusing });
    expect(await runAction(d)).toBe(0);
    expect(log.warnings.join("\n")).toMatch(/pull-requests: write/);
  });
});
