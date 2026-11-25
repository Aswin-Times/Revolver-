import { parseDiff, type Finding } from "@pr-mentor/core";
import { describe, expect, it } from "vitest";
import { inlineBody, summaryBody } from "../src/comments.js";
import { marker, readFingerprint, SUMMARY_MARKER } from "../src/fingerprint.js";
import { planReview } from "../src/plan.js";

const CODE = [
  "def find_user(conn, name):",
  "    query = f\"SELECT * FROM users WHERE name = '{name}'\"",
  "    return conn.execute(query).fetchone()",
];
const diffFor = (start: number, lines: string[]) =>
  parseDiff(
    [
      "--- a/app/users.py",
      "+++ b/app/users.py",
      `@@ -0,0 +${start},${lines.length} @@`,
      ...lines.map((l) => `+${l}`),
      "",
    ].join("\n"),
  );

const finding = (overrides: Partial<Finding> = {}): Finding => ({
  file: "app/users.py",
  line: 2,
  category: "security",
  severity: "critical",
  title: "SQL query built from user input",
  explanation: "The name goes straight into the SQL text.",
  suggestion: '```python\nconn.execute("SELECT * FROM users WHERE name = ?", (name,))\n```',
  references: [
    { title: "OWASP SQL Injection", url: "https://owasp.org/www-community/attacks/SQL_Injection" },
  ],
  confidence: 0.9,
  source: "semgrep",
  ruleId: "semgrep/py-sql-injection",
  ...overrides,
});

describe("planReview", () => {
  it("posts every finding the first time, on the right line, with a fingerprint marker", () => {
    const plan = planReview({
      findings: [finding()],
      files: diffFor(1, CODE),
      existingComments: [],
    });
    expect(plan.alreadyPosted).toBe(0);
    expect(plan.post).toHaveLength(1);
    expect(plan.post[0]).toMatchObject({ path: "app/users.py", line: 2, side: "RIGHT" });
    expect(readFingerprint(plan.post[0]?.body ?? "")).toMatch(/^[0-9a-f]{16}$/);
  });

  it("posts nothing on a re-run with the same findings", () => {
    const first = planReview({
      findings: [finding()],
      files: diffFor(1, CODE),
      existingComments: [],
    });
    const again = planReview({
      findings: [finding()],
      files: diffFor(1, CODE),
      existingComments: first.post,
    });
    expect(again).toEqual({ post: [], alreadyPosted: 1 });
  });

  it("doesn't re-post when a push moves the code further down", () => {
    const first = planReview({
      findings: [finding()],
      files: diffFor(1, CODE),
      existingComments: [],
    });
    const shifted = planReview({
      findings: [finding({ line: 12 })],
      files: diffFor(11, CODE),
      existingComments: first.post.map((comment) => ({ ...comment, line: comment.line + 10 })),
    });
    expect(shifted.post).toEqual([]);
  });

  it("posts each occurrence of identical code and only skips the already-commented line", () => {
    const files = diffFor(1, [...CODE, "", ...CODE]);
    const findings = [finding(), finding({ line: 6 })];
    const first = planReview({ findings, files, existingComments: [] });
    expect(first.post.map((comment) => comment.line)).toEqual([2, 6]);

    const next = planReview({ findings, files, existingComments: first.post.slice(0, 1) });
    expect(next.alreadyPosted).toBe(1);
    expect(next.post.map((comment) => comment.line)).toEqual([6]);
  });

  it("posts only the new finding after a push", () => {
    const first = planReview({
      findings: [finding()],
      files: diffFor(1, CODE),
      existingComments: [],
    });
    const next = planReview({
      findings: [
        finding(),
        finding({ line: 3, category: "quality", severity: "low", ruleId: "ruff/F841", title: "x" }),
      ],
      files: diffFor(1, CODE),
      existingComments: first.post,
    });
    expect(next.post.map((c) => c.line)).toEqual([3]);
  });

  it("sends a multi-line comment only when both ends are in the same hunk", () => {
    const together = planReview({
      findings: [finding({ line: 2, endLine: 3 })],
      files: diffFor(1, CODE),
      existingComments: [],
    });
    expect(together.post[0]).toMatchObject({ startLine: 2, line: 3 });
    const apart = planReview({
      findings: [finding({ line: 2, endLine: 30 })],
      files: diffFor(1, CODE),
      existingComments: [],
    });
    expect(apart.post[0]).toMatchObject({ line: 2 });
    expect(apart.post[0]).not.toHaveProperty("startLine");
  });

  it("skips a finding whose line isn't in the diff (GitHub would reject it)", () => {
    expect(
      planReview({
        findings: [finding({ line: 99 })],
        files: diffFor(1, CODE),
        existingComments: [],
      }).post,
    ).toEqual([]);
  });
});

describe("comment bodies", () => {
  it("renders an inline comment with title, explanation, fix, links and the marker last", () => {
    const body = inlineBody(finding(), "abcdef0123456789");
    expect(body).toMatch(/^### 🔴 Critical · Security: SQL query built from user input/);
    expect(body).toContain("**Suggested fix**");
    expect(body).toContain(
      "[OWASP SQL Injection](https://owasp.org/www-community/attacks/SQL_Injection)",
    );
    expect(body.trimEnd().endsWith(marker("abcdef0123456789"))).toBe(true);
  });

  it("redacts secrets one last time before anything is posted", () => {
    const key = ["AKIA", "QYLPMN5H", "HHFQZOXK"].join("");
    expect(
      inlineBody(finding({ explanation: `Key ${key} leaked` }), "abcdef0123456789"),
    ).not.toContain(key);
  });

  it("marks the summary so the next run can find and update it", () => {
    expect(
      summaryBody("# PR Mentor review\n\nAll good.", { posted: 2, alreadyPosted: 1 }),
    ).toContain(SUMMARY_MARKER);
    expect(summaryBody("# PR Mentor review", { posted: 2, alreadyPosted: 1 })).toContain(
      "2 new inline comments on this push (1 already posted earlier)",
    );
  });
});
