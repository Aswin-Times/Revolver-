import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { gitDiff, GitError, gitRepoContext } from "../src/git.js";
import { runCommand } from "../src/static/exec.js";

let repo: string;
let base: string;
let head: string;
const git = async (...args: string[]) => {
  const r = await runCommand("git", args, { cwd: repo, timeoutMs: 30_000 });
  if (r.exitCode !== 0) throw new Error(r.stderr);
  return r.stdout.trim();
};

beforeAll(async () => {
  repo = mkdtempSync(join(tmpdir(), "pr-mentor-git-"));
  await git("init", "-q", "-b", "main");
  await git("config", "user.email", "t@example.com");
  await git("config", "user.name", "t");
  await git("config", "core.autocrlf", "false");
  writeFileSync(join(repo, "app.py"), "x = 1\n");
  await git("add", "-A");
  await git("commit", "-q", "-m", "base");
  base = await git("rev-parse", "HEAD");
  writeFileSync(join(repo, "app.py"), "x = 2\n");
  writeFileSync(join(repo, "new.py"), "y = 3\n");
  await git("add", "-A");
  await git("commit", "-q", "-m", "head");
  head = await git("rev-parse", "HEAD");
  // Uncommitted edits and a checked-out base must not leak into what we review.
  await git("checkout", "-q", base);
  writeFileSync(join(repo, "app.py"), "x = 'working tree'\n");
}, 60_000);

afterAll(() => rmSync(repo, { recursive: true, force: true }));

describe("gitDiff", () => {
  it("diffs base...head as committed, whatever is checked out", async () => {
    const diff = await gitDiff(repo, base, head);
    expect(diff).toContain("+x = 2");
    expect(diff).toContain("+++ b/new.py");
    expect(diff).not.toContain("working tree");
  });

  it("turns off external diff programs and textconv filters", async () => {
    const calls: string[][] = [];
    await gitDiff(repo, "a", "b", (_cmd, args) => {
      calls.push([...args]);
      return Promise.resolve({
        exitCode: 0,
        stdout: "",
        stderr: "",
        timedOut: false,
        truncated: false,
      });
    });
    expect(calls[0]).toEqual(expect.arrayContaining(["--no-ext-diff", "--no-textconv", "a...b"]));
  });

  it("throws a GitError naming the range when git fails", async () => {
    await expect(gitDiff(repo, "nope", head)).rejects.toThrow(GitError);
    await expect(gitDiff(repo, "nope", head)).rejects.toThrow(/nope\.\.\./);
  });
});

describe("gitRepoContext", () => {
  it("reads files and lists the tree at the given ref, not the working tree", async () => {
    const ctx = gitRepoContext(repo, head);
    expect(await ctx.readFile("app.py")).toBe("x = 2\n");
    expect((await ctx.listFiles?.())?.sort()).toEqual(["app.py", "new.py"]);
  });

  it("returns undefined for missing files and refuses unsafe paths without running git", async () => {
    const calls: string[][] = [];
    const ctx = gitRepoContext(repo, head, (cmd, args, opts) => {
      calls.push([...args]);
      return runCommand(cmd, args, opts);
    });
    expect(await ctx.readFile("missing.py")).toBeUndefined();
    expect(await ctx.readFile("../outside.py")).toBeUndefined();
    expect(calls).toHaveLength(1);
  });
});
