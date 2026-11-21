import { readFileSync } from "node:fs";
import { parseDiff } from "../../src/diff/parse.js";
import type { FileDiff } from "../../src/diff/types.js";
import type { CommandResult, CommandRunner } from "../../src/static/exec.js";
import type { ToolContext } from "../../src/static/tool.js";
import { createWorkspace, type Workspace } from "../../src/static/workspace.js";

/** The diff for adding `content` as a brand-new file. */
export function newFileDiff(path: string, content: string): FileDiff {
  const lines = content.replace(/\n$/, "").split("\n");
  const [file] = parseDiff(
    [
      "--- /dev/null",
      `+++ b/${path}`,
      `@@ -0,0 +1,${lines.length} @@`,
      ...lines.map((l) => `+${l}`),
      "",
    ].join("\n"),
  );
  if (!file) throw new Error(`could not build a diff for ${path}`);
  return file;
}

/** A real workspace on disk holding the given new files. Remember to dispose() it. */
export function realWorkspace(files: Record<string, string>): Promise<Workspace> {
  return createWorkspace(
    Object.entries(files).map(([path, content]) => newFileDiff(path, content)),
    { readFile: (path) => Promise.resolve(files[path]) },
  );
}

/** Reads a recorded tool output from test/fixtures/tools. */
export const toolFixture = (name: string) =>
  readFileSync(new URL(`../fixtures/tools/${name}`, import.meta.url), "utf8");

/** The workspace root used when the tool fixtures were recorded (paths are sanitized). */
export const FIXTURE_ROOT = "C:/Temp/pr-mentor-test/repo";

/** A workspace stand-in that maps fixture paths under FIXTURE_ROOT back to repo paths. */
export function fakeWorkspace(root = FIXTURE_ROOT): Workspace {
  return {
    dir: root.replace(/\/repo$/, ""),
    root,
    files: [],
    skipped: [],
    toRepoPath: (p) => {
      const normalized = p.replace(/\\/g, "/");
      return normalized.startsWith(`${root}/`) ? normalized.slice(root.length + 1) : undefined;
    },
    dispose: () => Promise.resolve(),
  };
}

export interface RecordedCall {
  command: string;
  args: readonly string[];
}

/** A CommandRunner that returns a canned result and records how it was called. */
export function fakeRunner(result: Partial<CommandResult>): CommandRunner & {
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const runner = (command: string, args: readonly string[]) => {
    calls.push({ command, args });
    return Promise.resolve({
      exitCode: 0,
      stdout: "",
      stderr: "",
      timedOut: false,
      truncated: false,
      ...result,
    });
  };
  return Object.assign(runner, { calls });
}

export const contextWith = (runner: CommandRunner, workspace = fakeWorkspace()): ToolContext => ({
  workspace,
  runner,
  timeoutMs: 1000,
});
