import type { Finding } from "../src/finding.js";
import type { ReviewResult } from "../src/review/review.js";
import { describe, expect, it } from "vitest";
import { renderMarkdown, usageLine } from "../src/render.js";

const finding = (overrides: Partial<Finding> = {}): Finding => ({
  file: "app/routes.py",
  line: 12,
  category: "security",
  severity: "critical",
  title: "SQL query built from user input",
  explanation: "The id goes straight into the SQL text.",
  suggestion: '```python\ndb.execute("SELECT * FROM users WHERE id = ?", (user_id,))\n```',
  references: [
    { title: "OWASP SQL Injection", url: "https://owasp.org/www-community/attacks/SQL_Injection" },
  ],
  confidence: 0.9,
  source: "semgrep",
  ruleId: "semgrep/py-sql-injection",
  ...overrides,
});

const result = (overrides: Partial<ReviewResult> = {}): ReviewResult => ({
  status: "ok",
  findings: [
    finding(),
    finding({
      title: "New function `user` has no tests",
      category: "tests",
      severity: "medium",
      line: 3,
      source: "heuristic",
      ruleId: "heuristic/missing-tests",
      references: [],
    }),
  ],
  hidden: [
    finding({
      title: "Unused import",
      severity: "low",
      category: "quality",
      line: 1,
      source: "lint",
      ruleId: "ruff/F401",
    }),
  ],
  rejected: [],
  tools: [
    { tool: "semgrep", status: "ran", findings: 1, durationMs: 4000 },
    {
      tool: "ruff",
      status: "skipped",
      detail: "Ruff isn't installed.",
      findings: 0,
      durationMs: 0,
    },
  ],
  llm: {
    status: "ran",
    model: "claude-sonnet-5-5",
    servedBy: "claude-sonnet-5-5",
    usage: {
      inputTokens: 12_340,
      outputTokens: 2_100,
      cacheReadTokens: 3_000,
      cacheWriteTokens: 0,
    },
    costUsd: 0.0461,
    omittedFiles: [],
    summary: "Nice, focused change! Fix the SQL query first.",
    confirmed: 1,
    rejected: 0,
    added: 0,
    dropped: 0,
  },
  skippedFiles: [{ path: "package-lock.json", reason: "lockfile" }],
  notScanned: [],
  stats: { bytes: 1000, files: 1, additions: 3, deletions: 0 },
  ...overrides,
});

describe("renderMarkdown", () => {
  const md = renderMarkdown(result());

  it("opens with Claude's summary and a count by severity", () => {
    expect(md).toContain("# PR Mentor review");
    expect(md).toContain("Nice, focused change! Fix the SQL query first.");
    expect(md).toContain("**3 findings**: 🔴 1 critical · 🟡 1 medium · 🔵 1 low");
  });

  it("renders each shown finding with badge, location, who found it, fix and links", () => {
    expect(md).toContain("## 🔴 Critical · Security: SQL query built from user input");
    expect(md).toContain("`app/routes.py:12` · found by Semgrep (`semgrep/py-sql-injection`)");
    expect(md).toContain("The id goes straight into the SQL text.");
    expect(md).toContain("**Suggested fix**");
    expect(md).toContain(
      "Learn more: [OWASP SQL Injection](https://owasp.org/www-community/attacks/SQL_Injection)",
    );
    expect(md).toContain("found by the missing-tests check");
  });

  it("collapses findings beyond the cap", () => {
    expect(md).toContain("<details><summary>1 more finding</summary>");
    expect(md).toContain("- 🔵 Unused import (`app/routes.py:1`, found by Ruff)");
  });

  it("explains how the review was made: tools, Claude, tokens, cost and skipped files", () => {
    expect(md).toContain("| Semgrep | ran | 1 |");
    expect(md).toContain("| Ruff | skipped | 0 | Ruff isn't installed. |");
    expect(md).toContain(
      "| Claude (claude-sonnet-5-5) | ran | 1 confirmed, 0 rejected, 0 added | 12,340 in / 2,100 out / 3,000 cached tokens · $0.0461 |",
    );
    expect(md).toContain("Not reviewed: `package-lock.json` (lockfile)");
  });

  it("says when Claude was skipped, and why", () => {
    const skipped = renderMarkdown(
      result({
        llm: {
          ...result().llm,
          status: "skipped",
          detail: "No Anthropic credentials found.",
          summary: undefined,
          usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
          costUsd: 0,
        },
      }),
    );
    expect(skipped).toContain("| Claude (claude-sonnet-5-5) | skipped |");
    expect(skipped).toContain("No Anthropic credentials found.");
  });

  it("celebrates a clean review", () => {
    expect(renderMarkdown(result({ findings: [], hidden: [] }))).toContain("No issues found");
  });

  it("shows the friendly message for a PR that's too large", () => {
    const md2 = renderMarkdown(
      result({ status: "too_large", message: "This PR changes 4,812 lines... Try splitting it." }),
    );
    expect(md2).toContain("This PR changes 4,812 lines... Try splitting it.");
  });

  it("keeps odd file paths from breaking the inline code", () => {
    expect(
      renderMarkdown(result({ findings: [finding({ file: "we`ird.py" })], hidden: [] })),
    ).toContain("`we'ird.py:12`");
  });
});

describe("usageLine", () => {
  it("summarises model, tokens, cost and time for the log", () => {
    expect(usageLine(result().llm, 7_250)).toBe(
      "pr-mentor: claude-sonnet-5-5 · 12,340 in / 2,100 out / 3,000 cached tokens · $0.0461 · 7.3s",
    );
  });
});
