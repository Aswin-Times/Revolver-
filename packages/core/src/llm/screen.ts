import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCommand, type CommandRunner } from "../static/exec.js";

export class PromptScreenError extends Error {
  override name = "PromptScreenError";
}

/** Screen the fully rendered payload locally before it reaches any provider endpoint. */
export async function screenPrompt(
  text: string,
  runner: CommandRunner = runCommand,
): Promise<void> {
  try {
    const cwd = await mkdtemp(join(tmpdir(), "pr-mentor-prompt-"));
    try {
      const env = Object.fromEntries(
        Object.entries(process.env).filter(([key]) => !/^GITLEAKS_/i.test(key)),
      );
      const result = await runner(
        "gitleaks",
        ["stdin", "--ignore-gitleaks-allow", "--redact=100", "--no-banner", "--exit-code", "42"],
        { cwd, env, input: text, timeoutMs: 30_000 },
      );
      if (result.timedOut || result.truncated) throw new Error();
      if (result.exitCode === 42) {
        throw new PromptScreenError("Gitleaks detected a potential secret in the outbound prompt.");
      }
      if (result.exitCode !== 0) throw new Error();
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  } catch (error) {
    if (error instanceof PromptScreenError) throw error;
    throw new PromptScreenError("Gitleaks could not screen the outbound prompt.");
  }
}
