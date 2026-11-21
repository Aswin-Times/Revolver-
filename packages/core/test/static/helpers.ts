import { readFileSync } from "node:fs";
import type { CommandResult, CommandRunner } from "../../src/static/exec.js";
import type { ToolContext } from "../../src/static/tool.js";
import type { Workspace } from "../../src/static/workspace.js";

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
