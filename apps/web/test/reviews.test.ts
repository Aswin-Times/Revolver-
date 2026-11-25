import { describe, expect, it } from "vitest";
import { parseReport, storedReviews, summarize } from "../src/reviews.js";

const metadata = {
  id: "one",
  title: "review",
  repository: "class/repo",
  date: "2026-11-25T00:00:00Z",
};
const finding = {
  title: "Missing coverage",
  severity: "medium",
  category: "tests",
  file: "src/cart.ts",
  line: 6,
  explanation: "New behavior has no tests.",
  suggestion: "Add a regression test.",
  ruleId: "heuristic/missing-tests",
};
const report = { status: "ok", stats: { files: 1 }, findings: [finding], hidden: [] };

describe("dashboard reports", () => {
  it("includes hidden findings from the CLI output and restores browser records", () => {
    const parsed = parseReport(
      JSON.stringify({ ...report, hidden: [{ ...finding, severity: "high" }] }),
      metadata,
    );
    expect(parsed.findings.map((item) => item.severity)).toEqual(["medium", "high"]);
    expect(storedReviews(JSON.stringify([parsed]))).toEqual([parsed]);
  });

  it("rejects unrelated JSON, malformed findings, and invalid stored dates", () => {
    expect(() => parseReport("{", metadata)).toThrow(/valid JSON/);
    expect(() => parseReport("{}", metadata)).toThrow(/CLI report/);
    expect(() =>
      parseReport(
        JSON.stringify({ ...report, findings: [{ ...finding, severity: "other" }] }),
        metadata,
      ),
    ).toThrow(/CLI report/);
    expect(
      storedReviews(
        JSON.stringify([
          { ...metadata, date: "yesterday", findings: [], status: "ok", message: "" },
        ]),
      ),
    ).toBeUndefined();
  });

  it("counts a recurring issue once per review and ignores unassigned repositories", () => {
    const first = parseReport(JSON.stringify({ ...report, hidden: [finding] }), metadata);
    const second = parseReport(JSON.stringify(report), { ...metadata, id: "two", repository: "" });
    expect(summarize([first, second])).toEqual({
      counts: { critical: 0, high: 0, medium: 3, low: 0 },
      total: 3,
      repositories: 1,
      recurring: [{ title: "Missing coverage", reviews: 2 }],
    });
  });
});
