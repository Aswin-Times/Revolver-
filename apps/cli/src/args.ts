import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { EffortSchema, SeveritySchema, type Effort, type Severity } from "@pr-mentor/core";

export class UsageError extends Error {
  override name = "UsageError";
}

export interface ReviewArgs {
  command: "review";
  diffFile?: string;
  base?: string;
  /** Repository to read file contents from (absolute). */
  repo: string;
  format: "markdown" | "json";
  out?: string;
  llm: boolean;
  model?: string;
  effort?: Effort;
  maxComments?: number;
  failOn?: Severity;
  envFile?: string;
}

export type CliArgs = ReviewArgs | { command: "help" };

export const USAGE = `Usage:
  pr-mentor review --base <ref>      review this branch against <ref> (git diff <ref>...HEAD)
  pr-mentor review --diff <file>     review a saved unified diff

Options:
  --repo <dir>            repository to read files from (default: current directory)
  --format markdown|json  output format (default: markdown)
  --out <file>            write the report to a file instead of stdout
  --no-llm                static checks only; don't call Claude
  --model <id>            Claude model (default: claude-sonnet-5-5, or PR_MENTOR_MODEL)
  --effort <level>        low | medium | high | xhigh | max (default: medium)
  --max-comments <n>      show at most n findings (default: 15)
  --fail-on <severity>    exit 1 if any finding is at least critical | high | medium | low
  --env-file <file>       read ANTHROPIC_API_KEY and PR_MENTOR_* from this file
  -h, --help              show this help

Claude needs ANTHROPIC_API_KEY in the environment (or a profile from \`ant auth login\`).`;

export function parseCliArgs(argv: string[], cwd: string): CliArgs {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      strict: true,
      options: {
        diff: { type: "string" },
        base: { type: "string" },
        repo: { type: "string" },
        format: { type: "string" },
        out: { type: "string" },
        "no-llm": { type: "boolean" },
        model: { type: "string" },
        effort: { type: "string" },
        "max-comments": { type: "string" },
        "fail-on": { type: "string" },
        "env-file": { type: "string" },
        help: { type: "boolean", short: "h" },
      },
    });
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error));
  }
  const { values, positionals } = parsed;
  if (values.help || positionals.length === 0) return { command: "help" };
  if (positionals[0] !== "review") throw new UsageError(`Unknown command "${positionals[0]}".`);

  if (!values.diff && !values.base) throw new UsageError("Pass --diff or --base.");
  if (values.diff && values.base) throw new UsageError("Pass --diff or --base, not both.");
  if (values.base?.startsWith("-")) throw new UsageError("--base must be a branch, tag or commit.");

  const format = values.format ?? "markdown";
  if (format !== "markdown" && format !== "json") {
    throw new UsageError(`--format must be markdown or json, got "${format}".`);
  }
  const effort = values.effort === undefined ? undefined : EffortSchema.safeParse(values.effort);
  if (effort && !effort.success)
    throw new UsageError(`--effort must be one of ${EffortSchema.options.join(", ")}.`);
  const failOn =
    values["fail-on"] === undefined ? undefined : SeveritySchema.safeParse(values["fail-on"]);
  if (failOn && !failOn.success)
    throw new UsageError(`--fail-on must be one of ${SeveritySchema.options.join(", ")}.`);
  const maxComments =
    values["max-comments"] === undefined ? undefined : Number(values["max-comments"]);
  if (maxComments !== undefined && !(Number.isInteger(maxComments) && maxComments > 0)) {
    throw new UsageError("--max-comments must be a positive whole number.");
  }

  return {
    command: "review",
    ...(values.diff ? { diffFile: resolve(cwd, values.diff) } : {}),
    ...(values.base ? { base: values.base } : {}),
    repo: resolve(cwd, values.repo ?? "."),
    format,
    ...(values.out ? { out: resolve(cwd, values.out) } : {}),
    llm: !values["no-llm"],
    ...(values.model ? { model: values.model } : {}),
    ...(effort?.success ? { effort: effort.data } : {}),
    ...(maxComments !== undefined ? { maxComments } : {}),
    ...(failOn?.success ? { failOn: failOn.data } : {}),
    ...(values["env-file"] ? { envFile: resolve(cwd, values["env-file"]) } : {}),
  };
}
