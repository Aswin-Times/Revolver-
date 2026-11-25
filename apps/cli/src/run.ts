import { readFile, writeFile } from "node:fs/promises";
import {
  ConfigError,
  createAnthropicLlmClient,
  gitDiff,
  GitError,
  gitRepoContext,
  workingTreeRepo,
  DiffParseError,
  loadConfig,
  reviewDiff,
  reviewGateFailure,
  type LlmClient,
  type ReviewConfig,
  type StaticPassOptions,
} from "@pr-mentor/core";
import { parseCliArgs, USAGE, UsageError, type ReviewArgs } from "./args.js";
import { applyEnvFile } from "./env.js";

import { renderMarkdown, usageLine } from "@pr-mentor/core";

export interface RunDeps {
  cwd: string;
  env: Record<string, string | undefined>;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  /** Tests swap in fake tools. */
  staticOptions?: StaticPassOptions;
  /** Tests swap in a fake Claude. */
  createLlm?: (config: ReviewConfig, env: Record<string, string | undefined>) => LlmClient | null;
}

async function review(args: ReviewArgs, deps: RunDeps): Promise<number> {
  const env = { ...deps.env };
  if (args.envFile) applyEnvFile(await readFile(args.envFile, "utf8"), env);

  const config = loadConfig(env, {
    ...(args.model ? { model: args.model } : {}),
    ...(args.effort ? { effort: args.effort } : {}),
    ...(args.maxComments ? { maxComments: args.maxComments } : {}),
  });

  const diff = args.base
    ? await gitDiff(args.repo, args.base)
    : await readFile(args.diffFile ?? "", "utf8");
  const repo = args.base ? gitRepoContext(args.repo) : workingTreeRepo(args.repo);
  const createLlm =
    deps.createLlm ?? ((_config, e) => createAnthropicLlmClient({ apiKey: e.ANTHROPIC_API_KEY }));
  const llm = args.llm ? createLlm(config, env) : null;

  const started = Date.now();
  const result = await reviewDiff(diff, repo, {
    config,
    llm,
    ...(deps.staticOptions ? { static: deps.staticOptions } : {}),
  });

  const report =
    args.format === "json" ? `${JSON.stringify(result, null, 2)}\n` : renderMarkdown(result);
  if (args.out) await writeFile(args.out, report);
  else deps.stdout(report);
  deps.stderr(`${usageLine(result.llm, Date.now() - started)}\n`);

  const failOn = args.failOn;
  if (failOn === undefined) return 0;
  const failure = reviewGateFailure(result, failOn);
  if (failure) deps.stderr(`${failure}\n`);
  return failure ? 1 : 0;
}

/** The CLI: returns the exit code (0 ok, 1 --fail-on threshold met, 2 usage or input error). */
export async function run(argv: string[], deps: RunDeps): Promise<number> {
  try {
    const args = parseCliArgs(argv, deps.cwd);
    if (args.command === "help") {
      deps.stdout(`${USAGE}\n`);
      return 0;
    }
    return await review(args, deps);
  } catch (error) {
    if (error instanceof UsageError) {
      deps.stderr(`pr-mentor: ${error.message}\n\n${USAGE}\n`);
      return 2;
    }
    if (
      error instanceof ConfigError ||
      error instanceof DiffParseError ||
      error instanceof GitError
    ) {
      deps.stderr(`pr-mentor: ${error.message}\n`);
      return 2;
    }
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      deps.stderr(`pr-mentor: ${error.message}\n`);
      return 2;
    }
    throw error;
  }
}
