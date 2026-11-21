import type { FileDiff } from "../diff/types.js";
import type { Finding } from "../finding.js";
import { createRedactor } from "../redact.js";
import type { RepoContext } from "../repo.js";
import { keepOnAddedLines } from "./added-lines.js";
import { eslintTool } from "./eslint.js";
import { runCommand, ToolNotFoundError, type CommandRunner } from "./exec.js";
import { gitleaksTool } from "./gitleaks.js";
import { ruffTool } from "./ruff.js";
import { semgrepTool } from "./semgrep.js";
import type { StaticTool, ToolContext, ToolName } from "./tool.js";
import { createWorkspace, type WorkspaceSkip } from "./workspace.js";

export const DEFAULT_TOOLS: readonly StaticTool[] = [
  gitleaksTool,
  semgrepTool,
  ruffTool,
  eslintTool,
];

const INSTALL_HINTS: Record<ToolName, string> = {
  gitleaks:
    "Gitleaks isn't installed, so secrets weren't checked. Install it from https://github.com/gitleaks/gitleaks#installing (e.g. `brew install gitleaks` or `winget install Gitleaks.Gitleaks`).",
  semgrep:
    "Semgrep isn't installed, so security rules weren't checked. Install it with `uv tool install semgrep` or `pipx install semgrep`.",
  ruff: "Ruff isn't installed, so Python files weren't linted. Install it with `uv tool install ruff` or `pip install ruff`.",
  eslint: "ESLint couldn't be loaded.",
};

export interface ToolReport {
  tool: ToolName;
  status: "ran" | "skipped" | "failed";
  detail?: string;
  /** Findings on added lines. */
  findings: number;
  durationMs: number;
}

export interface StaticPassResult {
  findings: Finding[];
  tools: ToolReport[];
  /** Changed files that couldn't be given to the tools (unsafe paths, tool configs). */
  skippedFiles: WorkspaceSkip[];
  /**
   * Redacts the secrets the tools found (plus well-known key formats) from any text, e.g.
   * the diff before it is sent to Claude. A function, so raw secrets never serialize.
   */
  redact: (text: string) => string;
}

export interface StaticPassOptions {
  /** Limit which tools run. Default: all of them. */
  tools?: readonly ToolName[];
  runner?: CommandRunner;
  /** Per-tool timeout. Default 2 minutes. */
  timeoutMs?: number;
  /** Tool implementations; tests pass fakes. */
  registry?: readonly StaticTool[];
}

const byFileThenLine = (a: Finding, b: Finding) =>
  a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1;

/**
 * Run the static tools on the changed files, in parallel and in an isolated workspace,
 * and return the findings on lines this PR added plus a report for every tool.
 */
export async function runStaticPass(
  files: FileDiff[],
  repo: RepoContext,
  options: StaticPassOptions = {},
): Promise<StaticPassResult> {
  const registry = options.registry ?? DEFAULT_TOOLS;
  const selected = options.tools
    ? registry.filter((tool) => options.tools?.includes(tool.name))
    : registry;

  const workspace = await createWorkspace(files, repo);
  const ctx: ToolContext = {
    workspace,
    runner: options.runner ?? runCommand,
    timeoutMs: options.timeoutMs ?? 120_000,
  };

  try {
    const outcomes = await Promise.all(
      selected.map(
        async (tool): Promise<{ report: ToolReport; findings: Finding[]; secrets?: string[] }> => {
          const targets = workspace.files.filter((file) => tool.appliesTo(file));
          if (targets.length === 0) {
            return {
              report: {
                tool: tool.name,
                status: "skipped",
                detail: "no changed files of a type it checks",
                findings: 0,
                durationMs: 0,
              },
              findings: [],
            };
          }

          const started = Date.now();
          try {
            const run = await tool.run(targets, ctx);
            const kept = keepOnAddedLines(run.findings, files);
            return {
              report: {
                tool: tool.name,
                status: "ran",
                ...(run.detail ? { detail: run.detail } : {}),
                findings: kept.length,
                durationMs: Date.now() - started,
              },
              findings: kept,
              ...(run.secrets ? { secrets: run.secrets } : {}),
            };
          } catch (error) {
            const missing = error instanceof ToolNotFoundError;
            return {
              report: {
                tool: tool.name,
                status: missing ? "skipped" : "failed",
                detail: missing
                  ? INSTALL_HINTS[tool.name]
                  : error instanceof Error
                    ? error.message
                    : String(error),
                findings: 0,
                durationMs: Date.now() - started,
              },
              findings: [],
            };
          }
        },
      ),
    );

    return {
      findings: outcomes.flatMap((o) => o.findings).sort(byFileThenLine),
      tools: outcomes.map((o) => o.report),
      skippedFiles: workspace.skipped,
      redact: createRedactor(outcomes.flatMap((o) => o.secrets ?? [])),
    };
  } finally {
    await workspace.dispose();
  }
}
