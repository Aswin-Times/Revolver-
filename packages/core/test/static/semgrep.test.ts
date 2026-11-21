import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { FindingSchema } from "../../src/finding.js";
import {
  parseSemgrepOutput,
  RuleMetadataSchema,
  SEMGREP_RULES_DIR,
  semgrepTool,
} from "../../src/static/semgrep.js";
import { ToolError } from "../../src/static/tool.js";
import type { WorkspaceFile } from "../../src/static/workspace.js";
import { contextWith, FIXTURE_ROOT, fakeRunner, fakeWorkspace, toolFixture } from "./helpers.js";

const output = toolFixture("semgrep.json");
const { toRepoPath } = fakeWorkspace();
const { findings, unparsable } = parseSemgrepOutput(output, toRepoPath);

describe("parseSemgrepOutput", () => {
  it("maps results to findings at the right repo file and line (Windows paths too)", () => {
    expect(findings.map((f) => [f.file, f.line, f.ruleId, f.source])).toEqual([
      ["app/db.py", 3, "semgrep/py-sql-injection", "semgrep"],
      ["web/ping.js", 4, "semgrep/js-command-injection", "semgrep"],
    ]);
  });

  it("uses the teaching text and links from our rule's metadata", () => {
    const sql = findings[0];
    expect(sql).toMatchObject({
      category: "security",
      severity: "critical",
      title: "SQL query built by inserting a value into the query text",
      confidence: 0.85,
    });
    expect(sql?.suggestion).toContain('cursor.execute("SELECT * FROM users WHERE id = ?"');
    expect(sql?.references[0]?.url).toContain("owasp.org");
  });

  it("reports files Semgrep couldn't parse instead of turning them into findings", () => {
    expect(unparsable).toEqual(["web/broken.js"]);
  });

  it("falls back to a cautious generic finding when a result has no usable metadata", () => {
    const json = JSON.stringify({
      results: [
        {
          check_id: "some.other.rule",
          path: `${FIXTURE_ROOT}/app/x.py`,
          start: { line: 2 },
          end: { line: 2 },
          extra: { message: "Something risky", metadata: {} },
        },
      ],
      errors: [],
    });
    const [finding] = parseSemgrepOutput(json, toRepoPath).findings;
    expect(finding).toMatchObject({
      file: "app/x.py",
      title: "Something risky",
      ruleId: "semgrep/rule",
      severity: "medium",
    });
    expect(finding?.confidence).toBeLessThanOrEqual(0.5);
  });

  it("produces findings that pass the Finding schema", () => {
    for (const finding of findings) expect(FindingSchema.safeParse(finding).success).toBe(true);
  });

  it("handles empty results, unknown files and garbage", () => {
    expect(parseSemgrepOutput('{"results": [], "errors": []}', toRepoPath).findings).toEqual([]);
    expect(parseSemgrepOutput(output, () => undefined).findings).toEqual([]);
    expect(() => parseSemgrepOutput("nope", toRepoPath)).toThrow(ToolError);
    expect(() => parseSemgrepOutput('{"results": 1}', toRepoPath)).toThrow(ToolError);
  });
});

describe("our Semgrep ruleset", () => {
  const ruleFiles = readdirSync(SEMGREP_RULES_DIR).filter((f) => f.endsWith(".yml"));
  const rules = ruleFiles.flatMap((file) => {
    const doc = parseYaml(readFileSync(join(SEMGREP_RULES_DIR, file), "utf8")) as {
      rules: { id: string; metadata: unknown }[];
    };
    return doc.rules.map((rule) => ({ file, ...rule }));
  });
  const testCases = readdirSync(SEMGREP_RULES_DIR)
    .filter((f) => !f.endsWith(".yml"))
    .map((f) => readFileSync(join(SEMGREP_RULES_DIR, f), "utf8"))
    .join("\n");

  it("has rules for Python, JavaScript/TypeScript and React", () => {
    expect(ruleFiles.sort()).toEqual(["javascript.yml", "python.yml", "react.yml"]);
    expect(rules.length).toBeGreaterThanOrEqual(15);
  });

  it.each(rules.map((r) => [r.id, r]))("%s has valid student-facing metadata", (_id, rule) => {
    expect(RuleMetadataSchema.safeParse(rule.metadata).error?.issues ?? []).toEqual([]);
  });

  it("uses unique ids without dots (we read the id from the end of Semgrep's check_id)", () => {
    const ids = rules.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9-]+$/);
  });

  it("has at least one positive test case per rule", () => {
    for (const { id } of rules) expect(testCases).toMatch(new RegExp(`ruleid: ${id}\\b`));
  });
});

const wsFile = (path: string, partial = false): WorkspaceFile => ({
  path,
  absPath: `${FIXTURE_ROOT}/${path}`,
  partial,
});

describe("semgrepTool", () => {
  it("scans complete Python, JavaScript and TypeScript files", () => {
    for (const path of ["a.py", "b.js", "c.jsx", "d.ts", "e.tsx", "f.mjs", "g.cjs"]) {
      expect(semgrepTool.appliesTo(wsFile(path))).toBe(true);
    }
    expect(semgrepTool.appliesTo(wsFile("a.py", true))).toBe(false);
    expect(semgrepTool.appliesTo(wsFile("README.md"))).toBe(false);
  });

  it("runs our ruleset with telemetry off and parses the result", async () => {
    const runner = fakeRunner({ stdout: output });
    const files = [wsFile("app/db.py"), wsFile("web/ping.js"), wsFile("web/broken.js")];
    const result = await semgrepTool.run(files, contextWith(runner));

    const args = runner.calls[0]?.args ?? [];
    expect(runner.calls[0]?.command).toBe("semgrep");
    expect(args).toEqual(expect.arrayContaining(["--config", SEMGREP_RULES_DIR, "--metrics=off"]));
    expect(args).toEqual(expect.arrayContaining(files.map((f) => f.absPath)));
    expect(result.findings).toHaveLength(2);
    expect(result.detail).toContain("web/broken.js");
  });
});
