import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseDiff } from "../../src/diff/parse.js";
import type { Finding } from "../../src/finding.js";
import type { RepoContext } from "../../src/repo.js";
import { ToolNotFoundError } from "../../src/static/exec.js";
import { runStaticPass } from "../../src/static/run.js";
import { ToolError, type StaticTool, type ToolName } from "../../src/static/tool.js";
import type { WorkspaceFile } from "../../src/static/workspace.js";

// app.py: line 1 unchanged, lines 2-3 added. web/app.js: lines 1-2 added.
const files = parseDiff(
  [
    "--- a/app.py",
    "+++ b/app.py",
    "@@ -1 +1,3 @@",
    " import os",
    "+x = 1",
    "+y = 2",
    "--- /dev/null",
    "+++ b/web/app.js",
    "@@ -0,0 +1,2 @@",
    "+const a = 1;",
    "+const b = 2;",
    "--- /dev/null",
    "+++ b/../evil.py",
    "@@ -0,0 +1 @@",
    "+pwned = True",
    "",
  ].join("\n"),
);

const repo: RepoContext = {
  readFile: (path) =>
    Promise.resolve(
      { "app.py": "import os\nx = 1\ny = 2\n", "web/app.js": "const a = 1;\nconst b = 2;\n" }[path],
    ),
};

const finding = (file: string, line: number, title = "t"): Finding => ({
  file,
  line,
  category: "quality",
  severity: "low",
  title,
  explanation: "e",
  suggestion: "s",
  references: [],
  confidence: 0.9,
  source: "lint",
});

interface FakeToolOptions {
  name: ToolName;
  ext?: RegExp;
  findings?: Finding[];
  error?: Error;
  seen?: { files: WorkspaceFile[]; dir: string }[];
}

function fakeTool({ name, ext = /./, findings = [], error, seen }: FakeToolOptions): StaticTool {
  return {
    name,
    appliesTo: (file) => ext.test(file.path),
    run(toolFiles, ctx) {
      seen?.push({ files: toolFiles, dir: ctx.workspace.dir });
      return error ? Promise.reject(error) : Promise.resolve({ findings });
    },
  };
}

describe("runStaticPass", () => {
  it("gives each tool only the files it checks and skips tools with nothing to check", async () => {
    const seen: { files: WorkspaceFile[]; dir: string }[] = [];
    const result = await runStaticPass(files, repo, {
      registry: [
        fakeTool({ name: "ruff", ext: /\.py$/, seen }),
        fakeTool({ name: "semgrep", ext: /\.go$/ }),
      ],
    });
    expect(seen[0]?.files.map((f) => f.path)).toEqual(["app.py"]);
    expect(result.tools).toEqual([
      expect.objectContaining({ tool: "ruff", status: "ran", findings: 0 }),
      expect.objectContaining({ tool: "semgrep", status: "skipped" }),
    ]);
  });

  it("reports a missing tool as skipped with an install hint and keeps going", async () => {
    const result = await runStaticPass(files, repo, {
      registry: [
        fakeTool({ name: "semgrep", error: new ToolNotFoundError("semgrep") }),
        fakeTool({ name: "ruff", findings: [finding("app.py", 2)] }),
      ],
    });
    const semgrep = result.tools.find((t) => t.tool === "semgrep");
    expect(semgrep?.status).toBe("skipped");
    expect(semgrep?.detail).toMatch(/install/i);
    expect(result.findings).toHaveLength(1);
  });

  it("reports a crashing tool as failed and keeps going", async () => {
    const result = await runStaticPass(files, repo, {
      registry: [
        fakeTool({ name: "gitleaks", error: new ToolError("gitleaks timed out after 120s") }),
        fakeTool({ name: "eslint", error: new Error("boom") }),
        fakeTool({ name: "ruff", findings: [finding("app.py", 3)] }),
      ],
    });
    expect(result.tools.map((t) => [t.tool, t.status, t.detail])).toEqual([
      ["gitleaks", "failed", "gitleaks timed out after 120s"],
      ["eslint", "failed", "boom"],
      ["ruff", "ran", undefined],
    ]);
    expect(result.findings).toHaveLength(1);
  });

  it("keeps only findings on added lines, sorted by file and line", async () => {
    const result = await runStaticPass(files, repo, {
      registry: [
        fakeTool({
          name: "semgrep",
          findings: [
            finding("web/app.js", 2),
            finding("app.py", 3),
            finding("app.py", 1), // unchanged line: dropped
            finding("app.py", 2),
          ],
        }),
      ],
    });
    expect(result.findings.map((f) => [f.file, f.line])).toEqual([
      ["app.py", 2],
      ["app.py", 3],
      ["web/app.js", 2],
    ]);
    expect(result.tools[0]?.findings).toBe(3);
  });

  it("runs only the tools asked for", async () => {
    const result = await runStaticPass(files, repo, {
      tools: ["ruff"],
      registry: [fakeTool({ name: "ruff" }), fakeTool({ name: "semgrep" })],
    });
    expect(result.tools.map((t) => t.tool)).toEqual(["ruff"]);
  });

  it("lists files that couldn't be copied into the workspace", async () => {
    const result = await runStaticPass(files, repo, { registry: [] });
    expect(result.skippedFiles).toEqual([{ path: "../evil.py", reason: "unsafe-path" }]);
  });

  it("deletes the workspace afterwards, even when a tool throws", async () => {
    const seen: { files: WorkspaceFile[]; dir: string }[] = [];
    await runStaticPass(files, repo, {
      registry: [
        fakeTool({ name: "ruff", seen }),
        fakeTool({ name: "eslint", error: new Error("boom"), seen }),
      ],
    });
    expect(seen).toHaveLength(2);
    expect(existsSync(seen[0]!.dir)).toBe(false);
  });
});
