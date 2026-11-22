import { readFile } from "node:fs/promises";
import * as core from "@actions/core";
import { createGitHubApi } from "./github.js";
import { runAction } from "./run.js";

// Inputs arrive as env vars set by action.yml (a composite action passes them explicitly).
const env = Object.fromEntries(
  Object.entries(process.env).filter(
    ([k]) => k === "ANTHROPIC_API_KEY" || k.startsWith("PR_MENTOR_"),
  ),
);
if (env.ANTHROPIC_API_KEY) core.setSecret(env.ANTHROPIC_API_KEY);

const token = process.env.PR_MENTOR_GITHUB_TOKEN ?? "";
const eventPath = process.env.GITHUB_EVENT_PATH;
const payload: unknown = eventPath ? JSON.parse(await readFile(eventPath, "utf8")) : {};
let summary = "";

try {
  process.exitCode = await runAction({
    eventName: process.env.GITHUB_EVENT_NAME ?? "",
    payload,
    workspace: process.env.GITHUB_WORKSPACE ?? process.cwd(),
    env,
    api: createGitHubApi(token),
    log: {
      info: (m) => core.info(m),
      warning: (m) => core.warning(m),
      setOutput: (k, v) => core.setOutput(k, v),
      summary: (md) => (summary += md),
      fail: (m) => core.setFailed(m),
    },
  });
} catch (error) {
  core.setFailed(error instanceof Error ? error.message : String(error));
} finally {
  if (summary) await core.summary.addRaw(summary).write();
}
