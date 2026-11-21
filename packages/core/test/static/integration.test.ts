/**
 * Runs the real tools. Each block is skipped when its tool isn't installed, so `pnpm test`
 * works anywhere; CI installs all of them so these always run there.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseDiff } from "../../src/diff/parse.js";
import type { FileDiff } from "../../src/diff/types.js";
import { runCommand, ToolNotFoundError } from "../../src/static/exec.js";
import { gitleaksTool } from "../../src/static/gitleaks.js";
import { ruffTool } from "../../src/static/ruff.js";
import type { ToolContext } from "../../src/static/tool.js";
import { createWorkspace, type Workspace } from "../../src/static/workspace.js";

async function installed(command: string, versionArgs = ["--version"]): Promise<boolean> {
  try {
    const result = await runCommand(command, versionArgs, { cwd: ".", timeoutMs: 60_000 });
    return result.exitCode === 0;
  } catch (error) {
    if (error instanceof ToolNotFoundError) return false;
    throw error;
  }
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
});
