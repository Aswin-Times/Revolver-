import { describe, expect, it } from "vitest";
import { FindingSchema } from "../src/finding.js";

const valid = {
  file: "app/routes.py",
  line: 12,
  endLine: 14,
  category: "security",
  severity: "critical",
  title: "SQL query built with string formatting",
  explanation:
    "Building SQL with f-strings lets a user change the query itself. Anyone could read or delete every row.",
  suggestion: 'cursor.execute("SELECT * FROM users WHERE id = ?", (user_id,))',
  references: [
    {
      title: "OWASP: SQL Injection",
      url: "https://owasp.org/www-community/attacks/SQL_Injection",
    },
  ],
  confidence: 0.9,
  source: "llm",
};

describe("FindingSchema", () => {
  it("accepts a valid finding unchanged", () => {
    expect(FindingSchema.parse(valid)).toEqual(valid);
  });

  it("accepts a single-line finding with no references", () => {
    const { endLine: _endLine, ...rest } = valid;
    const minimal = { ...rest, references: [] };
    expect(FindingSchema.parse(minimal)).toEqual(minimal);
  });

  it("accepts endLine equal to line", () => {
    expect(FindingSchema.safeParse({ ...valid, line: 7, endLine: 7 }).success).toBe(true);
  });

  it("keeps an optional ruleId", () => {
    expect(FindingSchema.parse({ ...valid, ruleId: "ruff/S608" }).ruleId).toBe("ruff/S608");
  });

  it("strips unknown keys instead of rejecting the finding", () => {
    const parsed = FindingSchema.parse({ ...valid, reasoning: "model scratchpad" });
    expect(parsed).not.toHaveProperty("reasoning");
  });

  it.each([
    ["an unknown category", { category: "style" }],
    ["an unknown severity", { severity: "blocker" }],
    ["an unknown source", { source: "sonarqube" }],
    ["confidence above 1", { confidence: 1.01 }],
    ["confidence below 0", { confidence: -0.1 }],
    ["line 0", { line: 0 }],
    ["a fractional line", { line: 1.5 }],
    ["endLine before line", { line: 10, endLine: 9 }],
    ["an empty file path", { file: "" }],
    ["an empty title", { title: "" }],
    ["a title over 120 characters", { title: "x".repeat(121) }],
    ["an empty explanation", { explanation: "" }],
    ["an empty suggestion", { suggestion: "" }],
    ["an empty ruleId", { ruleId: "" }],
    ["a reference with an empty title", { references: [{ title: "", url: "https://owasp.org" }] }],
    ["a plain http reference", { references: [{ title: "Docs", url: "http://example.com" }] }],
    [
      "a javascript: reference",
      { references: [{ title: "Click me", url: "javascript:alert(document.cookie)" }] },
    ],
    ["a reference that is not a URL", { references: [{ title: "Docs", url: "see the docs" }] }],
  ])("rejects %s", (_case, override) => {
    expect(FindingSchema.safeParse({ ...valid, ...override }).success).toBe(false);
  });
});
