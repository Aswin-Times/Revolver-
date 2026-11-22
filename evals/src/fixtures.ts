import { cp, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runCommand } from "@pr-mentor/core";

export const CASES_DIR = fileURLToPath(new URL("../cases", import.meta.url));

const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  );

/**
 * The PR diff for a case: commit before/ in a throwaway git repo, replace it with after/,
 * and ask git for the diff. Same bytes every time for the same trees.
 */
export async function buildDiff(caseDir: string): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), "pr-mentor-build-"));
  const git = async (...args: string[]) => {
    const result = await runCommand("git", args, { cwd: repo, timeoutMs: 60_000 });
    if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
    return result.stdout;
  };
  try {
    await git("init", "-q", "-b", "main");
    await git("config", "core.autocrlf", "false");
    await git("config", "user.email", "evals@example.com");
    await git("config", "user.name", "evals");
    const before = join(caseDir, "before");
    if (await exists(before)) await cp(before, join(repo, "tree"), { recursive: true });
    await git("add", "-A");
    await git("commit", "-q", "--allow-empty", "-m", "before");

    // Empty the index too: a same-size file rewritten within the same second would
    // otherwise look unchanged to git's stat cache ("racy git").
    await git("rm", "-r", "-q", "--cached", "--ignore-unmatch", ".");
    await rm(join(repo, "tree"), { recursive: true, force: true });
    await cp(join(caseDir, "after"), join(repo, "tree"), { recursive: true });
    await git("add", "-A");
    const diff = await git(
      "-c",
      "core.quotepath=true",
      "diff",
      "--cached",
      "--no-color",
      "--no-ext-diff",
      "-M",
      "--relative=tree",
    );
    return diff;
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
}
