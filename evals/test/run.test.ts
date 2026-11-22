import { DEFAULT_CONFIG, type Finding, type ReviewResult } from "@pr-mentor/core";
import { describe, expect, it } from "vitest";
import { loadCases, type EvalCase } from "../src/case.js";
import { CASES_DIR } from "../src/fixtures.js";
import { computeMetrics } from "../src/metrics.js";
import { runEval, type ReviewFn } from "../src/run.js";

const cases = await loadCases(CASES_DIR);
const one = cases.find((c) => c.id === "sec-flask-sqli") as EvalCase;
const sqlFinding: Finding = {
  file: "app/users.py",
  line: 12,
  category: "security",
  severity: "critical",
  title: "SQL injection",
  explanation: "e",
  suggestion: "s",
  references: [],
  confidence: 0.9,
  source: "llm",
};

const llmReport = (overrides: Partial<ReviewResult["llm"]> = {}): ReviewResult["llm"] => ({
  status: "ran",
  model: "claude-sonnet-5-5",
  servedBy: "claude-sonnet-5-5",
  usage: { inputTokens: 1000, outputTokens: 500, cacheReadTokens: 0, cacheWriteTokens: 0 },
  costUsd: 0.6,
  omittedFiles: [],
  confirmed: 0,
  rejected: 0,
  added: 1,
  dropped: 0,
  ...overrides,
});

const fakeReview =
  (llm: Partial<ReviewResult["llm"]> = {}, findings: Finding[] = [sqlFinding]): ReviewFn =>
  () =>
    Promise.resolve({
      status: "ok",
      findings,
      hidden: [],
      rejected: [],
      tools: [],
      llm: llmReport(llm),
      skippedFiles: [],
      notScanned: [],
      stats: { bytes: 1, files: 1, additions: 1, deletions: 0 },
    });

const options = { config: DEFAULT_CONFIG, reps: 1, maxCostUsd: 5 };

describe("runEval harness self-checks", () => {
  it("scores 100% precision and recall when fed the expected answers (oracle)", async () => {
    const out = await runEval(cases, { ...options, mode: "oracle" });
    const m = computeMetrics(out.results.map((r) => r.score));
    expect(m.overall).toMatchObject({ precision: 1, recall: 1 });
    expect(m.clean).toEqual({ cases: 4, zeroFindings: 4, findings: 0 });
    expect(out.errors).toEqual([]);
  });

  it("scores zero recall but clean PRs pass when nothing is reported (null)", async () => {
    const out = await runEval(cases, { ...options, mode: "null" });
    const m = computeMetrics(out.results.map((r) => r.score));
    expect(m.overall.recall).toBe(0);
    expect(m.overall.precision).toBeUndefined();
    expect(m.clean.zeroFindings).toBe(4);
  });
});

describe("runEval in full mode", () => {
  it("scores what students see and records Claude's usage and cost", async () => {
    const out = await runEval([one], { ...options, mode: "full", review: fakeReview() });
    expect(out.results).toHaveLength(1);
    expect(out.results[0]?.score.tp).toHaveLength(1);
    expect(out.results[0]?.llm).toMatchObject({ status: "ran", costUsd: 0.6 });
    expect(out.costUsd).toBeCloseTo(0.6);
  });

  it("puts a failed Claude pass in errors instead of scoring it as a miss", async () => {
    const out = await runEval([one], {
      ...options,
      mode: "full",
      review: fakeReview({
        status: "failed",
        detail: "rate limited",
        servedBy: undefined,
        costUsd: 0,
      }),
    });
    expect(out.results).toEqual([]);
    expect(out.errors).toEqual([
      { caseId: "sec-flask-sqli", rep: 1, kind: "llm-failed", detail: "rate limited" },
    ]);
  });

  it("flags an answer served by a different model and doesn't score it", async () => {
    const out = await runEval([one], {
      ...options,
      mode: "full",
      review: fakeReview({ servedBy: "claude-sonnet-5" }),
    });
    expect(out.results).toEqual([]);
    expect(out.errors[0]).toMatchObject({ kind: "wrong-model" });
  });

  it("counts refusals separately and still scores the static review", async () => {
    const out = await runEval([one], {
      ...options,
      mode: "full",
      review: fakeReview({ status: "declined", detail: "cyber" }, []),
    });
    expect(out.refusals).toBe(1);
    expect(out.results).toHaveLength(1);
  });

  it("runs every rep and stops once the cost cap is reached", async () => {
    const out = await runEval([one, one, one], {
      ...options,
      mode: "full",
      reps: 1,
      maxCostUsd: 1,
      review: fakeReview(),
    });
    expect(out.results).toHaveLength(2);
    expect(out.stoppedByCostCap).toBe(true);

    const reps = await runEval([one], { ...options, mode: "full", reps: 3, review: fakeReview() });
    expect(reps.results.map((r) => r.rep)).toEqual([1, 2, 3]);
  });

  it("records a crash in the review as a harness error", async () => {
    const out = await runEval([one], {
      ...options,
      mode: "full",
      review: () => Promise.reject(new Error("boom")),
    });
    expect(out.errors).toEqual([
      { caseId: "sec-flask-sqli", rep: 1, kind: "harness-error", detail: "boom" },
    ]);
  });
});

describe("runEval in static mode", () => {
  it("runs once per case (it's deterministic) and never calls Claude", async () => {
    const seen: unknown[] = [];
    const review: ReviewFn = (diff, repo, opts) => {
      seen.push(opts?.llm);
      return fakeReview({ status: "skipped", servedBy: undefined, costUsd: 0 })(diff, repo, opts);
    };
    const out = await runEval([one], { ...options, mode: "static", reps: 3, review });
    expect(out.results).toHaveLength(1);
    expect(seen).toEqual([null]);
  });
});
