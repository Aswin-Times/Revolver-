import { describe, expect, it } from "vitest";
import { ConfigError, DEFAULT_CONFIG, loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("uses the defaults when nothing is set", () => {
    expect(loadConfig({})).toEqual({
      model: "claude-sonnet-5-5",
      effort: "medium",
      maxComments: 15,
      minConfidence: 0.5,
      budget: { maxInputTokens: 80_000, maxOutputTokens: 16_000 },
    });
    expect(loadConfig({})).toEqual(DEFAULT_CONFIG);
  });

  it("reads PR_MENTOR_* environment variables", () => {
    const config = loadConfig({
      PR_MENTOR_MODEL: "claude-opus-5-5",
      PR_MENTOR_EFFORT: "high",
      PR_MENTOR_MAX_COMMENTS: "8",
      PR_MENTOR_MIN_CONFIDENCE: "0.7",
      PR_MENTOR_MAX_INPUT_TOKENS: "40000",
      PR_MENTOR_MAX_OUTPUT_TOKENS: "8000",
    });
    expect(config).toEqual({
      model: "claude-opus-5-5",
      effort: "high",
      maxComments: 8,
      minConfidence: 0.7,
      budget: { maxInputTokens: 40_000, maxOutputTokens: 8_000 },
    });
  });

  it("ignores empty environment values", () => {
    expect(loadConfig({ PR_MENTOR_MODEL: "", PR_MENTOR_MAX_COMMENTS: "  " })).toEqual(
      DEFAULT_CONFIG,
    );
  });

  it("lets explicit overrides beat the environment, keeping other budget defaults", () => {
    const config = loadConfig(
      {
        PR_MENTOR_EFFORT: "high",
        PR_MENTOR_MAX_INPUT_TOKENS: "40000",
        PR_MENTOR_MAX_OUTPUT_TOKENS: "8000",
      },
      { effort: "low", budget: { maxInputTokens: 20_000 } },
    );
    expect(config.effort).toBe("low");
    expect(config.budget).toEqual({ maxInputTokens: 20_000, maxOutputTokens: 8_000 });
  });

  it.each([
    [{ PR_MENTOR_EFFORT: "extreme" }, "PR_MENTOR_EFFORT"],
    [{ PR_MENTOR_MAX_COMMENTS: "lots" }, "PR_MENTOR_MAX_COMMENTS"],
    [{ PR_MENTOR_MAX_COMMENTS: "0" }, "PR_MENTOR_MAX_COMMENTS"],
    [{ PR_MENTOR_MIN_CONFIDENCE: "1.5" }, "PR_MENTOR_MIN_CONFIDENCE"],
    [{ PR_MENTOR_MAX_OUTPUT_TOKENS: "100" }, "PR_MENTOR_MAX_OUTPUT_TOKENS"],
  ])("rejects %j with a ConfigError naming the variable", (env, name) => {
    expect(() => loadConfig(env)).toThrow(ConfigError);
    expect(() => loadConfig(env)).toThrow(name);
  });
});
