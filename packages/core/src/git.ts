import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { RepoContext } from "./repo.js";
import { runCommand, type CommandRunner } from "./static/exec.js";
import { isSafeRepoPath } from "./static/workspace.js";

export class GitError extends Error {
  override name = "GitError";
}

const GIT_TIMEOUT = 60_000;

/**
 * `git diff <base>...<head>`, run without a shell. External diff drivers and textconv
 * filters are disabled so the diff is the raw content and no configured program runs.
 */
export async function gitDiff(
  dir: string,
  base: string,
  head = "HEAD",
  runner: CommandRunner = runCommand,
) {
  const result = await runner(
    "git",
    [
      "-c",
      "core.quotepath=true",
      "diff",
      "--no-color",
      "--no-ext-diff",
      "--no-textconv",
      `${base}...${head}`,
    ],
    { cwd: dir, timeoutMs: GIT_TIMEOUT, maxOutputBytes: 50_000_000 },
  );
  if (result.exitCode !== 0) {
    throw new GitError(
      `git diff ${base}...${head} failed: ${result.stderr.trim() || "unknown error"}`,
    );
  }
  return result.stdout;
}

/** Reads files as committed at `ref`, which is exactly what `git diff base...ref` shows. */
export function gitRepoContext(
  dir: string,
  ref = "HEAD",
  runner: CommandRunner = runCommand,
): RepoContext {
  return {
    async readFile(path) {
      if (!isSafeRepoPath(path)) return undefined;
      const result = await runner("git", ["show", `${ref}:${path}`], {
        cwd: dir,
        timeoutMs: GIT_TIMEOUT,
      });
      return result.exitCode === 0 ? result.stdout : undefined;
    },
    async listFiles() {
      const result = await runner("git", ["ls-tree", "-r", "--name-only", "-z", ref], {
        cwd: dir,
        timeoutMs: GIT_TIMEOUT,
      });
      return result.exitCode === 0 ? result.stdout.split("\0").filter(Boolean) : [];
    },
  };
}

/** Reads the working tree (for --diff). core's verifiedRepo rejects contents that don't match. */
export function workingTreeRepo(dir: string): RepoContext {
  return {
    async readFile(path) {
      if (!isSafeRepoPath(path)) return undefined;
      try {
        return await readFile(join(dir, ...path.split("/")), "utf8");
      } catch {
        return undefined;
      }
    },
  };
}
