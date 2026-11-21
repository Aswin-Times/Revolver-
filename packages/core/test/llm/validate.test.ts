import { describe, expect, it } from "vitest";
import { parseDiff } from "../../src/diff/parse.js";
import { FindingSchema } from "../../src/finding.js";
import type { LlmFinding, LlmReview } from "../../src/llm/schema.js";
import { validateLlmReview } from "../../src/llm/validate.js";

// app/routes.py shows lines 10 (context), 11-12 (added), 13 (context). Line 40 is not shown.
const files = parseDiff(
  [
    "--- a/app/routes.py",
    "+++ b/app/routes.py",
    "@@ -10,2 +10,4 @@",
    " def user():",
    "+    user_id = request.args['id']",
    '+    return db.execute(f"SELECT * FROM users WHERE id = {user_id}")',
    " ",
    "",
  ].join("\n"),
);

const finding = (overrides: Partial<LlmFinding> = {}): LlmFinding => ({
  file: "app/routes.py",
  line: 12,
  endLine: null,
  category: "security",
  severity: "critical",
  title: "SQL injection",
  explanation: "The id goes straight into the SQL text.",
  suggestion: '```python\ndb.execute("SELECT * FROM users WHERE id = ?", (user_id,))\n```',
  references: [
    { title: "OWASP SQL Injection", url: "https://owasp.org/www-community/attacks/SQL_Injection" },
  ],
  confidence: 0.8,
  ...overrides,
});

const review = (overrides: Partial<LlmReview> = {}): LlmReview => ({
  summary: "Nice start! One security issue to fix.",
  staticVerdicts: [],
  findings: [finding()],
  ...overrides,
});

describe("validateLlmReview", () => {
  it("turns a valid finding into a Finding from the LLM", () => {
    const { findings } = validateLlmReview(review(), files, []);
    expect(findings).toEqual([
      expect.objectContaining({
        file: "app/routes.py",
        line: 12,
        source: "llm",
        category: "security",
        references: [expect.objectContaining({ url: expect.stringContaining("owasp.org") })],
      }),
    ]);
    expect(findings[0]).not.toHaveProperty("endLine");
  });

  it("drops findings for files that aren't in the diff", () => {
    const result = validateLlmReview(
      review({ findings: [finding({ file: "app/secret.py" })] }),
      files,
      [],
    );
    expect(result.findings).toEqual([]);
    expect(result.dropped).toEqual([{ title: "SQL injection", reason: "unknown-file" }]);
  });

  it("drops findings on lines the diff doesn't show, but accepts visible context lines", () => {
    const result = validateLlmReview(
      review({ findings: [finding({ line: 40 }), finding({ line: 10, title: "context" })] }),
      files,
      [],
    );
    expect(result.findings.map((f) => f.line)).toEqual([10]);
    expect(result.dropped).toEqual([{ title: "SQL injection", reason: "line-not-in-diff" }]);
  });

  it("keeps a visible endLine and drops one that isn't shown", () => {
    const ok = validateLlmReview(
      review({ findings: [finding({ line: 11, endLine: 12 })] }),
      files,
      [],
    );
    expect(ok.findings[0]).toMatchObject({ line: 11, endLine: 12 });
    const far = validateLlmReview(
      review({ findings: [finding({ line: 11, endLine: 99 })] }),
      files,
      [],
    );
    expect(far.findings[0]).not.toHaveProperty("endLine");
  });

  it("removes references off the allowlist but keeps the finding", () => {
    const { findings } = validateLlmReview(
      review({
        findings: [finding({ references: [{ title: "Click", url: "https://evil.test/x" }] })],
      }),
      files,
      [],
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.references).toEqual([]);
  });

  it("caps LLM confidence at 0.9 and clamps nonsense values", () => {
    const { findings } = validateLlmReview(
      review({ findings: [finding({ confidence: 1.4 }), finding({ line: 11, confidence: -2 })] }),
      files,
      [],
    );
    expect(findings.map((f) => f.confidence)).toEqual([0.9, 0]);
  });

  it("sanitizes the text Claude wrote", () => {
    const { findings, summary } = validateLlmReview(
      review({
        summary: "Thanks @teacher!",
        findings: [finding({ explanation: "Ping @someone <script>alert(1)</script>" })],
      }),
      files,
      [],
    );
    expect(summary).toBe("Thanks `@teacher`!");
    expect(findings[0]?.explanation).toBe("Ping `@someone` &lt;script>alert(1)&lt;/script>");
  });

  it("drops findings left empty after sanitizing", () => {
    const { findings, dropped } = validateLlmReview(
      review({ findings: [finding({ title: "\u0000\u0001" })] }),
      files,
      [],
    );
    expect(findings).toEqual([]);
    expect(dropped[0]?.reason).toBe("invalid");
  });

  it("keeps verdicts only for known static findings, first verdict per id winning", () => {
    const { verdicts } = validateLlmReview(
      review({
        staticVerdicts: [
          {
            id: "S1",
            verdict: "reject",
            why: "Test fixture value.",
            severity: null,
            explanation: null,
            suggestion: null,
          },
          {
            id: "S1",
            verdict: "confirm",
            why: "dup",
            severity: null,
            explanation: null,
            suggestion: null,
          },
          {
            id: "S9",
            verdict: "confirm",
            why: "unknown id",
            severity: null,
            explanation: null,
            suggestion: null,
          },
          {
            id: "S2",
            verdict: "confirm",
            why: "Real issue.",
            severity: "high",
            explanation: "Better words @x",
            suggestion: null,
          },
        ],
      }),
      files,
      ["S1", "S2"],
    );
    expect(verdicts).toEqual([
      { id: "S1", verdict: "reject", why: "Test fixture value." },
      {
        id: "S2",
        verdict: "confirm",
        why: "Real issue.",
        severity: "high",
        explanation: "Better words `@x`",
      },
    ]);
  });

  it("only ever returns findings that pass the Finding schema", () => {
    const { findings } = validateLlmReview(
      review({
        findings: [finding(), finding({ line: 11, category: "quality", severity: "low" })],
      }),
      files,
      [],
    );
    for (const f of findings) expect(FindingSchema.safeParse(f).success).toBe(true);
  });
});
