/**
 * Runs the real tools. Each block is skipped when its tool isn't installed, so the suite
 * works anywhere. CI sets PR_MENTOR_REQUIRE_TOOLS=1, which turns a missing tool into a
 * failure, so these tests can never be skipped there by accident.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseDiff } from "../../src/diff/parse.js";
import type { FileDiff } from "../../src/diff/types.js";
import { runCommand, ToolNotFoundError } from "../../src/static/exec.js";
import { gitleaksTool } from "../../src/static/gitleaks.js";
import { ruffTool } from "../../src/static/ruff.js";
import { runStaticPass } from "../../src/static/run.js";
import { SEMGREP_RULES_DIR, semgrepTool } from "../../src/static/semgrep.js";
import type { ToolContext } from "../../src/static/tool.js";
import { createWorkspace, type Workspace } from "../../src/static/workspace.js";

async function installed(command: string, versionArgs = ["--version"]): Promise<boolean> {
  let ok = false;
  try {
    const result = await runCommand(command, versionArgs, { cwd: ".", timeoutMs: 60_000 });
    ok = result.exitCode === 0;
  } catch (error) {
    if (!(error instanceof ToolNotFoundError)) throw error;
  }
  if (!ok && process.env.PR_MENTOR_REQUIRE_TOOLS === "1") {
    throw new Error(`${command} must be installed when PR_MENTOR_REQUIRE_TOOLS=1`);
  }
  return ok;
}

/** A diff that adds `content` as a brand-new file, plus a repo that serves it. */
function newFile(
  path: string,
  content: string,
): { files: FileDiff[]; read: Record<string, string> } {
  const lines = content.replace(/\n$/, "").split("\n");
  const diff = [
    "--- /dev/null",
    `+++ b/${path}`,
    `@@ -0,0 +1,${lines.length} @@`,
    ...lines.map((l) => `+${l}`),
    "",
  ].join("\n");
  return { files: parseDiff(diff), read: { [path]: content } };
}

let ws: Workspace | undefined;
afterEach(async () => {
  await ws?.dispose();
  ws = undefined;
});

async function contextFor(change: ReturnType<typeof newFile>): Promise<ToolContext> {
  ws = await createWorkspace(change.files, {
    readFile: (p) => Promise.resolve(change.read[p]),
  });
  return { workspace: ws, runner: runCommand, timeoutMs: 120_000 };
}

describe.skipIf(!(await installed("gitleaks", ["version"])))("gitleaks (real)", () => {
  // Built at runtime so no real-looking key is ever committed (GitHub push protection).
  const awsKey = ["AKIA", "QYLPMN5H", "HHFQZOXK"].join("");

  it("finds a hardcoded AWS key on the right line without exposing it", async () => {
    const ctx = await contextFor(
      newFile(
        "app/storage.py",
        `import boto3\n\nclient = boto3.client(\n    "s3",\n    aws_access_key_id="${awsKey}",\n)\n`,
      ),
    );
    const { findings } = await gitleaksTool.run(ctx.workspace.files, ctx);
    expect(findings.map((f) => [f.file, f.line, f.ruleId])).toEqual([
      ["app/storage.py", 5, "gitleaks/aws-access-token"],
    ]);
    expect(JSON.stringify(findings)).not.toContain(awsKey);
  });

  it("reports nothing for a clean file", async () => {
    const ctx = await contextFor(newFile("app/ok.py", "def add(a, b):\n    return a + b\n"));
    expect((await gitleaksTool.run(ctx.workspace.files, ctx)).findings).toEqual([]);
  });
});

const FLASK_SQLI = `from flask import Flask, request
import sqlite3

app = Flask(__name__)


@app.route("/user")
def user():
    conn = sqlite3.connect("app.db")
    user_id = request.args["id"]
    return str(conn.execute(f"SELECT * FROM users WHERE id = {user_id}").fetchone())
`;

describe.skipIf(!(await installed("ruff")))("ruff (real)", () => {
  it("finds SQL injection in a Flask route on the right line", async () => {
    const ctx = await contextFor(newFile("app/routes.py", FLASK_SQLI));
    const { findings } = await ruffTool.run(ctx.workspace.files, ctx);
    expect(findings.find((f) => f.ruleId === "ruff/S608")).toMatchObject({
      file: "app/routes.py",
      line: 11,
      category: "security",
    });
  });

  it("ignores repo config that tries to switch rules off", async () => {
    const ctx = await contextFor(newFile("app/routes.py", FLASK_SQLI));
    // Without --isolated, this config really does silence S608 (checked against Ruff 0.17).
    writeFileSync(
      join(ctx.workspace.root, "ruff.toml"),
      '[lint.per-file-ignores]\n"app/routes.py" = ["S608"]\n',
    );
    const { findings } = await ruffTool.run(ctx.workspace.files, ctx);
    expect(findings.map((f) => f.ruleId)).toContain("ruff/S608");
  });

  it("ignores # noqa comments, so they can't hide a finding from the reviewer", async () => {
    const silenced = FLASK_SQLI.replace(".fetchone())", ".fetchone())  # noqa: S608");
    const ctx = await contextFor(newFile("app/routes.py", silenced));
    const { findings } = await ruffTool.run(ctx.workspace.files, ctx);
    expect(findings.map((f) => f.ruleId)).toContain("ruff/S608");
  });
});

describe.skipIf(!(await installed("semgrep")))("semgrep (real)", { timeout: 180_000 }, () => {
  it("finds SQL injection in a Flask route with our rules", async () => {
    const ctx = await contextFor(newFile("app/routes.py", FLASK_SQLI));
    const { findings } = await semgrepTool.run(ctx.workspace.files, ctx);
    expect(findings.map((f) => [f.file, f.line, f.ruleId])).toContainEqual([
      "app/routes.py",
      11,
      "semgrep/py-sql-injection",
    ]);
  });

  it("covers TypeScript too", async () => {
    const ctx = await contextFor(
      newFile(
        "src/users.ts",
        [
          'import type { Pool } from "pg";',
          "",
          "export async function findUser(db: Pool, id: string) {",
          "  return db.query(`SELECT * FROM users WHERE id = ${id}`);",
          "}",
          "",
        ].join("\n"),
      ),
    );
    const { findings } = await semgrepTool.run(ctx.workspace.files, ctx);
    expect(findings.map((f) => [f.line, f.ruleId])).toEqual([[4, "semgrep/js-sql-injection"]]);
  });

  // One rule file at a time: semgrep --test loads configs in parallel, which races on
  // ~/.semgrep/settings.yml on Windows.
  it.each([
    ["python.yml", "python.py"],
    ["javascript.yml", "javascript.js"],
    ["react.yml", "react.jsx"],
  ])("passes the annotated test cases for %s", async (config, target) => {
    const result = await runCommand(
      "semgrep",
      ["--test", "--metrics=off", "--disable-version-check", "--config", config, target],
      { cwd: SEMGREP_RULES_DIR, timeoutMs: 170_000 },
    );
    expect(result.stdout + result.stderr).toContain("All tests passed");
    expect(result.exitCode).toBe(0);
  });
});

const allInstalled =
  (await installed("gitleaks", ["version"])) &&
  (await installed("ruff")) &&
  (await installed("semgrep"));

describe.skipIf(!allInstalled)("runStaticPass with every real tool", { timeout: 240_000 }, () => {
  it("runs all four tools on a mixed change and keeps findings on added lines", async () => {
    const awsKey = ["AKIA", "QYLPMN5H", "HHFQZOXK"].join("");
    const py = newFile(
      "app/routes.py",
      FLASK_SQLI.replace("app = Flask(__name__)", `app = Flask(__name__)\nAWS_KEY = "${awsKey}"`),
    );
    const js = newFile(
      "web/run.js",
      "export function run(req) {\n  return eval(req.query.code);\n}\n",
    );
    const read = { ...py.read, ...js.read };

    const result = await runStaticPass([...py.files, ...js.files], {
      readFile: (p) => Promise.resolve(read[p]),
    });

    expect(result.tools.map((t) => [t.tool, t.status])).toEqual([
      ["gitleaks", "ran"],
      ["semgrep", "ran"],
      ["ruff", "ran"],
      ["eslint", "ran"],
    ]);
    const ids = result.findings.map((f) => f.ruleId);
    expect(ids).toEqual(
      expect.arrayContaining([
        "gitleaks/aws-access-token",
        "semgrep/py-sql-injection",
        "ruff/S608",
        "eslint/no-eval",
      ]),
    );
    expect(JSON.stringify(result)).not.toContain(awsKey);
    expect(result.redact(read["app/routes.py"] ?? "")).not.toContain(awsKey);
  });
});
