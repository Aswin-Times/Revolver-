import { describe, expect, it } from "vitest";
import type { Finding } from "../../src/finding.js";
import { numberStaticFindings } from "../../src/llm/prompt.js";
import { mergeFindings } from "../../src/review/merge.js";
import { rankFindings } from "../../src/review/rank.js";

const f = (overrides: Partial<Finding> = {}): Finding => ({
  file: "app.py",
  line: 10,
  category: "security",
  severity: "high",
  title: "t",
  explanation: "tool explanation",
  suggestion: "tool fix",
  references: [],
  confidence: 0.8,
  source: "semgrep",
  ...overrides,
});

describe("mergeFindings", () => {
  const sql = f({ title: "SQL", ruleId: "semgrep/py-sql-injection" });
  const secret = f({ title: "Key", line: 3, source: "gitleaks" });
  const unused = f({
    title: "Unused",
    line: 20,
    category: "quality",
    severity: "low",
    source: "lint",
  });
  const notSent = f({ title: "Not sent", file: "big.py" });
  const items = numberStaticFindings([sql, secret, unused]);

  it("applies Claude's confirmations, drops rejections and keeps unmentioned findings", () => {
    const llm = f({ title: "LLM", line: 12, source: "llm", confidence: 0.7 });
    const { findings, rejected } = mergeFindings({
      staticFindings: [sql, secret, unused, notSent],
      staticItems: items,
      verdicts: [
        {
          id: "S1",
          verdict: "confirm",
          why: "user input",
          severity: "critical",
          explanation: "Claude's words",
        },
        { id: "S2", verdict: "reject", why: "test fixture" },
      ],
      llmFindings: [llm],
    });
    expect(findings.map((x) => x.title)).toEqual(["SQL", "Unused", "Not sent", "LLM"]);
    expect(findings[0]).toMatchObject({
      severity: "critical",
      explanation: "Claude's words",
      suggestion: "tool fix",
      source: "semgrep",
      ruleId: "semgrep/py-sql-injection",
    });
    expect(findings[0]?.confidence).toBeCloseTo(0.9);
    expect(rejected).toEqual([{ finding: secret, why: "test fixture" }]);
  });

  it("caps a confirmed finding's confidence at 0.95", () => {
    const { findings } = mergeFindings({
      staticFindings: [f({ confidence: 0.9 })],
      staticItems: numberStaticFindings([]),
      verdicts: [],
      llmFindings: [],
    });
    expect(findings[0]?.confidence).toBe(0.9);
    const sure = f({ confidence: 0.92 });
    const confirmed = mergeFindings({
      staticFindings: [sure],
      staticItems: numberStaticFindings([sure]),
      verdicts: [{ id: "S1", verdict: "confirm", why: "yes" }],
      llmFindings: [],
    });
    expect(confirmed.findings[0]?.confidence).toBe(0.95);
  });

  it("retains high-confidence security findings and their original severity floor", () => {
    const secret = f({ source: "gitleaks", severity: "critical", confidence: 0.95 });
    const vulnerable = f({ confidence: 0.9 });
    const result = mergeFindings({
      staticFindings: [secret, vulnerable],
      staticItems: numberStaticFindings([secret, vulnerable]),
      verdicts: [
        { id: "S1", verdict: "reject", why: "looks like a fixture" },
        { id: "S2", verdict: "confirm", severity: "low", why: "looks harmless" },
      ],
      llmFindings: [],
    });
    expect(result.findings.map((finding) => finding.severity)).toEqual(["critical", "high"]);
    expect(result.rejected[0]?.why).toBe("looks like a fixture");
  });
});

describe("rankFindings", () => {
  const opts = { maxComments: 15, minConfidence: 0.5 };

  it("collapses overlapping findings of the same file and category into the best one", () => {
    const { shown } = rankFindings(
      [
        f({ title: "ruff", source: "lint", severity: "critical", line: 10 }),
        f({ title: "semgrep", source: "semgrep", severity: "critical", line: 9, endLine: 11 }),
        f({ title: "llm", source: "llm", severity: "high", line: 10 }),
        f({ title: "other category", category: "quality", line: 10 }),
        f({ title: "other file", file: "b.py", line: 10 }),
        f({ title: "far away", line: 40 }),
      ],
      opts,
    );
    expect(shown.map((x) => x.title)).toEqual([
      "semgrep",
      "far away",
      "other file",
      "other category",
    ]);
  });

  it("orders by severity, then security > tests > quality, then confidence", () => {
    const { shown } = rankFindings(
      [
        f({ title: "low sec", severity: "low", line: 1 }),
        f({ title: "high quality", severity: "high", category: "quality", line: 2 }),
        f({ title: "high tests", severity: "high", category: "tests", line: 3 }),
        f({ title: "high sec unsure", severity: "high", confidence: 0.6, line: 4 }),
        f({ title: "high sec sure", severity: "high", confidence: 0.9, line: 5 }),
        f({ title: "critical", severity: "critical", category: "quality", line: 6 }),
      ],
      opts,
    );
    expect(shown.map((x) => x.title)).toEqual([
      "critical",
      "high sec sure",
      "high sec unsure",
      "high tests",
      "high quality",
      "low sec",
    ]);
  });

  it("drops findings below the confidence floor", () => {
    const { shown, hidden } = rankFindings([f({ confidence: 0.4 }), f({ line: 30 })], opts);
    expect(shown).toHaveLength(1);
    expect(hidden).toEqual([]);
  });

  it("shows at most maxComments and keeps the rest as hidden, in rank order", () => {
    const many = Array.from({ length: 5 }, (_, i) =>
      f({ title: `n${i}`, line: i * 10, confidence: 0.9 - i * 0.05 }),
    );
    const { shown, hidden } = rankFindings(many, { maxComments: 3, minConfidence: 0.5 });
    expect(shown.map((x) => x.title)).toEqual(["n0", "n1", "n2"]);
    expect(hidden.map((x) => x.title)).toEqual(["n3", "n4"]);
  });
});

describe("rankFindings: the same issue reported by two tools on nearby lines", () => {
  const opts = { maxComments: 15, minConfidence: 0.5 };

  it("merges the same kind of issue within 2 lines (Ruff S608 on 7, Semgrep on 8)", () => {
    const { shown } = rankFindings(
      [
        f({ title: "ruff", source: "lint", ruleId: "ruff/S608", line: 7, severity: "critical" }),
        f({ title: "semgrep", ruleId: "semgrep/py-sql-injection", line: 8, severity: "critical" }),
      ],
      opts,
    );
    expect(shown.map((x) => x.title)).toEqual(["semgrep"]);
  });

  it("keeps different issues on adjacent lines apart", () => {
    const { shown } = rankFindings(
      [
        f({ category: "quality", ruleId: "eslint/@typescript-eslint/no-unused-vars", line: 2 }),
        f({ category: "quality", ruleId: "eslint/eqeqeq", line: 3 }),
      ],
      opts,
    );
    expect(shown).toHaveLength(2);
  });

  it("keeps the same kind of issue apart when it is further away", () => {
    const { shown } = rankFindings(
      [f({ ruleId: "ruff/S608", line: 7 }), f({ ruleId: "semgrep/py-sql-injection", line: 10 })],
      opts,
    );
    expect(shown).toHaveLength(2);
  });

  it("only merges by proximity when both findings come from known rules", () => {
    const { shown } = rankFindings(
      [f({ ruleId: "ruff/S608", line: 7 }), f({ source: "llm", line: 8 })],
      opts,
    );
    expect(shown).toHaveLength(2);
  });
});
