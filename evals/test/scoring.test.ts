import type { Finding } from "@pr-mentor/core";
import { describe, expect, it } from "vitest";
import type { CaseMeta } from "../src/case.js";
import { scoreCase } from "../src/match.js";
import { aggregate, computeMetrics, summarizeReps } from "../src/metrics.js";

const meta = (overrides: Partial<CaseMeta> = {}): CaseMeta => ({
  title: "t",
  tags: [],
  groundTruth: "human-written",
  clean: false,
  expected: [{ file: "app.py", lines: [10, 12], category: "security", why: "w" }],
  allowed: [],
  ...overrides,
});

const found = (overrides: Partial<Finding> = {}): Finding => ({
  file: "app.py",
  line: 11,
  category: "security",
  severity: "high",
  title: "t",
  explanation: "e",
  suggestion: "s",
  references: [],
  confidence: 0.8,
  source: "semgrep",
  ...overrides,
});

describe("scoreCase", () => {
  it("matches a finding inside the expected range", () => {
    const s = scoreCase("c", meta(), [found()]);
    expect([s.tp.length, s.fp.length, s.fn.length]).toEqual([1, 0, 0]);
  });

  it("accepts a line up to 2 outside the range, but not 3", () => {
    expect(scoreCase("c", meta(), [found({ line: 8 })]).tp).toHaveLength(1);
    expect(scoreCase("c", meta(), [found({ line: 14 })]).tp).toHaveLength(1);
    expect(scoreCase("c", meta(), [found({ line: 15 })]).tp).toHaveLength(0);
  });

  it("counts a multi-line finding that overlaps the range", () => {
    expect(scoreCase("c", meta(), [found({ line: 2, endLine: 9 })]).tp).toHaveLength(1);
  });

  it("doesn't match a different category or file", () => {
    const s = scoreCase("c", meta(), [found({ category: "quality" }), found({ file: "b.py" })]);
    expect([s.tp.length, s.fp.length, s.fn.length]).toEqual([0, 2, 1]);
  });

  it("lets each expected finding be claimed once; a duplicate is a false positive", () => {
    const s = scoreCase("c", meta(), [found({ line: 11 }), found({ line: 12, source: "lint" })]);
    expect([s.tp.length, s.fp.length]).toEqual([1, 1]);
  });

  it("gives the closest finding the match when several qualify", () => {
    const s = scoreCase("c", meta(), [
      found({ line: 14, title: "far" }),
      found({ line: 11, title: "near" }),
    ]);
    expect(s.tp[0]?.found.title).toBe("near");
  });

  it("neither rewards nor punishes findings listed as allowed", () => {
    const s = scoreCase(
      "c",
      meta({
        allowed: [
          { file: "app.py", category: "quality" },
          { file: "x.py", category: "tests", lines: [1, 3] },
        ],
      }),
      [
        found(),
        found({ category: "quality", line: 40 }),
        found({ file: "x.py", category: "tests", line: 9 }),
      ],
    );
    expect([s.tp.length, s.allowed.length, s.fp.length]).toEqual([1, 1, 1]);
  });
});

describe("computeMetrics", () => {
  const scores = [
    scoreCase("hit", meta(), [found(), found({ category: "quality", line: 50 })]),
    scoreCase("miss", meta(), []),
    scoreCase("clean-ok", meta({ clean: true, expected: [] }), []),
    scoreCase("clean-noisy", meta({ clean: true, expected: [] }), [found({ category: "tests" })]),
  ];
  const m = computeMetrics(scores);

  it("computes precision, recall and F1 per category and overall", () => {
    expect(m.byCategory.security).toMatchObject({ tp: 1, fp: 0, fn: 1, precision: 1, recall: 0.5 });
    expect(m.byCategory.security.f1).toBeCloseTo(2 / 3);
    expect(m.byCategory.quality).toMatchObject({ tp: 0, fp: 1, fn: 0, precision: 0 });
    expect(m.byCategory.quality.recall).toBeUndefined();
    expect(m.overall).toMatchObject({ tp: 1, fp: 2, fn: 1 });
  });

  it("reports precision as undefined (not 0) when nothing was predicted", () => {
    const quiet = computeMetrics([scoreCase("miss", meta(), [])]);
    expect(quiet.byCategory.security.precision).toBeUndefined();
    expect(quiet.byCategory.security.recall).toBe(0);
  });

  it("tracks how many clean PRs stayed clean", () => {
    expect(m.clean).toEqual({ cases: 2, zeroFindings: 1, findings: 1 });
  });
});

describe("aggregate and summarizeReps", () => {
  it("gives mean and sample standard deviation, ignoring undefined values", () => {
    const a = aggregate([0.5, 1, undefined]);
    expect(a.mean).toBeCloseTo(0.75);
    expect(a.stdev).toBeCloseTo(Math.sqrt(0.125));
    expect(a.n).toBe(2);
    expect(aggregate([undefined])).toEqual({ n: 0 });
  });

  it("summarises per-category precision and recall across reps", () => {
    const rep1 = computeMetrics([scoreCase("a", meta(), [found()])]);
    const rep2 = computeMetrics([scoreCase("a", meta(), [])]);
    const summary = summarizeReps([rep1, rep2]);
    expect(summary.security.recall.mean).toBeCloseTo(0.5);
    expect(summary.security.precision).toMatchObject({ mean: 1, n: 1 });
  });
});
