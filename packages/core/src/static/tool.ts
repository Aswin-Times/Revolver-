import type { Finding } from "../finding.js";
import type { CommandResult, CommandRunner } from "./exec.js";
import type { Workspace, WorkspaceFile } from "./workspace.js";

export type ToolName = "semgrep" | "gitleaks" | "ruff" | "eslint";

export interface ToolContext {
  workspace: Workspace;
  runner: CommandRunner;
  timeoutMs: number;
}

export interface ToolRun {
  findings: Finding[];
  /** Anything worth telling the user, e.g. files the tool couldn't parse. */
  detail?: string;
  /** Raw secret values found. Only used to build the redactor; never output. */
  secrets?: string[];
}

export interface StaticTool {
  name: ToolName;
  /** Whether this tool should look at a workspace file. */
  appliesTo(file: WorkspaceFile): boolean;
  run(files: WorkspaceFile[], ctx: ToolContext): Promise<ToolRun>;
}

/** A tool ran but failed: bad exit code, timeout, or output we couldn't understand. */
export class ToolError extends Error {
  override name = "ToolError";
}

const firstLine = (text: string) => text.trim().split(/\r?\n/)[0]?.slice(0, 200) ?? "";

/**
 * Run a tool in the workspace and turn every kind of failure into a ToolError.
 * ToolNotFoundError passes through untouched so the tool can be reported as skipped.
 */
export async function runTool(
  ctx: ToolContext,
  command: string,
  args: readonly string[],
  okExitCodes: readonly number[] = [0],
): Promise<CommandResult> {
  const result = await ctx.runner(command, args, {
    cwd: ctx.workspace.root,
    timeoutMs: ctx.timeoutMs,
  });
  if (result.timedOut) {
    throw new ToolError(`${command} timed out after ${Math.round(ctx.timeoutMs / 1000)}s`);
  }
  if (result.truncated) {
    throw new ToolError(`${command} produced more output than we can safely read`);
  }
  if (result.exitCode === null || !okExitCodes.includes(result.exitCode)) {
    const reason = firstLine(result.stderr) || firstLine(result.stdout);
    throw new ToolError(`${command} exited with code ${result.exitCode}: ${reason}`);
  }
  return result;
}
