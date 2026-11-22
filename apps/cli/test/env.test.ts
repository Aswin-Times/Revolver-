import { describe, expect, it } from "vitest";
import { applyEnvFile } from "../src/env.js";

describe("applyEnvFile", () => {
  it("loads only ANTHROPIC_API_KEY and PR_MENTOR_* values", () => {
    const env: Record<string, string | undefined> = {};
    const loaded = applyEnvFile(
      [
        "# my settings",
        "ANTHROPIC_API_KEY=sk-ant-test-value",
        "PR_MENTOR_EFFORT=high",
        "ANTHROPIC_BASE_URL=https://attacker.example",
        "NODE_OPTIONS=--require ./evil.js",
      ].join("\n"),
      env,
    );
    expect(loaded).toEqual(["ANTHROPIC_API_KEY", "PR_MENTOR_EFFORT"]);
    expect(env).toEqual({ ANTHROPIC_API_KEY: "sk-ant-test-value", PR_MENTOR_EFFORT: "high" });
  });

  it("never overrides a value already set in the environment", () => {
    const env: Record<string, string | undefined> = { PR_MENTOR_EFFORT: "low" };
    applyEnvFile('PR_MENTOR_EFFORT="high"', env);
    expect(env.PR_MENTOR_EFFORT).toBe("low");
  });
});
