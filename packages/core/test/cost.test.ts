import { describe, expect, it } from "vitest";
import { addUsage, costUsd, EMPTY_USAGE } from "../src/cost.js";

describe("costUsd", () => {
  it("prices Claude Sonnet 5.5 at $2 in / $10 out per million tokens", () => {
    expect(costUsd("claude-sonnet-5-5", { ...EMPTY_USAGE, inputTokens: 1_000_000 })).toBeCloseTo(2);
    expect(costUsd("claude-sonnet-5-5", { ...EMPTY_USAGE, outputTokens: 1_000_000 })).toBeCloseTo(
      10,
    );
  });

  it("adds cache writes (1.25x input) and cache reads ($0.10/M on Sonnet 5.5)", () => {
    const usage = {
      inputTokens: 10_000,
      outputTokens: 2_000,
      cacheReadTokens: 50_000,
      cacheWriteTokens: 3_000,
    };
    // 0.02 input + 0.02 output + 0.005 cache read + 0.0075 cache write
    expect(costUsd("claude-sonnet-5-5", usage)).toBeCloseTo(0.0525, 6);
  });

  it("knows the refusal-fallback model's price too", () => {
    expect(costUsd("claude-sonnet-5", { ...EMPTY_USAGE, inputTokens: 1_000_000 })).toBeCloseTo(2);
  });

  it("returns undefined for a model it has no price for", () => {
    expect(costUsd("some-future-model", { ...EMPTY_USAGE, inputTokens: 1000 })).toBeUndefined();
  });
});

describe("addUsage", () => {
  it("sums every counter, e.g. across a retry", () => {
    expect(
      addUsage(
        { inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 4 },
        { inputTokens: 10, outputTokens: 20, cacheReadTokens: 30, cacheWriteTokens: 40 },
      ),
    ).toEqual({ inputTokens: 11, outputTokens: 22, cacheReadTokens: 33, cacheWriteTokens: 44 });
  });
});
