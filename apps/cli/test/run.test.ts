import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  LlmUnavailableError,
  runCommand,
  type LlmClient,
  type ReviewResult,
} from "@pr-mentor/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { run, type RunDeps } from "../src/run.js";

let repo: string;
const git = async (...args: string[]) => {
  const result = await runCommand("git", args, { cwd: repo, timeoutMs: 30_000 });
  if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout;
};

const ROUTES = [
  "def user(db, request):",
  "    user_id = request.args['id']",
  '    return db.execute(f"SELECT * FROM users WHERE id = {user_id}")',
  "",
].join("\n");

beforeAll(async () => {
  repo = mkdtempSync(join(tmpdir(), "pr-mentor-cli-"));
  await git("init", "-q", "-b", "main");
  await git("config", "user.email", "test@example.com");
  await git("config", "user.name", "test");
  await git("config", "core.autocrlf", "false");
  writeFileSync(join(repo, "README.md"), "# Demo\n");
  await git("add", "-A");
  await git("commit", "-q", "-m", "base");
  await git("checkout", "-q", "-b", "feature");
  writeFileSync(join(repo, "app.py"), ROUTES);
  await git("add", "-A");
  await git("commit", "-q", "-m", "add route");
}, 60_000);

afterAll(() => rmSync(repo, { recursive: true, force: true }));

function harness(overrides: Partial<RunDeps> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const deps: RunDeps = {
    cwd: repo,
    env: {},
    stdout: (text) => out.push(text),
    stderr: (text) => err.push(text),
    staticOptions: { registry: [] },
    createLlm: () => null,
    ...overrides,
  };
  return { deps, out: () => out.join(""), err: () => err.join("") };
}

describe("pr-mentor review", () => {
  it("reviews the branch against --base and prints JSON", async () => {
    const h = harness();
    const code = await run(["review", "--base", "main", "--no-llm", "--format", "json"], h.deps);
    expect(code).toBe(0);
    const result = JSON.parse(h.out()) as ReviewResult;
    expect(result.status).toBe("ok");
    expect(result.findings.map((f) => [f.file, f.ruleId])).toEqual([
      ["app.py", "heuristic/missing-tests"],
    ]);
  });

  it("prints a markdown report by default and a usage line on stderr", async () => {
    const h = harness();
    expect(await run(["review", "--base", "main", "--no-llm"], h.deps)).toBe(0);
    expect(h.out()).toContain("# PR Mentor review");
    expect(h.out()).toContain("`app.py:1`");
    expect(h.err()).toContain("pr-mentor:");
  });

  it("reviews a saved diff file and writes the report to --out", async () => {
    const diffPath = join(repo, "..", `${repo.split(/[\\/]/).pop() ?? "x"}.diff`);
    writeFileSync(diffPath, await git("diff", "main...HEAD"));
    const outPath = join(repo, "..", "report.md");
    const h = harness();
    expect(await run(["review", "--diff", diffPath, "--out", outPath, "--no-llm"], h.deps)).toBe(0);
    expect(readFileSync(outPath, "utf8")).toContain("# PR Mentor review");
    rmSync(diffPath);
    rmSync(outPath);
  });

  it("exits 1 when a finding reaches --fail-on", async () => {
    const h = harness();
    expect(await run(["review", "--base", "main", "--no-llm", "--fail-on", "medium"], h.deps)).toBe(
      1,
    );
    expect(
      await run(["review", "--base", "main", "--no-llm", "--fail-on", "high"], harness().deps),
    ).toBe(0);
  });

  it("still delivers the static review when Claude has no credentials", async () => {
    const noCreds: LlmClient = {
      countTokens: () =>
        Promise.reject(
          new LlmUnavailableError(
            "No Anthropic credentials found. Set ANTHROPIC_API_KEY.",
            "no-credentials",
          ),
        ),
      complete: () => Promise.reject(new Error("unreachable")),
    };
    const h = harness({ createLlm: () => noCreds });
    expect(await run(["review", "--base", "main"], h.deps)).toBe(0);
    expect(h.out()).toContain("No Anthropic credentials found");
    expect(h.out()).toContain("missing-tests check");
  });

  it("exits 2 with a clear message for bad usage, a bad diff or a bad base", async () => {
    const usage = harness();
    expect(await run(["review"], usage.deps)).toBe(2);
    expect(usage.err()).toContain("--diff or --base");

    const notDiff = join(repo, "..", "notes.txt");
    writeFileSync(notDiff, "just some notes\n");
    const bad = harness();
    expect(await run(["review", "--diff", notDiff, "--no-llm"], bad.deps)).toBe(2);
    expect(bad.err()).toMatch(/doesn't look like a unified diff/);
    rmSync(notDiff);

    const base = harness();
    expect(await run(["review", "--base", "no-such-branch", "--no-llm"], base.deps)).toBe(2);
    expect(base.err()).toMatch(/git diff/);
  });

  it("prints help", async () => {
    const h = harness();
    expect(await run(["--help"], h.deps)).toBe(0);
    expect(h.out()).toContain("pr-mentor review");
  });
});
