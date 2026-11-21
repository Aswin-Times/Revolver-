import { describe, expect, it } from "vitest";
import { FindingSchema } from "../../src/finding.js";
import { parseRuffOutput, ruffTool } from "../../src/static/ruff.js";
import { ToolError } from "../../src/static/tool.js";
import type { WorkspaceFile } from "../../src/static/workspace.js";
import { contextWith, FIXTURE_ROOT, fakeRunner, fakeWorkspace, toolFixture } from "./helpers.js";

const output = toolFixture("ruff.json");
const { toRepoPath } = fakeWorkspace();
const { findings, unparsable } = parseRuffOutput(output, toRepoPath);
const byRule = (code: string) => {
  const found = findings.find((f) => f.ruleId === `ruff/${code}`);
  if (!found) throw new Error(`no ruff/${code} finding`);
  return found;
};

describe("parseRuffOutput", () => {
  it("maps diagnostics to findings at the right repo file and line", () => {
    expect([byRule("S608"), byRule("F401"), byRule("C901")].map((f) => [f.file, f.line])).toEqual([
      ["app/views.py", 8],
      ["app/views.py", 1],
      ["app/report.py", 1],
    ]);
    expect(findings.every((f) => f.source === "lint")).toBe(true);
  });

  it.each([
    ["S608", "security", "critical"],
    ["S602", "security", "critical"],
    ["S307", "security", "critical"],
    ["S301", "security", "high"],
    ["E722", "quality", "medium"],
    ["S110", "quality", "medium"],
    ["BLE001", "quality", "medium"],
    ["B006", "quality", "medium"],
    ["F821", "quality", "high"],
    ["F401", "quality", "low"],
    ["F841", "quality", "low"],
    ["C901", "quality", "medium"],
    ["PLR0915", "quality", "medium"],
    ["PLR0912", "quality", "medium"],
    ["PLR0913", "quality", "low"],
    ["ERA001", "quality", "low"],
  ])("rates %s as %s / %s", (code, category, severity) => {
    expect(byRule(code)).toMatchObject({ category, severity });
  });

  it("links Ruff's docs for every rule and OWASP for SQL injection", () => {
    expect(byRule("F401").references.map((r) => r.url)).toContain(
      "https://docs.astral.sh/ruff/rules/unused-import",
    );
    expect(byRule("S608").references.some((r) => r.url.includes("owasp.org"))).toBe(true);
  });

  it("teaches the fix for common mistakes", () => {
    expect(byRule("S608").suggestion).toContain('execute("SELECT * FROM users WHERE id = ?"');
    expect(byRule("B006").suggestion).toContain("cache=None");
    expect(byRule("S110").explanation).toMatch(/log/i);
  });

  it("keeps Ruff's specific message as the title", () => {
    expect(byRule("F401").title).toBe("`os` imported but unused");
    expect(byRule("C901").title).toBe("`build_report` is too complex (31 > 10)");
  });

  it("keeps the end line of multi-line diagnostics", () => {
    expect(byRule("S110")).toMatchObject({ line: 19, endLine: 20 });
  });

  it("drops syntax errors and reports which files couldn't be parsed", () => {
    expect(findings.some((f) => f.file === "app/broken.py")).toBe(false);
    expect(unparsable).toEqual(["app/broken.py"]);
  });

  it("produces findings that pass the Finding schema", () => {
    for (const finding of findings) expect(FindingSchema.safeParse(finding).success).toBe(true);
  });

  it("handles empty output, unknown files and garbage", () => {
    expect(parseRuffOutput("[]", toRepoPath).findings).toEqual([]);
    expect(parseRuffOutput(output, () => undefined).findings).toEqual([]);
    expect(() => parseRuffOutput("oops", toRepoPath)).toThrow(ToolError);
    expect(() => parseRuffOutput('[{"code": 5}]', toRepoPath)).toThrow(ToolError);
  });
});

const wsFile = (path: string, partial = false): WorkspaceFile => ({
  path,
  absPath: `${FIXTURE_ROOT}/${path}`,
  partial,
});

describe("ruffTool", () => {
  it("only checks complete Python files", () => {
    expect(ruffTool.appliesTo(wsFile("app/views.py"))).toBe(true);
    expect(ruffTool.appliesTo(wsFile("app/views.py", true))).toBe(false);
    expect(ruffTool.appliesTo(wsFile("web/app.js"))).toBe(false);
  });

  it("runs isolated from repo config on the given files and reports unparsable ones", async () => {
    const runner = fakeRunner({ stdout: output });
    const files = [wsFile("app/views.py"), wsFile("app/broken.py")];
    const result = await ruffTool.run(files, contextWith(runner));

    const args = runner.calls[0]?.args ?? [];
    expect(runner.calls[0]?.command).toBe("ruff");
    expect(args).toContain("--isolated");
    expect(args).toEqual(expect.arrayContaining(files.map((f) => f.absPath)));
    expect(result.findings.length).toBeGreaterThan(10);
    expect(result.detail).toContain("app/broken.py");
  });
});
