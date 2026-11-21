import { describe, expect, it } from "vitest";
import { FindingSchema } from "../../src/finding.js";
import { gitleaksTool, parseGitleaksReport } from "../../src/static/gitleaks.js";
import { ToolError } from "../../src/static/tool.js";
import { contextWith, fakeRunner, fakeWorkspace, toolFixture } from "./helpers.js";

const report = toolFixture("gitleaks.json");
const { toRepoPath } = fakeWorkspace();
const findings = parseGitleaksReport(report, toRepoPath);
const byLine = (file: string, line: number) => {
  const found = findings.find((f) => f.file === file && f.line === line);
  if (!found) throw new Error(`no finding at ${file}:${line}`);
  return found;
};

describe("parseGitleaksReport", () => {
  it("turns each leak into a security finding at the right repo file and line", () => {
    expect(findings.map((f) => [f.file, f.line, f.ruleId, f.category, f.source])).toEqual([
      [".env", 2, "gitleaks/generic-api-key", "security", "gitleaks"],
      ["app/settings.py", 5, "gitleaks/aws-access-token", "security", "gitleaks"],
      ["app/settings.py", 7, "gitleaks/generic-api-key", "security", "gitleaks"],
    ]);
  });

  it("never puts a raw secret or the matched text into a finding", () => {
    const serialized = JSON.stringify(findings);
    for (const leak of JSON.parse(report) as { Secret: string; Match: string }[]) {
      expect(serialized).not.toContain(leak.Secret);
      expect(serialized).not.toContain(leak.Match);
    }
  });

  it("shows the redacted secret so the student knows which key leaked", () => {
    expect(byLine("app/settings.py", 5).explanation).toContain("AKIA****MPLE");
  });

  it("rates provider keys critical and entropy-based generic matches lower", () => {
    const aws = byLine("app/settings.py", 5);
    const generic = byLine("app/settings.py", 7);
    expect(aws.severity).toBe("critical");
    expect(generic.severity).toBe("high");
    expect(generic.confidence).toBeLessThan(aws.confidence);
  });

  it("suggests an environment variable named after the variable in the code", () => {
    expect(byLine("app/settings.py", 7).suggestion).toContain('os.environ["API_TOKEN"]');
    expect(byLine("app/settings.py", 5).suggestion).toContain('os.environ["AWS_ACCESS_KEY_ID"]');
  });

  it("tells students to keep .env files out of git", () => {
    const suggestion = byLine(".env", 2).suggestion;
    expect(suggestion).toContain(".gitignore");
    expect(suggestion).toContain(".env.example");
  });

  it("produces findings that pass the Finding schema", () => {
    for (const finding of findings) expect(FindingSchema.safeParse(finding).success).toBe(true);
  });

  it("skips leaks in files outside the workspace", () => {
    expect(parseGitleaksReport(report, () => undefined)).toEqual([]);
  });

  it("returns no findings for an empty report", () => {
    expect(parseGitleaksReport("[]", toRepoPath)).toEqual([]);
    expect(parseGitleaksReport("", toRepoPath)).toEqual([]);
  });

  it("throws ToolError for output that isn't a Gitleaks JSON report", () => {
    expect(() => parseGitleaksReport("not json", toRepoPath)).toThrow(ToolError);
    expect(() => parseGitleaksReport('{"leaks": 3}', toRepoPath)).toThrow(ToolError);
  });
});

describe("gitleaksTool", () => {
  it("scans the workspace root and parses what Gitleaks prints", async () => {
    const runner = fakeRunner({ stdout: report });
    const result = await gitleaksTool.run([], contextWith(runner));
    expect(result.findings).toHaveLength(3);
    expect(runner.calls[0]?.command).toBe("gitleaks");
    expect(runner.calls[0]?.args).toContain(fakeWorkspace().root);
  });
});
