import { DEFAULT_CONFIG, type Finding } from "@pr-mentor/core";
import { describe, expect, it } from "vitest";
import { loadCases } from "../src/case.js";
import { CASES_DIR } from "../src/fixtures.js";
import { scoreCase } from "../src/match.js";
import { buildReport, checkThresholds, renderReport } from "../src/report.js";
import { runEval, type RunOutput } from "../src/run.js";

const cases = await loadCases(CASES_DIR);
const oracle = await runEval(cases, {
  mode: "oracle",
  config: DEFAULT_CONFIG,
  reps: 1,
  maxCostUsd: 5,
});

const dup: Finding = {
  file: "app/orders.py",
  line: 8,
  category: "security",
  severity: "critical",
  title: "SQL injection again",
  explanation: "e",
  suggestion: "s",
  references: [],
  confidence: 0.85,
  source: "semgrep",
  ruleId: "semgrep/py-sql-injection",
};

/** The oracle run plus one duplicate finding in mixed-orders and one error. */
function noisy(): RunOutput {
  const results = oracle.results.map((r) => {
    if (r.caseId !== "mixed-orders") return r;
    const findings = [...r.findings, dup];
    const meta = cases.find((c) => c.id === "mixed-orders")?.meta;
    if (!meta) throw new Error("missing case");
    return { ...r, findings, score: scoreCase(r.caseId, meta, findings) };
  });
  return {
    ...oracle,
    mode: "static",
    results,
    errors: [{ caseId: "sec-eval-input", rep: 1, kind: "llm-failed", detail: "rate limited" }],
  };
}

describe("renderReport", () => {
  const report = buildReport(noisy(), cases.length);
  const md = renderReport(report);

  it("opens with the run's shape: mode, cases, reps, errors, refusals and cost", () => {
    expect(md).toContain("# PR Mentor eval: static mode");
    expect(md).toContain("16 cases · 1 rep · 1 error · 0 refusals · Claude cost $0.0000");
  });

  it("has a per-category table with precision, recall, F1 and counts", () => {
    expect(md).toContain("| security | 88% | 100% | 93% | 7 | 1 | 0 |");
    expect(md).toContain("| tests | 100% | 100% | 100% | 3 | 0 | 0 |");
    expect(md).toContain("| **overall** |");
    expect(md).toContain("Clean PRs: 4/4 with zero findings");
  });

  it("explains every miss and false positive per case", () => {
    expect(md).toContain(
      "| mixed-orders | 3 | 1 | 0 | FP: security `app/orders.py:8` (semgrep/py-sql-injection) |",
    );
  });

  it("lists errors separately", () => {
    expect(md).toContain("## Errors (not scored)");
    expect(md).toContain("| sec-eval-input | 1 | llm-failed | rate limited |");
  });

  it("shows the change against a previous run", () => {
    const before = buildReport(oracle, cases.length);
    expect(renderReport(report, before)).toContain(
      "| security | 100% → 88% (−12) | 100% → 100% (±0) |",
    );
  });

  it("has no timestamps, so a committed baseline only changes when results do", () => {
    expect(md).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });
});

describe("checkThresholds", () => {
  it("lists every metric that fell below its threshold", () => {
    const report = buildReport(noisy(), cases.length);
    expect(
      checkThresholds(report, {
        security: { precision: 0.9, recall: 1 },
        tests: { precision: 1, recall: 1 },
        cleanZeroFindings: 4,
      }),
    ).toEqual(["security precision 88% is below 90%"]);
    expect(checkThresholds(report, { security: { precision: 0.85 } })).toEqual([]);
  });
});
